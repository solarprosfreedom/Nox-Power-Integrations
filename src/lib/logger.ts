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
