import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import {
  INACTIVE_REP_DEACTIVATION_DELAY_HOURS,
  type ActionStatus,
  type BatchStatus,
  type CandidateBuildResult,
  type InactiveRepAction,
  type InactiveRepAccountLog,
  type InactiveRepAutomationLogs,
  type InactiveRepBatchLog,
  type InactiveRepBatch,
  type InactiveRepCandidate,
  type InactiveRepExemption,
  type InactiveRepExemptionScope,
} from "@/lib/inactive-reps/types";
import { inactiveRepReportRecipients } from "@/lib/inactive-reps/recipients";

let client: SupabaseClient | null = null;

function db(): SupabaseClient {
  if (client) return client;
  const url = env.supabaseUrl?.trim();
  const key = env.supabaseServiceRoleKey?.trim();
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

function batchFromRow(row: Record<string, unknown>): InactiveRepBatch {
  return {
    id: String(row.id),
    report_date: String(row.report_date),
    criteria_version: String(row.criteria_version),
    status: row.status as BatchStatus,
    cutoff_at: String(row.cutoff_at),
    checked_at: String(row.checked_at),
    email_subject: String(row.email_subject),
    email_from: row.email_from == null ? null : String(row.email_from),
    email_to: String(row.email_to),
    emailed_at: row.emailed_at == null ? null : String(row.emailed_at),
    sent_message_id: row.sent_message_id == null ? null : String(row.sent_message_id),
    candidates: (row.candidates as InactiveRepCandidate[]) ?? [],
    report_csv: String(row.report_csv ?? ""),
    source_summary: (row.source_summary as InactiveRepBatch["source_summary"]) ?? {},
    errors: Array.isArray(row.errors) ? row.errors.map(String) : [],
    processing_started_at: row.processing_started_at == null ? null : String(row.processing_started_at),
    completed_at: row.completed_at == null ? null : String(row.completed_at),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function actionFromRow(row: Record<string, unknown>): InactiveRepAction {
  return {
    id: String(row.id),
    batch_id: String(row.batch_id),
    identity_key: String(row.identity_key),
    platform: row.platform as InactiveRepAction["platform"],
    account_id: String(row.account_id),
    account_email: String(row.account_email),
    status: row.status as ActionStatus,
    attempts: Number(row.attempts ?? 0),
    last_error: row.last_error == null ? null : String(row.last_error),
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    processed_at: row.processed_at == null ? null : String(row.processed_at),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function exemptionFromRow(row: Record<string, unknown>): InactiveRepExemption {
  return {
    id: String(row.id),
    identityKey: String(row.identity_key),
    displayName: String(row.display_name ?? ""),
    scope: row.scope as InactiveRepExemptionScope,
    batchId: row.batch_id == null ? null : String(row.batch_id),
    reason: String(row.reason),
    createdBy: String(row.created_by),
    active: row.active === true,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export async function listActiveInactiveRepExemptions(): Promise<InactiveRepExemption[]> {
  const { data, error } = await db()
    .from("inactive_rep_exemptions")
    .select("id,identity_key,display_name,scope,batch_id,reason,created_by,active,created_at,updated_at")
    .eq("active", true)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`inactive_rep_exemptions list failed: ${error.message}`);
  return (data ?? []).map(row => exemptionFromRow(row as Record<string, unknown>));
}

export async function listActivePersistentExemptionKeys(): Promise<Set<string>> {
  const exemptions = await listActiveInactiveRepExemptions();
  return new Set(
    exemptions
      .filter(exemption => exemption.scope === "persistent")
      .map(exemption => exemption.identityKey),
  );
}

export async function protectInactiveRep(options: {
  batchId: string;
  identityKey: string;
  scope: InactiveRepExemptionScope;
  reason: string;
  createdBy: string;
}): Promise<{ exemptionId: string; skippedActions: number }> {
  const { data, error } = await db()
    .rpc("protect_inactive_rep", {
      p_batch_id: options.batchId,
      p_identity_key: options.identityKey,
      p_scope: options.scope,
      p_reason: options.reason,
      p_created_by: options.createdBy,
    })
    .single();
  if (error) throw new Error(`Inactive-rep protection failed: ${error.message}`);
  const row = data as Record<string, unknown> | null;
  if (!row) throw new Error("Inactive-rep protection returned no result");
  return {
    exemptionId: String(row.exemption_id),
    skippedActions: Number(row.skipped_actions ?? 0),
  };
}

export async function revokeInactiveRepExemption(options: {
  exemptionId: string;
  revokedBy: string;
}): Promise<boolean> {
  const { data, error } = await db().rpc("revoke_inactive_rep_exemption", {
    p_exemption_id: options.exemptionId,
    p_revoked_by: options.revokedBy,
  });
  if (error) throw new Error(`Inactive-rep exemption revoke failed: ${error.message}`);
  return data === true;
}

export async function getBatchByReportDate(reportDate: string): Promise<InactiveRepBatch | null> {
  const { data, error } = await db()
    .from("inactive_rep_batches")
    .select("*")
    .eq("report_date", reportDate)
    .maybeSingle();
  if (error) throw new Error(`inactive_rep_batches lookup failed: ${error.message}`);
  return data ? batchFromRow(data as Record<string, unknown>) : null;
}

export async function listLatestEmailedInactiveRepBatch(): Promise<InactiveRepBatch | null> {
  const { data, error } = await db()
    .from("inactive_rep_batches")
    .select("*")
    .not("emailed_at", "is", null)
    .order("emailed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`inactive_rep_batches latest emailed lookup failed: ${error.message}`);
  return data ? batchFromRow(data as Record<string, unknown>) : null;
}

export async function createOrLoadPreparingBatch(options: {
  reportDate: string;
  subject: string;
  emailTo: string;
  criteriaVersion: string;
  result: CandidateBuildResult;
  csv: string;
}): Promise<{ batch: InactiveRepBatch; created: boolean }> {
  const existing = await getBatchByReportDate(options.reportDate);
  if (existing) return { batch: existing, created: false };
  const now = new Date().toISOString();
  const row = {
    report_date: options.reportDate,
    criteria_version: options.criteriaVersion,
    status: "preparing",
    cutoff_at: options.result.cutoffAt,
    checked_at: options.result.checkedAt,
    email_subject: options.subject,
    email_to: options.emailTo,
    candidates: options.result.candidates,
    report_csv: options.csv,
    source_summary: options.result.sourceSummary,
    errors: [],
    updated_at: now,
  };
  const { data, error } = await db().from("inactive_rep_batches").insert(row).select("*").single();
  if (!error) return { batch: batchFromRow(data as Record<string, unknown>), created: true };
  if (error.code === "23505") {
    const raced = await getBatchByReportDate(options.reportDate);
    if (raced) return { batch: raced, created: false };
  }
  throw new Error(`inactive_rep_batches insert failed: ${error.message}`);
}

export async function updateBatch(
  id: string,
  patch: Partial<{
    status: BatchStatus;
    email_subject: string;
    email_from: string | null;
    emailed_at: string | null;
    sent_message_id: string | null;
    report_csv: string;
    errors: string[];
    processing_started_at: string | null;
    completed_at: string | null;
  }>,
): Promise<void> {
  const { error } = await db()
    .from("inactive_rep_batches")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(`inactive_rep_batches update failed: ${error.message}`);
}

async function claimBatchStatus(options: {
  id: string;
  from: BatchStatus[];
  to: BatchStatus;
  processingStartedAt?: string;
}): Promise<boolean> {
  const patch: Record<string, unknown> = {
    status: options.to,
    updated_at: new Date().toISOString(),
  };
  if (options.processingStartedAt) patch.processing_started_at = options.processingStartedAt;
  const { data, error } = await db()
    .from("inactive_rep_batches")
    .update(patch)
    .eq("id", options.id)
    .in("status", options.from)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`inactive_rep_batches claim failed: ${error.message}`);
  return Boolean(data);
}

export async function claimBatchForEmail(batch: InactiveRepBatch): Promise<boolean> {
  if (["preparing", "email_failed"].includes(batch.status)) {
    return claimBatchStatus({ id: batch.id, from: [batch.status], to: "emailing" });
  }
  if (batch.status !== "emailing") return false;
  const staleBefore = new Date(Date.now() - 15 * 60_000).toISOString();
  const { data, error } = await db()
    .from("inactive_rep_batches")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", batch.id)
    .eq("status", "emailing")
    .lt("updated_at", staleBefore)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`inactive_rep_batches email recovery claim failed: ${error.message}`);
  return Boolean(data);
}

export async function claimBatchForProcessing(batch: InactiveRepBatch): Promise<boolean> {
  const startedAt = new Date().toISOString();
  if (["emailed", "partial"].includes(batch.status)) {
    return claimBatchStatus({
      id: batch.id,
      from: [batch.status],
      to: "processing",
      processingStartedAt: startedAt,
    });
  }
  if (batch.status !== "processing") return false;
  const staleBefore = new Date(Date.now() - 15 * 60_000).toISOString();
  const { data, error } = await db()
    .from("inactive_rep_batches")
    .update({ processing_started_at: startedAt, updated_at: startedAt })
    .eq("id", batch.id)
    .eq("status", "processing")
    .lt("processing_started_at", staleBefore)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`inactive_rep_batches processing recovery claim failed: ${error.message}`);
  return Boolean(data);
}

export async function listDueBatches(dueBefore: Date, limit = 5): Promise<InactiveRepBatch[]> {
  const { data, error } = await db()
    .from("inactive_rep_batches")
    .select("*")
    .in("status", ["emailed", "processing", "partial"])
    .not("emailed_at", "is", null)
    .lte("emailed_at", dueBefore.toISOString())
    .order("emailed_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`inactive_rep_batches due query failed: ${error.message}`);
  return (data ?? []).map(row => batchFromRow(row as Record<string, unknown>));
}

export async function ensureBatchActions(batch: InactiveRepBatch): Promise<void> {
  const rows = batch.candidates.flatMap(candidate =>
    candidate.targets.map(target => ({
      batch_id: batch.id,
      identity_key: candidate.identityKey,
      platform: target.platform,
      account_id: target.id,
      account_email: target.email,
      status: "pending",
      metadata: {
        emailedName: candidate.name,
        emailedRole: candidate.role,
        emailedAt: batch.emailed_at,
      },
    })),
  );
  if (!rows.length) return;
  const { error } = await db()
    .from("inactive_rep_actions")
    .upsert(rows, { onConflict: "batch_id,platform,account_id", ignoreDuplicates: true });
  if (error) throw new Error(`inactive_rep_actions upsert failed: ${error.message}`);
}

export async function listBatchActions(batchId: string): Promise<InactiveRepAction[]> {
  const { data, error } = await db()
    .from("inactive_rep_actions")
    .select("*")
    .eq("batch_id", batchId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`inactive_rep_actions list failed: ${error.message}`);
  return (data ?? []).map(row => actionFromRow(row as Record<string, unknown>));
}

function actionLogDetail(row: Record<string, unknown>): string {
  const status = row.status as ActionStatus;
  const metadata = (row.metadata as Record<string, unknown> | null) ?? {};
  const lastError = row.last_error == null ? "" : String(row.last_error);
  if (metadata.manuallyProtected === true) {
    const reason = String(metadata.protectionReason ?? "Manager confirmed the representative is active");
    const by = String(metadata.protectedBy ?? "dashboard administrator");
    return `Protected by ${by}: ${reason}`;
  }
  if (lastError) return lastError;
  if (status === "pending") return "Waiting for the review window and live revalidation";
  if (metadata.alreadyInactive === true) return "Account was already inactive at processing time";
  const removed = Number(metadata.directLicensesRemoved ?? 0);
  if (metadata.alreadyDisabled === true) {
    return removed > 0
      ? `${removed} direct Microsoft license${removed === 1 ? "" : "s"} removed; account was already disabled`
      : "Microsoft account was already disabled";
  }
  if (removed > 0) {
    return `${removed} direct Microsoft license${removed === 1 ? "" : "s"} removed; account disabled and verified`;
  }
  if (metadata.verifiedDisabled === true) return "Microsoft account disabled and verified";
  if (metadata.verifiedArchived === true) return "Terros account archived and verified";
  if (metadata.verifiedActive === false) return "Enerflo account deactivated and verified";
  if (status === "success") return "Account deactivation completed and verified";
  if (status === "skipped") return "Skipped during live revalidation";
  if (status === "blocked") return "Blocked during account deactivation";
  return "Account deactivation failed";
}

export async function listInactiveRepAutomationLogs(limit = 30): Promise<InactiveRepAutomationLogs> {
  const safeLimit = Math.max(1, Math.min(90, Math.trunc(limit)));
  const { data: batchRows, error: batchError } = await db()
    .from("inactive_rep_batches")
    .select(
      "id,report_date,status,email_subject,email_from,email_to,emailed_at,candidates,errors,completed_at",
    )
    .order("report_date", { ascending: false })
    .limit(safeLimit);
  if (batchError) throw new Error(`inactive_rep_batches log query failed: ${batchError.message}`);

  const rows = (batchRows ?? []) as Record<string, unknown>[];
  const ids = rows.map(row => String(row.id));
  const { data: actionRows, error: actionError } = ids.length
    ? await db()
        .from("inactive_rep_actions")
        .select(
          "id,batch_id,identity_key,platform,account_id,account_email,status,attempts,last_error,metadata,processed_at,created_at",
        )
        .in("batch_id", ids)
        .order("created_at", { ascending: false })
    : { data: [], error: null };
  if (actionError) throw new Error(`inactive_rep_actions log query failed: ${actionError.message}`);

  const reportDateByBatch = new Map(rows.map(row => [String(row.id), String(row.report_date)]));
  const actionCountByBatch = new Map<string, number>();
  for (const row of actionRows ?? []) {
    const batchId = String(row.batch_id);
    actionCountByBatch.set(batchId, (actionCountByBatch.get(batchId) ?? 0) + 1);
  }

  const batches: InactiveRepBatchLog[] = rows.map(row => {
    const emailedAt = row.emailed_at == null ? null : String(row.emailed_at);
    const candidates = Array.isArray(row.candidates) ? (row.candidates as InactiveRepCandidate[]) : [];
    const targetCount = candidates.reduce((sum, candidate) => sum + candidate.targets.length, 0);
    return {
      id: String(row.id),
      reportDate: String(row.report_date),
      status: row.status as BatchStatus,
      subject: String(row.email_subject),
      from: row.email_from == null ? null : String(row.email_from),
      recipients: inactiveRepReportRecipients(String(row.email_to)),
      emailedAt,
      deactivationDueAt: emailedAt
        ? new Date(
            Date.parse(emailedAt) + INACTIVE_REP_DEACTIVATION_DELAY_HOURS * 60 * 60 * 1_000,
          ).toISOString()
        : null,
      completedAt: row.completed_at == null ? null : String(row.completed_at),
      candidateCount: candidates.length,
      accountCount: actionCountByBatch.get(String(row.id)) ?? targetCount,
      errors: Array.isArray(row.errors) ? row.errors.map(String) : [],
    };
  });

  const accounts: InactiveRepAccountLog[] = (actionRows ?? []).map(row => {
    const metadata = (row.metadata as Record<string, unknown> | null) ?? {};
    const batchId = String(row.batch_id);
    return {
      id: String(row.id),
      batchId,
      reportDate: reportDateByBatch.get(batchId) ?? "",
      repName: String(metadata.emailedName ?? "Unknown representative"),
      repRole: String(metadata.emailedRole ?? ""),
      identityKey: String(row.identity_key),
      platform: row.platform as InactiveRepAccountLog["platform"],
      accountId: String(row.account_id),
      accountEmail: String(row.account_email),
      status: row.status as ActionStatus,
      alreadyInactive: metadata.alreadyInactive === true || metadata.alreadyDisabled === true,
      manuallyProtected: metadata.manuallyProtected === true,
      protectionScope: metadata.protectionScope === "batch" || metadata.protectionScope === "persistent"
        ? metadata.protectionScope
        : null,
      protectionReason: metadata.protectionReason == null ? null : String(metadata.protectionReason),
      protectedBy: metadata.protectedBy == null ? null : String(metadata.protectedBy),
      protectedAt: metadata.protectedAt == null ? null : String(metadata.protectedAt),
      attempts: Number(row.attempts ?? 0),
      detail: actionLogDetail(row as Record<string, unknown>),
      processedAt: row.processed_at == null ? null : String(row.processed_at),
      createdAt: String(row.created_at),
    };
  });

  const exemptions = await listActiveInactiveRepExemptions();

  return {
    fetchedAt: new Date().toISOString(),
    deactivationEnabled: env.inactiveRepDeactivationEnabled,
    batches,
    accounts,
    exemptions,
  };
}

export async function updateAction(
  id: string,
  patch: Partial<{
    status: ActionStatus;
    attempts: number;
    last_error: string | null;
    metadata: Record<string, unknown>;
    processed_at: string | null;
  }>,
): Promise<void> {
  const { error } = await db()
    .from("inactive_rep_actions")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(`inactive_rep_actions update failed: ${error.message}`);
}
