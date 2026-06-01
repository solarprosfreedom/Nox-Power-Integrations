import { env } from "@/lib/env";
import {
  auroraEmailFromName,
  normalizeEmail,
} from "@/lib/onboarding/normalize";
import {
  createEnerfloUserForOnboarding,
  findEnerfloUserByEmail,
} from "@/lib/onboarding/enerflo-user";
import {
  loadJobById,
  markJobProcessing,
  updateJobStep,
} from "@/lib/onboarding/repository";
import { resolveRoleMapping } from "@/lib/onboarding/role-map";
import {
  createTerrosUserForOnboarding,
  findTerrosUserByEmail,
} from "@/lib/onboarding/terros-user";
import { filterSequifiUsersNeedingProvisioning, classifyMicrosoftForSequifiUser, needsMicrosoftProvisioning } from "@/lib/onboarding/microsoft-gap-scan";
import type { OnboardingJob, OnboardingRunSummary, ProvisionBulkResult, ProvisionUserResult, SequifiUserRecord } from "@/lib/onboarding/types";
import { renderWelcomeTemplate } from "@/lib/onboarding/welcome-templates";
import {
  createGraphUser,
  findGraphUserByEmailOrUpn,
  findGraphUserByUpn,
  GraphUserPermissionError,
  resolveUpnForUser,
} from "@/lib/microsoft/graph-users";
import { sendMailAsUser, isGraphMailConfigured } from "@/lib/microsoft/graph-mail";
import { fetchAllSequifiUsers, filterUsersByGoLive } from "@/lib/sequifi/client";
import {
  appendSequifiUserToInstallerRosterSheets,
  sequifiUserFromOnboardingJob,
} from "@/lib/google-sheets/sync-roster";
import { isGoogleSheetsConfigured } from "@/lib/google-sheets/client";
import { appendSequifiUserToInstallerSharePointRosters, isSharePointRosterConfigured } from "@/lib/sharepoint/sync-roster";
import { parseSequifiFields } from "@/lib/onboarding/sequifi-fields";
import { filterExcludedSequifiUsers, isSequifiUserExcluded } from "@/lib/onboarding/exclude";
import {
  getJobsBySequifiUserIds,
  getRetryCandidates,
  insertJobFromSequifiUser,
  isOnboardingRepositoryConfigured,
  listOnboardingJobsSafe,
} from "@/lib/onboarding/repository";

function backoffMs(attempt: number): number {
  return Math.min(60_000 * 2 ** attempt, 3_600_000);
}

function allStepsSuccess(job: OnboardingJob): boolean {
  return (
    job.microsoft_status === "success" &&
    job.enerflo_status === "success" &&
    job.terros_status === "success" &&
    job.welcome_email_status === "success"
  );
}

function finalizeStatus(job: OnboardingJob): {
  status: OnboardingJob["status"];
  next_retry_at: string | null;
  completed_at: string | null;
} {
  if (allStepsSuccess(job)) {
    return { status: "completed", next_retry_at: null, completed_at: new Date().toISOString() };
  }
  const anyFailed =
    job.microsoft_status === "failed" ||
    job.enerflo_status === "failed" ||
    job.terros_status === "failed" ||
    job.welcome_email_status === "failed";
  if (anyFailed && job.attempt_count >= job.max_attempts) {
    return { status: "failed", next_retry_at: null, completed_at: null };
  }
  if (anyFailed) {
    return {
      status: "partial",
      next_retry_at: new Date(Date.now() + backoffMs(job.attempt_count)).toISOString(),
      completed_at: null,
    };
  }
  return { status: "partial", next_retry_at: null, completed_at: null };
}

async function ensureJobForSequifiUser(user: SequifiUserRecord): Promise<OnboardingJob | null> {
  const existing = await getJobsBySequifiUserIds([String(user.id)]);
  const job = existing.get(String(user.id));
  if (job) return job;
  return insertJobFromSequifiUser(user);
}

