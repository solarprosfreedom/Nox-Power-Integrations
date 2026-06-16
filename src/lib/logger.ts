import { createClient, SupabaseClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";

export type ApiLog = {
  id: string;
  timestamp: string;
  operation: string;
  vendor: "enerflo" | "terros" | "sequifi";
  method: string;
  url: string;
  hadApiKey: boolean;
  status: number | null;
  statusText?: string;
  ok: boolean;
  responsePreview: string;
  fetchError?: string;
};

// ── Supabase client (lazy, only created when env vars are present) ─────────

let _supabase: SupabaseClient | null = null;

function getSupabase(): SupabaseClient | null {
  if (_supabase) return _supabase;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  _supabase = createClient(url, key);
  return _supabase;
}

// ── Local file fallback (dev only) ─────────────────────────────────────────

const LOG_FILE = path.join(process.cwd(), "data", "logs.json");
const MAX_LOCAL_LOGS = 500;

function readLocalLogs(): ApiLog[] {
  try {
    const raw = fs.readFileSync(LOG_FILE, "utf-8");
    return JSON.parse(raw) as ApiLog[];
  } catch {
    return [];
  }
}

function writeLocalLogs(logs: ApiLog[]): void {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  fs.writeFileSync(LOG_FILE, JSON.stringify(logs, null, 2), "utf-8");
}

// ── Public API ─────────────────────────────────────────────────────────────

export function preview(text: string, max = 2000): string {
  return text.length <= max ? text : text.slice(0, max) + " …(truncated)";
}

export async function writeApiLog(
  entry: Omit<ApiLog, "id" | "timestamp">
): Promise<ApiLog> {
  const full: ApiLog = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    ...entry,
  };

  console.log("[API LOG]", JSON.stringify(full, null, 2));

  const supabase = getSupabase();
  if (supabase) {
    // Column names use snake_case to match the Supabase table schema
    const { error } = await supabase.from("api_logs").insert({
      id: full.id,
      timestamp: full.timestamp,
      operation: full.operation,
      vendor: full.vendor,
      method: full.method,
      url: full.url,
      had_api_key: full.hadApiKey,
      status: full.status,
      status_text: full.statusText ?? null,
      ok: full.ok,
      response_preview: full.responsePreview,
      fetch_error: full.fetchError ?? null,
    });
    if (error) {
      console.error("[API LOG] Supabase insert failed:", error.message);
    }
  } else {
    // Fallback: local JSON file (dev without Supabase configured)
    const existing = readLocalLogs();
    writeLocalLogs([full, ...existing].slice(0, MAX_LOCAL_LOGS));
  }

  return full;
}

/**
 * Distributed lock for calendar event creation.
 *
 * When Enerflo fires update_appointment 3× simultaneously for the same
 * appointment, all three requests race to create the event. This function
 * uses Supabase as a coordination point:
 *   1. Write our lock entry immediately (with our unique lockId).
 *   2. Wait 300 ms so concurrent requests also write their entries.
 *   3. Query for the EARLIEST lock entry for this appointment.
 *   4. Return true only if we are the earliest writer → we won.
 *
 * Returns true (won = proceed) when Supabase is unavailable so we don't
 * silently swallow events in environments without a DB.
 */
async function acquireDedupLock(
  lockKey: string,
  operation: string,
  windowMs = 10_000,
): Promise<boolean> {
  // Wrap everything in try/catch — if Supabase is unavailable or throws for any
  // reason we must not crash the calling webhook handler. Returning true lets
  // event creation proceed so nothing is silently dropped.
  try {
    const supabase = getSupabase();
    if (!supabase) return true;

    const lockId        = crypto.randomUUID();
    const lockTimestamp = new Date().toISOString();

    const { error: insertError } = await supabase.from("api_logs").insert({
      id:               lockId,
      timestamp:        lockTimestamp,
      operation:        operation,
      vendor:           "terros",
      method:           "POST",
      url:              "",
      had_api_key:      false,
      status:           null,
      status_text:      null,
      ok:               false,
      response_preview: lockKey,
      fetch_error:      null,
    });
    if (insertError) {
      console.error("[LOCK] insert failed:", insertError.message);
      return true; // allow on insert error
    }

    // Give concurrent requests 300 ms to write their own lock entries
    await new Promise<void>(resolve => setTimeout(resolve, 300));

    const cutoff = new Date(Date.now() - windowMs).toISOString();
    const { data, error: queryError } = await supabase
      .from("api_logs")
      .select("id")
      .eq("operation", operation)
      .eq("response_preview", lockKey)
      .gte("timestamp", cutoff)
      .order("timestamp", { ascending: true })
      .limit(1);

    if (queryError) {
      console.error("[LOCK] query failed:", queryError.message);
      return true; // allow on query error
    }

    return data?.[0]?.id === lockId;
  } catch (err) {
    console.error("[LOCK] unexpected error:", err);
    return true; // allow on any unexpected error
  }
}

/** Lock for Enerflo → Terros calendar event creation (concurrent update_appointment). */
export async function acquireCalendarEventLock(
  enerfloAppointmentId: number
): Promise<boolean> {
  return acquireDedupLock(String(enerfloAppointmentId), "calendar-event-lock");
}

