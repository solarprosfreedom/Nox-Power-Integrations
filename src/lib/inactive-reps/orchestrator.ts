import { env } from "@/lib/env";
import {
  deactivateEnerfloAccounts,
  deactivateMicrosoftAccount,
  deactivateTerrosAccounts,
  type ExecutionResult,
  type PendingExecution,
} from "@/lib/inactive-reps/actions";
import { buildCandidateCsv, buildInactiveRepCandidates } from "@/lib/inactive-reps/evaluate";
import { sendInactiveRepReport } from "@/lib/inactive-reps/mail";
import {
  createOrLoadPreparingBatch,
  claimBatchForEmail,
  claimBatchForProcessing,
  ensureBatchActions,
  listBatchActions,
  listDueBatches,
  updateAction,
  updateBatch,
} from "@/lib/inactive-reps/repository";
import { fetchInactiveRepSourceSnapshot } from "@/lib/inactive-reps/sources";
import {
  INACTIVE_REP_CRITERIA_VERSION,
  type CronRunSummary,
  type InactiveRepAction,
  type InactiveRepBatch,
  type InactiveRepCandidate,
} from "@/lib/inactive-reps/types";

const HOUR_MS = 3_600_000;

export const INACTIVE_REP_DEACTIVATION_DELAY_HOURS = 23;

export function inactiveRepDeactivationDueBefore(date: Date): Date {
  return new Date(date.getTime() - INACTIVE_REP_DEACTIVATION_DELAY_HOURS * HOUR_MS);
}

export function phoenixDateString(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Phoenix",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find(item => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function accountCount(candidates: InactiveRepCandidate[]): number {
  return candidates.reduce((sum, candidate) => sum + candidate.targets.length, 0);
}

async function markActions(
  actions: InactiveRepAction[],
  status: "success" | "skipped" | "blocked" | "failed",
  message: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await Promise.all(
    actions.map(action =>
      updateAction(action.id, {
        status,
        attempts: action.attempts + 1,
        last_error: status === "failed" || status === "blocked" ? message : null,
        metadata: { ...action.metadata, ...metadata, revalidation: message },
        processed_at: new Date().toISOString(),
      }),
    ),
  );
}

async function persistExecutionResult(
  execution: PendingExecution,
  result: ExecutionResult,
): Promise<void> {
  await updateAction(execution.action.id, {
    status: result.status,
    attempts: execution.action.attempts + 1,
    last_error: result.error ?? null,
    metadata: { ...execution.action.metadata, ...result.metadata },
    processed_at: new Date().toISOString(),
  });
}

interface DeactivationCounters {
  revalidatedPeople: number;
  succeeded: number;
  skipped: number;
  blocked: number;
  failed: number;
}

function increment(counters: DeactivationCounters, status: ExecutionResult["status"], amount = 1): void {
  if (status === "success") counters.succeeded += amount;
  else if (status === "skipped") counters.skipped += amount;
  else if (status === "blocked") counters.blocked += amount;
  else counters.failed += amount;
}

async function processDueBatch(
  batch: InactiveRepBatch,
  currentCandidates: Map<string, InactiveRepCandidate>,
  counters: DeactivationCounters,
): Promise<void> {
  if (!(await claimBatchForProcessing(batch))) return;
  await ensureBatchActions(batch);
  const allActions = await listBatchActions(batch.id);
  const pending = allActions.filter(action => !["success", "skipped"].includes(action.status));
  const byIdentity = new Map<string, InactiveRepAction[]>();
  for (const action of pending) {
    const rows = byIdentity.get(action.identity_key) ?? [];
    rows.push(action);
    byIdentity.set(action.identity_key, rows);
  }

  const executions: PendingExecution[] = [];
  for (const [identityKey, actions] of byIdentity) {
    counters.revalidatedPeople++;
    const current = currentCandidates.get(identityKey);
    if (!current) {
      await markActions(
        actions,
        "skipped",
        "Person no longer satisfies the complete live role, login, sales, identity, and evidence criteria",
      );
      counters.skipped += actions.length;
      continue;
    }
    for (const action of actions) {
      const currentAccount = current.accounts[action.platform];
      if (!currentAccount || currentAccount.id !== action.account_id) {
        await markActions(
          [action],
          "skipped",
          "Stable platform account ID no longer matches the emailed account",
        );
        counters.skipped++;
        continue;
      }
      if (!currentAccount.active) {
        await markActions([action], "success", "Account is already inactive", { alreadyInactive: true });
        counters.succeeded++;
        continue;
      }
      executions.push({ action, account: currentAccount });
    }
  }

  const enerflo = executions.filter(execution => execution.action.platform === "enerflo");
  const terros = executions.filter(execution => execution.action.platform === "terros");
  const microsoft = executions.filter(execution => execution.action.platform === "microsoft");

  if (enerflo.length) {
    const results = await deactivateEnerfloAccounts(enerflo);
    for (const execution of enerflo) {
      const result = results.get(execution.action.id) ?? {
        status: "failed" as const,
        error: "Enerflo action returned no result",
        metadata: {},
      };
      await persistExecutionResult(execution, result);
      increment(counters, result.status);
    }
  }
  if (terros.length) {
    const results = await deactivateTerrosAccounts(terros);
    for (const execution of terros) {
      const result = results.get(execution.action.id) ?? {
        status: "failed" as const,
        error: "Terros action returned no result",
        metadata: {},
      };
      await persistExecutionResult(execution, result);
      increment(counters, result.status);
    }
  }
  let microsoftCursor = 0;
  async function microsoftWorker(): Promise<void> {
    while (microsoftCursor < microsoft.length) {
      const execution = microsoft[microsoftCursor++]!;
      const result = await deactivateMicrosoftAccount(execution);
      await persistExecutionResult(execution, result);
      increment(counters, result.status);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(4, microsoft.length) }, () => microsoftWorker()),
  );

  const finalActions = await listBatchActions(batch.id);
  const complete = finalActions.every(action => ["success", "skipped"].includes(action.status));
  await updateBatch(batch.id, {
    status: complete ? "completed" : "partial",
    completed_at: complete ? new Date().toISOString() : null,
  });
}

