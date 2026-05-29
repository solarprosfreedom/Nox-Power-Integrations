import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import { normalizeEmail } from "@/lib/onboarding/normalize";
import type { JobStatus, OnboardingJob, SequifiUserRecord, StepStatus } from "@/lib/onboarding/types";

let _client: SupabaseClient | null = null;

function getClient(): SupabaseClient | null {
  if (_client) return _client;
  const url = env.supabaseUrl?.trim();
  const key = env.supabaseServiceRoleKey?.trim();
  if (!url || !key) return null;
  _client = createClient(url, key);
  return _client;
}

function rowToJob(row: Record<string, unknown>): OnboardingJob {
  return {
    id: String(row.id),
    sequifi_user_id: String(row.sequifi_user_id),
    sequifi_employee_id: String(row.sequifi_employee_id),
    email: String(row.email),
    email_normalized: String(row.email_normalized),
    first_name: row.first_name != null ? String(row.first_name) : null,
    last_name: row.last_name != null ? String(row.last_name) : null,
    phone: row.phone != null ? String(row.phone) : null,
    role_label: row.role_label != null ? String(row.role_label) : null,
    welcome_email_to: row.welcome_email_to != null ? String(row.welcome_email_to) : null,
    raw_sequifi_payload: (row.raw_sequifi_payload as Record<string, unknown>) ?? {},
    status: row.status as JobStatus,
    microsoft_status: row.microsoft_status as StepStatus,
    enerflo_status: row.enerflo_status as StepStatus,
    terros_status: row.terros_status as StepStatus,
    welcome_email_status: row.welcome_email_status as StepStatus,
    microsoft_user_id: row.microsoft_user_id != null ? String(row.microsoft_user_id) : null,
    microsoft_upn: row.microsoft_upn != null ? String(row.microsoft_upn) : null,
    enerflo_user_id: row.enerflo_user_id != null ? String(row.enerflo_user_id) : null,
    terros_user_id: row.terros_user_id != null ? String(row.terros_user_id) : null,
    temp_password: row.temp_password != null ? String(row.temp_password) : null,
    last_error: row.last_error != null ? String(row.last_error) : null,
    step_errors: (row.step_errors as Record<string, string>) ?? {},
    attempt_count: Number(row.attempt_count ?? 0),
    next_retry_at: row.next_retry_at != null ? String(row.next_retry_at) : null,
    max_attempts: Number(row.max_attempts ?? 5),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    completed_at: row.completed_at != null ? String(row.completed_at) : null,
  };
}

export function isOnboardingRepositoryConfigured(): boolean {
  return Boolean(getClient());
}

function isMissingOnboardingTableError(message: string): boolean {
  return (
    message.includes("Could not find the table") ||
    message.includes("onboarding_jobs") && message.includes("schema cache")
  );
}

export async function listOnboardingJobs(limit = 100): Promise<OnboardingJob[]> {
  const result = await listOnboardingJobsSafe(limit);
  if (!result.tableReady && result.error) {
    throw new Error(result.error);
  }
  return result.jobs;
}

/** Returns empty jobs when the table has not been migrated yet — does not throw. */
export async function listOnboardingJobsSafe(limit = 100): Promise<{
  jobs: OnboardingJob[];
  tableReady: boolean;
  error?: string;
}> {
  const db = getClient();
  if (!db) return { jobs: [], tableReady: false, error: "Supabase not configured" };
  const { data, error } = await db
    .from("onboarding_jobs")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) {
    const msg = `onboarding_jobs list failed: ${error.message}`;
    if (isMissingOnboardingTableError(error.message)) {
      return { jobs: [], tableReady: false, error: msg };
    }
    throw new Error(msg);
  }
  return {
    jobs: (data ?? []).map(r => rowToJob(r as Record<string, unknown>)),
    tableReady: true,
  };
}

export async function getJobsBySequifiUserIds(ids: string[]): Promise<Map<string, OnboardingJob>> {
  const db = getClient();
  const map = new Map<string, OnboardingJob>();
  if (!db || !ids.length) return map;
  const { data, error } = await db
    .from("onboarding_jobs")
    .select("*")
    .in("sequifi_user_id", ids);
  if (error) throw new Error(`onboarding_jobs lookup failed: ${error.message}`);
  for (const row of data ?? []) {
    const job = rowToJob(row as Record<string, unknown>);
    map.set(job.sequifi_user_id, job);
  }
  return map;
}

export async function getRetryCandidates(now = new Date()): Promise<OnboardingJob[]> {
  const db = getClient();
  if (!db) return [];
  const { data, error } = await db
    .from("onboarding_jobs")
    .select("*")
    .in("status", ["partial", "failed"])
    .lte("next_retry_at", now.toISOString())
    .lt("attempt_count", 5)
    .order("next_retry_at", { ascending: true })
    .limit(20);
  if (error) throw new Error(`onboarding_jobs retry query failed: ${error.message}`);
  return (data ?? []).map(r => rowToJob(r as Record<string, unknown>));
}

export async function insertJobFromSequifiUser(user: SequifiUserRecord): Promise<OnboardingJob | null> {
  const db = getClient();
  if (!db) throw new Error("Supabase not configured for onboarding_jobs");

  const emailNorm = normalizeEmail(user.email);
  const welcomeTo =
    String(user.raw.personal_email ?? user.raw.personalEmail ?? user.email).trim() || user.email;

  const { data, error } = await db
    .from("onboarding_jobs")
    .insert({
      sequifi_user_id: String(user.id),
      sequifi_employee_id: user.employee_id,
      email: user.email,
      email_normalized: emailNorm,
      first_name: user.first_name || null,
      last_name: user.last_name || null,
      phone: user.mobile_no || null,
      role_label: user.position_name || user.office_name || null,
      welcome_email_to: welcomeTo,
      raw_sequifi_payload: user.raw,
      status: "pending",
    })
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") return null;
    throw new Error(`onboarding_jobs insert failed: ${error.message}`);
  }
  return rowToJob(data as Record<string, unknown>);
}

export async function markJobProcessing(id: string): Promise<void> {
  const db = getClient();
  if (!db) return;
  await db
    .from("onboarding_jobs")
    .update({ status: "processing", updated_at: new Date().toISOString() })
    .eq("id", id);
}

export async function updateJobStep(
  id: string,
  patch: Partial<{
    microsoft_status: StepStatus;
    enerflo_status: StepStatus;
    terros_status: StepStatus;
    welcome_email_status: StepStatus;
    microsoft_user_id: string;
    microsoft_upn: string;
    enerflo_user_id: string;
    terros_user_id: string;
    temp_password: string;
    step_errors: Record<string, string>;
    last_error: string | null;
    status: JobStatus;
    attempt_count: number;
    next_retry_at: string | null;
    completed_at: string | null;
  }>,
): Promise<void> {
  const db = getClient();
  if (!db) return;
  await db
    .from("onboarding_jobs")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
}

export async function loadJobById(id: string): Promise<OnboardingJob | null> {
  const db = getClient();
  if (!db) return null;
  const { data, error } = await db.from("onboarding_jobs").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? rowToJob(data as Record<string, unknown>) : null;
}