/**
 * Lock for Terros → Enerflo appointment creation (concurrent Event add webhooks).
 * Only one POST /api/v1/appointments per Terros eventId should win.
 */
export async function acquireTerrosEventCreateLock(terrosEventId: string): Promise<boolean> {
  const key = terrosEventId.trim();
  if (!key) return true;
  // Terros retries Event add webhooks over 30+ seconds — keep lock window wide.
  return acquireDedupLock(key, "terros-event-create-lock", 5 * 60_000);
}

/**
 * Persist the mapping from Enerflo appointment ID → Terros calendar event ID.
 * Stored as a dedicated log entry so update_appointment can look it up even
 * when calendar/event/list doesn't return notes.
 */
export async function saveCalendarEventMapping(
  enerfloAppointmentId: number,
  terrosEventId: string
): Promise<void> {
  try {
    const supabase = getSupabase();
    if (!supabase) return;
    // Store both directions in the JSON so we can look up by either key.
    await supabase.from("api_logs").insert({
      id:               crypto.randomUUID(),
      timestamp:        new Date().toISOString(),
      operation:        "calendar-event-id-map",
      vendor:           "terros",
      method:           "POST",
      url:              "",
      had_api_key:      false,
      status:           null,
      status_text:      null,
      ok:               true,
      response_preview: JSON.stringify({ enerfloAppointmentId, terrosEventId }),
      fetch_error:      null,
    });
  } catch (err) {
    console.error("[EVENT MAP] save failed:", err);
  }
}

/**
 * Reverse-lookup: given a Terros event ID, find the Enerflo appointment ID
 * that was created for it. The mapping is the same api_logs table used by
 * saveCalendarEventMapping — we just search the JSON for the terrosEventId.
 */
export async function getEnerfloAppointmentIdByTerrosEventId(
  terrosEventId: string
): Promise<number | null> {
  const meta = await getCalendarEventMappingMeta(terrosEventId);
  return meta?.enerfloAppointmentId ?? null;
}

/**
 * Like getEnerfloAppointmentIdByTerrosEventId but also returns how long ago the
 * mapping row was written (ageMs). Used to distinguish the note-stamp / sync
 * echo (arrives seconds after the mapping is created) from a genuine human
 * reschedule (happens later), so the Terros event-update handler can break sync
 * loops without permanently blocking legitimate updates.
 */
export async function getCalendarEventMappingMeta(
  terrosEventId: string
): Promise<{ enerfloAppointmentId: number; ageMs: number } | null> {
  try {
    const supabase = getSupabase();
    if (!supabase) return null;
    const { data } = await supabase
      .from("api_logs")
      .select("response_preview, timestamp")
      .eq("operation", "calendar-event-id-map")
      .ilike("response_preview", `%"terrosEventId":"${terrosEventId}"%`)
      .order("timestamp", { ascending: false })
      .limit(1);
    if (!data?.[0]?.response_preview) return null;
    const parsed = JSON.parse(data[0].response_preview) as { enerfloAppointmentId?: number };
    if (parsed.enerfloAppointmentId == null) return null;
    const ts = data[0].timestamp ? new Date(data[0].timestamp).getTime() : NaN;
    const ageMs = Number.isFinite(ts) ? Date.now() - ts : Number.POSITIVE_INFINITY;
    return { enerfloAppointmentId: parsed.enerfloAppointmentId, ageMs };
  } catch (err) {
    console.error("[EVENT MAP] reverse lookup failed:", err);
    return null;
  }
}

/**
 * Look up the Terros calendar event ID previously saved for an Enerflo appointment.
 * Returns null if no mapping exists (event was never created via this system).
 */
/** Normalize Terros account ids to `Account.{id}` for consistent map keys. */
export function normalizeTerrosAccountId(accountId: string): string {
  const trimmed = accountId.trim();
  if (!trimmed) return trimmed;
  return trimmed.startsWith("Account.") ? trimmed : `Account.${trimmed}`;
}

/**
 * Persist Terros account → Enerflo numeric customer id.
 * Required for Enerflo→Terros customers that never appear in v1 search (empty email).
 */
export async function saveCustomerAccountMapping(
  terrosAccountId: string,
  enerfloNumericId: number
): Promise<void> {
  try {
    const supabase = getSupabase();
    if (!supabase || !Number.isFinite(enerfloNumericId)) return;
    const key = normalizeTerrosAccountId(terrosAccountId);
    await supabase.from("api_logs").insert({
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      operation: "customer-account-id-map",
      vendor: "terros",
      method: "POST",
      url: "",
      had_api_key: false,
      status: null,
      status_text: null,
      ok: true,
      response_preview: JSON.stringify({ terrosAccountId: key, enerfloNumericId }),
      fetch_error: null,
    });
  } catch (err) {
    console.error("[CUSTOMER MAP] save failed:", err);
  }
}