export async function runInactiveRepReport(
  options?: { now?: Date },
): Promise<Pick<CronRunSummary, "report" | "sourceSummary" | "exclusions">> {
  const now = options?.now ?? new Date();
  const reportDate = phoenixDateString(now);
  const recipient = env.inactiveRepEmailTo?.trim() || "noxpwr@gmail.com";
  const subject = `[Inactive Rep Review] ${reportDate} (Phoenix)`;
  const source = await fetchInactiveRepSourceSnapshot();
  const result = buildInactiveRepCandidates(source, now);
  const csv = buildCandidateCsv(result.candidates);
  const { batch } = await createOrLoadPreparingBatch({
    reportDate,
    subject,
    emailTo: recipient,
    criteriaVersion: INACTIVE_REP_CRITERIA_VERSION,
    result,
    csv,
  });

  let report: CronRunSummary["report"];
  if (["emailing", "emailed", "processing", "partial", "completed"].includes(batch.status)) {
    report = {
      reportDate,
      status: "already_sent",
      batchId: batch.id,
      candidates: batch.candidates.length,
      accounts: accountCount(batch.candidates),
    };
  } else {
    try {
      if (!(await claimBatchForEmail(batch))) {
        report = {
          reportDate,
          status: "already_sent",
          batchId: batch.id,
          candidates: batch.candidates.length,
          accounts: accountCount(batch.candidates),
        };
      } else {
      const mail = await sendInactiveRepReport({
        subject: batch.email_subject,
        reportDate,
        recipient: batch.email_to,
        csv: batch.report_csv,
        candidates: batch.candidates,
      });
      await updateBatch(batch.id, {
        status: "emailed",
        email_from: mail.from,
        emailed_at: mail.sentAt,
        sent_message_id: mail.messageId,
        errors: [],
      });
      const emailedBatch = { ...batch, status: "emailed" as const, emailed_at: mail.sentAt };
      await ensureBatchActions(emailedBatch);
      report = {
        reportDate,
        status: mail.alreadySent ? "already_sent" : "sent",
        batchId: batch.id,
        candidates: batch.candidates.length,
        accounts: accountCount(batch.candidates),
      };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await updateBatch(batch.id, { status: "email_failed", errors: [...batch.errors, message] });
      report = {
        reportDate,
        status: "failed",
        batchId: batch.id,
        candidates: batch.candidates.length,
        accounts: accountCount(batch.candidates),
        error: message,
      };
    }
  }

  return {
    report,
    sourceSummary: result.sourceSummary,
    exclusions: result.exclusions,
  };
}

export async function runInactiveRepDeactivation(
  options?: { now?: Date },
): Promise<Pick<CronRunSummary, "deactivation">> {
  const now = options?.now ?? new Date();
  const dueBefore = inactiveRepDeactivationDueBefore(now);
  const dueBatches = await listDueBatches(dueBefore);
  const counters: DeactivationCounters = {
    revalidatedPeople: 0,
    succeeded: 0,
    skipped: 0,
    blocked: 0,
    failed: 0,
  };
  if (env.inactiveRepDeactivationEnabled && dueBatches.length) {
    const source = await fetchInactiveRepSourceSnapshot();
    const result = buildInactiveRepCandidates(source, now);
    const currentCandidates = new Map(result.candidates.map(candidate => [candidate.identityKey, candidate]));
    for (const dueBatch of dueBatches) {
      await processDueBatch(dueBatch, currentCandidates, counters);
    }
  }

  return {
    deactivation: {
      enabled: env.inactiveRepDeactivationEnabled,
      dueBatches: dueBatches.length,
      ...counters,
    },
  };
}
