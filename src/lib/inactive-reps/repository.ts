import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import type {
  ActionStatus,
  BatchStatus,
  CandidateBuildResult,
  InactiveRepAction,
  InactiveRepBatch,
  InactiveRepCandidate,
} from "@/lib/inactive-reps/types";

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

export async function getBatchByReportDate(reportDate: string): Promise<InactiveRepBatch | null> {
  const { data, error } = await db()
    .from("inactive_rep_batches")
    .select("*")
    .eq("report_date", reportDate)
    .maybeSingle();
  if (error) throw new Error(`inactive_rep_batches lookup failed: ${error.message}`);
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
    email_from: string | null;
    emailed_at: string | null;
    sent_message_id: string | null;
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