export async function getSequifiUsersNeedingProvisioning(): Promise<{
  polled: number;
  goLiveFiltered: number;
  excludeFiltered: number;
  users: SequifiUserRecord[];
}> {
  const all = await fetchAllSequifiUsers();
  const hired = filterUsersByGoLive(all);
  const eligible = filterExcludedSequifiUsers(hired);
  const users = await filterSequifiUsersNeedingProvisioning(eligible);
  return {
    polled: hired.length,
    goLiveFiltered: all.length - hired.length,
    excludeFiltered: hired.length - eligible.length,
    users,
  };
}

function summarizeJobResult(result: OnboardingJob | null): "completed" | "partial" | "failed" | "skipped" {
  if (!result) return "skipped";
  if (result.status === "completed") return "completed";
  if (result.status === "failed") return "failed";
  if (result.status === "partial") return "partial";
  return "skipped";
}

export async function provisionSequifiUserById(sequifiUserId: number): Promise<ProvisionUserResult> {
  if (!isOnboardingRepositoryConfigured()) {
    return {
      sequifiUserId,
      ok: false,
      skipped: true,
      reason: "Supabase onboarding_jobs not configured",
      job: null,
      error: "Run supabase/migrations/001_onboarding_jobs.sql",
    };
  }

  try {
    const all = filterUsersByGoLive(await fetchAllSequifiUsers());
    const user = all.find(u => u.id === sequifiUserId);
    if (!user) {
      return {
        sequifiUserId,
        ok: false,
        skipped: true,
        reason: "Not found in hired Sequifi users (GET /v1/users)",
        job: null,
      };
    }

    if (isSequifiUserExcluded(user)) {
      return {
        sequifiUserId,
        ok: false,
        skipped: true,
        reason: "Excluded (temporary test blocklist)",
        job: null,
      };
    }

    const priorJobs = await getJobsBySequifiUserIds([String(user.id)]);
    const priorJob = priorJobs.get(String(user.id));

    const gap = await classifyMicrosoftForSequifiUser(user);
    if (!needsMicrosoftProvisioning(gap.status)) {
      const incompleteJob =
        priorJob && priorJob.status !== "completed" && priorJob.status !== "skipped";
      if (!incompleteJob) {
        return {
          sequifiUserId,
          ok: true,
          skipped: true,
          reason: "Already has member @noxpwr.com account",
          job: priorJob ?? null,
        };
      }
    }

    const job = priorJob ?? (await ensureJobForSequifiUser(user));
    if (!job) {
      return {
        sequifiUserId,
        ok: false,
        skipped: true,
        reason: "Could not create onboarding job (check Supabase onboarding_jobs)",
        job: null,
      };
    }

    if (job.status === "completed") {
      return {
        sequifiUserId,
        ok: true,
        skipped: true,
        reason: "Onboarding already completed",
        job,
      };
    }

    if (env.onboardingDryRun) {
      return {
        sequifiUserId,
        ok: true,
        skipped: false,
        reason: "Dry run — job queued, no accounts created",
        job,
      };
    }

    const updated = await runOnboardingJob(job.id);
    const outcome = summarizeJobResult(updated);
    return {
      sequifiUserId,
      ok: outcome === "completed" || outcome === "partial",
      skipped: false,
      job: updated,
      error: outcome === "failed" ? updated?.last_error ?? "Provisioning failed" : undefined,
    };
  } catch (e) {
    return {
      sequifiUserId,
      ok: false,
      skipped: false,
      job: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function mapWithConcurrencyLimit<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency = 3,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
  }
  return results;
}

export async function provisionSequifiUsersBulk(
  sequifiUserIds: number[],
): Promise<ProvisionBulkResult> {
  const unique = [...new Set(sequifiUserIds)];
  const results = await mapWithConcurrencyLimit(unique, id => provisionSequifiUserById(id), 3);

  const summary: ProvisionBulkResult = {
    results,
    completed: 0,
    partial: 0,
    failed: 0,
    skipped: 0,
    dryRun: env.onboardingDryRun,
    errors: [],
  };

  for (const r of results) {
    if (r.skipped) {
      summary.skipped++;
      continue;
    }
    const outcome = summarizeJobResult(r.job);
    if (outcome === "completed") summary.completed++;
    else if (outcome === "partial") summary.partial++;
    else if (outcome === "failed") summary.failed++;
    if (r.error) summary.errors.push(`User ${r.sequifiUserId}: ${r.error}`);
  }

  return summary;
}

export async function runOnboardingJob(jobId: string): Promise<OnboardingJob | null> {
  let job = await loadJobById(jobId);
  if (!job || job.status === "completed" || job.status === "skipped") return job;

  const dryRun = env.onboardingDryRun;
  await markJobProcessing(job.id);
  job = (await loadJobById(jobId)) ?? job;

  const stepErrors = { ...job.step_errors };
  const role = resolveRoleMapping(job.role_label, env.onboardingRoleMapJson);
  const upn = job.microsoft_upn ?? resolveUpnForUser(job.email, job.first_name ?? "", job.last_name ?? "");
  let tempPassword =
    job.temp_password ?? (env.onboardingDefaultPassword?.trim() || "Solar123");

  // Microsoft
  if (job.microsoft_status !== "success") {
    try {
      if (dryRun) {
        await updateJobStep(job.id, { microsoft_status: "skipped", microsoft_upn: upn });
      } else {
        const existing = await findGraphUserByUpn(upn);
        if (existing) {
          await updateJobStep(job.id, {
            microsoft_status: "success",
            microsoft_user_id: existing.id,
            microsoft_upn: existing.userPrincipalName,
            temp_password: tempPassword,
          });
        } else {
          const created = await createGraphUser({
            upn,
            firstName: job.first_name ?? "",
            lastName: job.last_name ?? "",
            displayName: [job.first_name, job.last_name].filter(Boolean).join(" ") || upn,
            password: tempPassword,
          });
          await updateJobStep(job.id, {
            microsoft_status: "success",
            microsoft_user_id: created.id,
            microsoft_upn: created.userPrincipalName,
            temp_password: tempPassword,
          });
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      stepErrors.microsoft = msg;
      await updateJobStep(job.id, {
        microsoft_status: "failed",
        step_errors: stepErrors,
        last_error: msg,
        attempt_count: job.attempt_count + 1,
      });
    }
  }

  job = (await loadJobById(jobId)) ?? job;
  const workEmail = job.microsoft_upn ?? upn;
  const sequifiFields = parseSequifiFields(job.raw_sequifi_payload ?? {});
  const platformEmail = sequifiFields.onboardAxia
    ? auroraEmailFromName(job.first_name ?? "", job.last_name ?? "")
    : workEmail;

  // Enerflo
  if (job.enerflo_status !== "success") {
    try {
      if (dryRun) {
        await updateJobStep(job.id, { enerflo_status: "skipped" });
      } else {
        const existing = await findEnerfloUserByEmail(platformEmail);
        if (existing) {
          await updateJobStep(job.id, {
            enerflo_status: "success",
            enerflo_user_id: existing.id,
          });
        } else {
          const result = await createEnerfloUserForOnboarding({
            email: platformEmail,
            first_name: job.first_name ?? "",
            last_name: job.last_name ?? "",
            phone: job.phone ?? undefined,
            roles: role.enerfloRoles,
            external_user_id: job.sequifi_employee_id,
            password: tempPassword,
          });
          if (!result.ok) throw new Error(result.error ?? "Enerflo create failed");
          await updateJobStep(job.id, {
            enerflo_status: "success",
            enerflo_user_id: result.id ?? undefined,
          });
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      stepErrors.enerflo = msg;
      await updateJobStep(job.id, {
        enerflo_status: "failed",
        step_errors: stepErrors,
        last_error: msg,
        attempt_count: job.attempt_count + 1,
      });
    }
  }

  job = (await loadJobById(jobId)) ?? job;

  // Terros
  if (job.terros_status !== "success") {
    try {
      if (dryRun) {
        await updateJobStep(job.id, { terros_status: "skipped" });
      } else {
        const existing = await findTerrosUserByEmail(platformEmail);
        if (existing) {
          await updateJobStep(job.id, {
            terros_status: "success",
            terros_user_id: existing.userId,
          });
        } else {
          const result = await createTerrosUserForOnboarding({
            email: platformEmail,
            firstName: job.first_name ?? "",
            lastName: job.last_name ?? "",
            phone: job.phone ?? undefined,
            password: tempPassword,
            roles: role.terrosRoles,
            sendWelcomeEmail: true,
          });
          if (!result.ok) throw new Error(result.error ?? "Terros create failed");
          await updateJobStep(job.id, {
            terros_status: "success",
            terros_user_id: result.userId ?? undefined,
          });
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      stepErrors.terros = msg;
      await updateJobStep(job.id, {
        terros_status: "failed",
        step_errors: stepErrors,
        last_error: msg,
        attempt_count: job.attempt_count + 1,
      });
    }
  }

  job = (await loadJobById(jobId)) ?? job;

  // Welcome email
  if (job.welcome_email_status !== "success") {
    try {
      if (dryRun || !isGraphMailConfigured()) {
        await updateJobStep(job.id, {
          welcome_email_status: dryRun ? "skipped" : "failed",
          ...(dryRun
            ? {}
            : {
                step_errors: { ...stepErrors, welcome_email: "Graph mail not configured" },
                last_error: "Graph mail not configured",
              }),
        });
      } else {
        const to = (job.welcome_email_to ?? job.email).trim();
        const password = job.temp_password ?? tempPassword;
        const { subject, body } = renderWelcomeTemplate(role.welcomeTemplate, {
          username: workEmail,
          password,
          auroraEmail: auroraEmailFromName(job.first_name ?? "", job.last_name ?? ""),
        });
        await sendMailAsUser({ to, subject, body, contentType: "text" });
        await updateJobStep(job.id, { welcome_email_status: "success" });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      stepErrors.welcome_email = msg;
      await updateJobStep(job.id, {
        welcome_email_status: "failed",
        step_errors: stepErrors,
        last_error: msg,
        attempt_count: job.attempt_count + 1,
      });
    }
  }

  job = (await loadJobById(jobId)) ?? job;
  const fin = finalizeStatus(job);
  await updateJobStep(job.id, fin);
  job = (await loadJobById(jobId)) ?? job;

  if (job && !dryRun && job.microsoft_status === "success") {
    const sheet = await appendJobToOnboardingRosterSheet(job);
    const rosterErrors = { ...job.step_errors };
    if (sheet.errors.length) {
      rosterErrors.google_sheets = sheet.errors.join("; ");
    } else if (sheet.appended > 0) {
      rosterErrors.google_sheets = `appended:${sheet.appended}`;
    } else if (sheet.skipped > 0) {
      rosterErrors.google_sheets = "already in sheet";
    } else if (!parseSequifiFields(job.raw_sequifi_payload ?? {}).installerTabs.length) {
      rosterErrors.google_sheets = "no installer tabs";
    }
    if (Object.keys(rosterErrors).length) {
      await updateJobStep(job.id, { step_errors: rosterErrors });
    }
    job = (await loadJobById(jobId)) ?? job;
  }

  return job;
}

async function appendJobToOnboardingRosterSheet(
  job: OnboardingJob,
): Promise<{ appended: number; skipped: number; errors: string[] }> {
  if (env.onboardingDryRun || job.microsoft_status !== "success") {
    return { appended: 0, skipped: 0, errors: [] };
  }

  const sequifiUser = sequifiUserFromOnboardingJob(job);
  const parsed = parseSequifiFields(job.raw_sequifi_payload ?? {});
  const installerTabs = parsed.installerTabs;

  if (!installerTabs.length) {
    return { appended: 0, skipped: 1, errors: [] };
  }

  const workEmail = job.microsoft_upn ?? "";
  const platformEmail = parsed.onboardAxia
    ? auroraEmailFromName(job.first_name ?? "", job.last_name ?? "")
    : workEmail;
  const ctx = { workEmail, noxEmail: platformEmail };

  let appended = 0;
  let skipped = 0;
  const errors: string[] = [];

  if (isGoogleSheetsConfigured()) {
    try {
      const sheetResults = await appendSequifiUserToInstallerRosterSheets({
        tabNames: installerTabs,
        user: sequifiUser,
        ctx,
      });
      for (const r of sheetResults) {
        if (r.appended) appended++;
        else if (r.reason === "already in sheet") skipped++;
        else if (r.reason) errors.push(`Google ${r.tabName}: ${r.reason}`);
      }
    } catch (e) {
      errors.push(`Google Sheets: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (isSharePointRosterConfigured()) {
    try {
      const spResults = await appendSequifiUserToInstallerSharePointRosters({
        tabNames: installerTabs,
        user: sequifiUser,
        ctx,
      });
      for (const r of spResults) {
        if (r.appended) appended++;
        else if (r.reason === "already in sheet") skipped++;
        else if (r.reason && r.reason !== "sharepoint not configured") {
          errors.push(`SharePoint ${r.worksheetName}: ${r.reason}`);
        }
      }
    } catch (e) {
      errors.push(`SharePoint: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { appended, skipped, errors };
}

export async function runOnboardingCycle(options?: {
  limit?: number;
}): Promise<OnboardingRunSummary> {
  const summary: OnboardingRunSummary = {
    polled: 0,
    excludeFiltered: 0,
    gapNeed: 0,
    newJobs: 0,
    retried: 0,
    completed: 0,
    partial: 0,
    failed: 0,
    skipped: 0,
    dryRun: env.onboardingDryRun,
    sheetsAppended: 0,
    sheetsSkipped: 0,
    sheetsErrors: [],
    errors: [],
  };

  if (!isOnboardingRepositoryConfigured()) {
    summary.errors.push(
      "Supabase not configured or onboarding_jobs table missing. Run supabase/migrations/001_onboarding_jobs.sql"
    );
    return summary;
  }

  try {
    const { polled, excludeFiltered, users: gapUsers } = await getSequifiUsersNeedingProvisioning();
    summary.polled = polled;
    summary.excludeFiltered = excludeFiltered;
    summary.gapNeed = gapUsers.length;

    const ids = gapUsers.map(u => String(u.id));
    const existing = await getJobsBySequifiUserIds(ids);

    const toProcess: string[] = [];

    for (const user of gapUsers) {
      const sid = String(user.id);
      const prior = existing.get(sid);
      if (!prior) {
        const inserted = await insertJobFromSequifiUser(user);
        if (inserted) {
          summary.newJobs++;
          toProcess.push(inserted.id);
        } else {
          summary.skipped++;
        }
      } else if (prior.status !== "completed" && prior.status !== "skipped") {
        toProcess.push(prior.id);
      } else {
        summary.skipped++;
      }
    }

    const retries = await getRetryCandidates();
    for (const job of retries) {
      if (isSequifiUserExcluded({ id: job.sequifi_user_id })) {
        summary.skipped++;
        continue;
      }
      if (!toProcess.includes(job.id)) {
        summary.retried++;
        toProcess.push(job.id);
      }
    }

    const limit = options?.limit ?? 10;
    if (env.onboardingDryRun) {
      return summary;
    }

    for (const jobId of toProcess.slice(0, limit)) {
      try {
        const result = await runOnboardingJob(jobId);
        const outcome = summarizeJobResult(result);
        if (outcome === "completed") summary.completed++;
        else if (outcome === "failed") summary.failed++;
        else if (outcome === "partial") summary.partial++;
        else summary.skipped++;

        if (result?.step_errors?.google_sheets?.startsWith("appended:")) {
          summary.sheetsAppended++;
        } else if (
          result?.step_errors?.google_sheets &&
          result.step_errors.google_sheets !== "already in sheet" &&
          result.step_errors.google_sheets !== "no installer tabs"
        ) {
          summary.sheetsErrors.push(result.step_errors.google_sheets);
        } else if (result?.microsoft_status === "success") {
          summary.sheetsSkipped++;
        }
      } catch (e) {
        summary.errors.push(e instanceof Error ? e.message : String(e));
      }
    }
  } catch (e) {
    summary.errors.push(e instanceof Error ? e.message : String(e));
  }

  return summary;
}

export async function previewOnboardingFromSequifi(): Promise<{
  users: Awaited<ReturnType<typeof fetchAllSequifiUsers>>;
  jobs: OnboardingJob[];
  jobsTableReady?: boolean;
  goLiveFiltered: number;
  dryRun: boolean;
  error?: string;
}> {
  try {
    const all = await fetchAllSequifiUsers();
    const filtered = filterUsersByGoLive(all);
    const jobResult = await listOnboardingJobsSafe(200);
    return {
      users: filtered,
      jobs: jobResult.jobs,
      jobsTableReady: jobResult.tableReady,
      goLiveFiltered: all.length - filtered.length,
      dryRun: env.onboardingDryRun,
    };
  } catch (e) {
    return {
      users: [],
      jobs: [],
      goLiveFiltered: 0,
      dryRun: env.onboardingDryRun,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function checkUserExistence(email: string): Promise<{
  email: string;
  normalized: string;
  microsoft: boolean;
  microsoftStatus: "exists" | "missing" | "unknown";
  enerflo: boolean;
  enerfloStatus: "exists" | "alias" | "missing";
  enerfloMatchedEmail?: string;
  terros: boolean;
  terrosStatus: "exists" | "alias" | "missing";
  terrosMatchedEmail?: string;
  microsoftUpn?: string;
  enerfloId?: string;
  terrosId?: string;
  errors: string[];
}> {
  const normalized = normalizeEmail(email);
  const errors: string[] = [];
  let microsoft = false;
  let microsoftStatus: "exists" | "missing" | "unknown" = "unknown";
  let enerflo = false;
  let enerfloStatus: "exists" | "alias" | "missing" = "missing";
  let enerfloMatchedEmail: string | undefined;
  let terros = false;
  let terrosStatus: "exists" | "alias" | "missing" = "missing";
  let terrosMatchedEmail: string | undefined;
  let microsoftUpn: string | undefined;
  let enerfloId: string | undefined;
  let terrosId: string | undefined;

  try {
    const ms = await findGraphUserByEmailOrUpn(normalized, { upn: normalized });
    if (ms) {
      microsoft = true;
      microsoftStatus = "exists";
      microsoftUpn = ms.userPrincipalName;
    } else {
      microsoftStatus = "missing";
    }
  } catch (e) {
    if (e instanceof GraphUserPermissionError) {
      errors.push(
        "Microsoft: cannot verify — add User.Read.All (and User.ReadWrite.All to create users) to the Azure app, then grant admin consent.",
      );
    } else {
      errors.push(`Microsoft: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  try {
    const en = await findEnerfloUserByEmail(email);
    if (en) {
      enerflo = true;
      enerfloId = en.id;
      enerfloMatchedEmail = en.email;
      enerfloStatus = en.exactMatch ? "exists" : "alias";
    }
  } catch (e) {
    errors.push(`Enerflo: ${e instanceof Error ? e.message : String(e)}`);
  }

  try {
    const tr = await findTerrosUserByEmail(email);
    if (tr) {
      terros = true;
      terrosId = tr.userId;
      terrosMatchedEmail = tr.email;
      terrosStatus = tr.exactMatch ? "exists" : "alias";
    }
  } catch (e) {
    errors.push(`Terros: ${e instanceof Error ? e.message : String(e)}`);
  }

  return {
    email,
    normalized,
    microsoft,
    microsoftStatus,
    enerflo,
    enerfloStatus,
    enerfloMatchedEmail,
    terros,
    terrosStatus,
    terrosMatchedEmail,
    microsoftUpn,
    enerfloId,
    terrosId,
    errors,
  };
}