export async function getEnerfloCustomerIdByTerrosAccountId(
  terrosAccountId: string
): Promise<number | null> {
  try {
    const supabase = getSupabase();
    if (!supabase) return null;
    const key = normalizeTerrosAccountId(terrosAccountId);
    const { data } = await supabase
      .from("api_logs")
      .select("response_preview")
      .eq("operation", "customer-account-id-map")
      .ilike("response_preview", `%"terrosAccountId":"${key}"%`)
      .order("timestamp", { ascending: false })
      .limit(1);
    if (!data?.[0]?.response_preview) return null;
    const parsed = JSON.parse(data[0].response_preview) as { enerfloNumericId?: number };
    return parsed.enerfloNumericId ?? null;
  } catch (err) {
    console.error("[CUSTOMER MAP] lookup failed:", err);
    return null;
  }
}

/**
 * Reverse lookup: given an Enerflo numeric customer id, find the Terros account id
 * it was mapped to. Used to detect that a customer.created event refers to a lead
 * that ORIGINATED in Terros (we created the Enerflo lead from it), so we must not
 * create a second Terros account for it.
 */
export async function getTerrosAccountIdByEnerfloNumericId(
  enerfloNumericId: number | string
): Promise<string | null> {
  try {
    const supabase = getSupabase();
    if (!supabase) return null;
    const idNum = Number(enerfloNumericId);
    if (!Number.isFinite(idNum)) return null;
    const { data } = await supabase
      .from("api_logs")
      .select("response_preview")
      .eq("operation", "customer-account-id-map")
      .ilike("response_preview", `%"enerfloNumericId":${idNum}%`)
      .order("timestamp", { ascending: false })
      .limit(5);
    for (const row of data ?? []) {
      try {
        const parsed = JSON.parse(row.response_preview as string) as {
          terrosAccountId?: string;
          enerfloNumericId?: number;
        };
        if (parsed.enerfloNumericId === idNum && parsed.terrosAccountId) {
          return parsed.terrosAccountId;
        }
      } catch { /* skip malformed row */ }
    }
    return null;
  } catch (err) {
    console.error("[CUSTOMER MAP] reverse lookup failed:", err);
    return null;
  }
}

/**
 * Backfill mapping from prior enerflo-v2 v3-fetch logs when v1 search cannot find the customer.
 */
export async function findEnerfloCustomerIdFromHistoricalLogs(
  terrosAccountId: string
): Promise<number | null> {
  const mapped = await getEnerfloCustomerIdByTerrosAccountId(terrosAccountId);
  if (mapped != null) return mapped;

  try {
    const supabase = getSupabase();
    if (!supabase) return null;
    const key = normalizeTerrosAccountId(terrosAccountId);
    const { data } = await supabase
      .from("api_logs")
      .select("response_preview")
      .eq("operation", "webhook:enerflo-v2:update-customer:v3-fetch")
      .ilike("response_preview", `%${key}%`)
      .order("timestamp", { ascending: false })
      .limit(5);
    for (const row of data ?? []) {
      const preview = row.response_preview as string | undefined;
      if (!preview?.includes(key)) continue;
      const idMatch = preview.match(/"id"\s*:\s*(\d+)/);
      if (!idMatch) continue;
      const enerfloNumericId = Number(idMatch[1]);
      if (!Number.isFinite(enerfloNumericId)) continue;
      await saveCustomerAccountMapping(key, enerfloNumericId);
      return enerfloNumericId;
    }
  } catch (err) {
    console.error("[CUSTOMER MAP] historical lookup failed:", err);
  }
  return null;
}

export async function getCalendarEventId(
  enerfloAppointmentId: number
): Promise<string | null> {
  try {
    const supabase = getSupabase();
    if (!supabase) return null;
    const { data } = await supabase
      .from("api_logs")
      .select("response_preview")
      .eq("operation", "calendar-event-id-map")
      .ilike("response_preview", `%"enerfloAppointmentId":${enerfloAppointmentId}%`)
      .order("timestamp", { ascending: false })
      .limit(1);
    if (!data?.[0]?.response_preview) return null;
    const parsed = JSON.parse(data[0].response_preview) as { terrosEventId?: string };
    return parsed.terrosEventId ?? null;
  } catch (err) {
    console.error("[EVENT MAP] lookup failed:", err);
    return null;
  }
}

export async function getAllLogs(): Promise<ApiLog[]> {
  const supabase = getSupabase();
  if (supabase) {
    const { data, error } = await supabase
      .from("api_logs")
      .select("*")
      .order("timestamp", { ascending: false })
      .limit(500);
    if (error) {
      console.error("[API LOG] Supabase fetch failed:", error.message);
      return [];
    }
    return (data ?? []).map((row) => ({
      id: row.id,
      timestamp: row.timestamp,
      operation: row.operation,
      vendor: row.vendor,
      method: row.method,
      url: row.url,
      hadApiKey: row.had_api_key,
      status: row.status,
      statusText: row.status_text ?? undefined,
      ok: row.ok,
      responsePreview: row.response_preview,
      fetchError: row.fetch_error ?? undefined,
    }));
  }
  // Fallback: local file
  return readLocalLogs();
}
