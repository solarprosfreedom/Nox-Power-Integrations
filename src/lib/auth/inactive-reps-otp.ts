import { randomInt, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { inactiveRepHmacHex } from "@/lib/auth/inactive-reps";
import { env } from "@/lib/env";

export const INACTIVE_REPS_OTP_COOKIE = "inactive_reps_otp_challenge";
export const INACTIVE_REPS_OTP_TTL_SECONDS = 10 * 60;
export const INACTIVE_REPS_OTP_RESEND_SECONDS = 60;
export const INACTIVE_REPS_OTP_MAX_ATTEMPTS = 5;

type OtpVerificationResult = "verified" | "invalid" | "expired" | "locked" | "used";

let client: SupabaseClient | null = null;

function db(): SupabaseClient {
  if (client) return client;
  const url = env.supabaseUrl?.trim();
  const key = env.supabaseServiceRoleKey?.trim();
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

export function inactiveRepOtpStoreIsConfigured(): boolean {
  return Boolean(env.supabaseUrl?.trim() && env.supabaseServiceRoleKey?.trim());
}

export function generateInactiveRepOtpCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export async function hashInactiveRepOtpCode(challengeId: string, code: string): Promise<string> {
  return inactiveRepHmacHex(`inactive-reps-otp:${challengeId}:${code}`);
}

export async function createInactiveRepOtpChallenge(options: {
  email: string;
  code: string;
}): Promise<{ challengeId: string; created: boolean }> {
  const challengeId = randomUUID();
  const codeHash = await hashInactiveRepOtpCode(challengeId, options.code);
  const expiresAt = new Date(Date.now() + INACTIVE_REPS_OTP_TTL_SECONDS * 1_000).toISOString();
  const { data, error } = await db().rpc("create_inactive_rep_otp_challenge", {
    p_challenge_id: challengeId,
    p_email: options.email.trim().toLowerCase(),
    p_code_hash: codeHash,
    p_expires_at: expiresAt,
  });
  if (error) throw new Error(`Inactive-rep OTP challenge creation failed: ${error.message}`);
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (!row?.challenge_id) throw new Error("Inactive-rep OTP challenge creation returned no result");
  return { challengeId: String(row.challenge_id), created: row.created === true };
}

export async function cancelInactiveRepOtpChallenge(challengeId: string): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await db()
    .from("inactive_rep_otp_challenges")
    .update({ consumed_at: now })
    .eq("id", challengeId)
    .is("consumed_at", null);
  if (error) throw new Error(`Inactive-rep OTP cancellation failed: ${error.message}`);
}

export async function consumeInactiveRepOtpChallenge(options: {
  challengeId: string;
  code: string;
}): Promise<{ result: OtpVerificationResult; email: string | null }> {
  const codeHash = await hashInactiveRepOtpCode(options.challengeId, options.code);
  const { data, error } = await db().rpc("consume_inactive_rep_otp_challenge", {
    p_challenge_id: options.challengeId,
    p_code_hash: codeHash,
  });
  if (error) throw new Error(`Inactive-rep OTP verification failed: ${error.message}`);
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  const result = String(row?.result ?? "invalid") as OtpVerificationResult;
  return {
    result,
    email: row?.verified_email == null ? null : String(row.verified_email),
  };
}
