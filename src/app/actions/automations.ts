"use server";

import {
  getAllAutomations,
  createAutomation,
  toggleAutomation,
  recordRun,
  deleteAutomation,
} from "@/lib/automations";
import { writeApiLog } from "@/lib/logger";
import { env } from "@/lib/env";
import type { Automation, AutomationSystem } from "@/lib/automations-types";

// ── Fetch all automations ────────────────────────────────────────────────
export async function fetchAutomations(): Promise<Automation[]> {
  return getAllAutomations();
}

// ── Toggle enabled/disabled ──────────────────────────────────────────────
export async function setAutomationEnabled(
  id: string,
  enabled: boolean
): Promise<Automation | null> {
  return toggleAutomation(id, enabled);
}

// ── Delete ────────────────────────────────────────────────────────────────
export async function removeAutomation(id: string): Promise<boolean> {
  return deleteAutomation(id);
}

// ── Create custom automation ──────────────────────────────────────────────
export async function addAutomation(formData: FormData): Promise<Automation> {
  const get = (k: string) => (formData.get(k) as string | null)?.trim() ?? "";

  const triggerSystem = get("trigger_system") as AutomationSystem;
  const actionSystem  = get("action_system")  as AutomationSystem;

  // Parse field mapping lines: "source.field -> target_field"
  const mappingRaw = get("field_mapping");
  const fieldMapping: Record<string, string> = {};
  mappingRaw.split("\n").forEach((line) => {
    const [src, tgt] = line.split("->").map((s) => s.trim());
    if (src && tgt) fieldMapping[src] = tgt;
  });

  return createAutomation({
    name: get("name"),
    description: get("description"),
    enabled: false,
    trigger: {
      system: triggerSystem,
      event: get("trigger_event"),
      eventLabel: get("trigger_event_label") || get("trigger_event"),
    },
    action: {
      system: actionSystem,
      operation: get("action_operation"),
      operationLabel: get("action_operation_label") || get("action_operation"),
      endpoint: get("action_endpoint"),
      method: (get("action_method") as "GET" | "POST") || "POST",
      fieldMapping,
    },
  });
}

// ── Run automation manually ───────────────────────────────────────────────
export async function runAutomation(id: string): Promise<{
  automation: Automation | null;
  httpStatus: number | null;
  ok: boolean;
  response: string;
  hadApiKey: boolean;
}> {
  const all = getAllAutomations();
  const automation = all.find((a) => a.id === id);
  if (!automation) {
    return { automation: null, httpStatus: null, ok: false, response: "Automation not found", hadApiKey: false };
  }

  const { action } = automation;
  const base = resolveBase(action.system);
  const url  = `${base}${action.endpoint}`;
  const key  = resolveKey(action.system);
  const hadApiKey = Boolean(key);

  let httpStatus: number | null = null;
  let responseText = "";
  let ok = false;
  let fetchError: string | undefined;

  try {
    const res = await fetch(url, {
      method: action.method,
      headers: buildHeaders(action.system, key),
      body: action.method !== "GET" && action.samplePayload
        ? JSON.stringify(action.samplePayload)
        : undefined,
    });
    httpStatus = res.status;
    ok = res.ok;
    responseText = (await res.text()).slice(0, 1000);
  } catch (e) {
    fetchError = e instanceof Error ? e.message : String(e);
    responseText = fetchError;
  }

  // Log to data/logs.json
  await writeApiLog({
    operation: `automation:${automation.id}`,
    vendor: action.system as "enerflo" | "terros" | "sequifi",
    method: action.method,
    url,
    hadApiKey,
    status: httpStatus,
    ok,
    responsePreview: responseText,
    fetchError,
  });

  // Update automation record
  const runStatus = ok ? "success" : "failed";
  const updated = recordRun(id, runStatus, httpStatus, responseText);

  return { automation: updated, httpStatus, ok, response: responseText, hadApiKey };
}

// ── Helpers ───────────────────────────────────────────────────────────────
function resolveBase(system: AutomationSystem): string {
  switch (system) {
    case "enerflo": return (env.enerfloV1BaseUrl ?? "https://enerflo.io").replace(/\/$/, "");
    case "terros":  return (env.terrosApiBaseUrl  ?? "https://api.terros.com").replace(/\/$/, "");
    case "sequifi": return (env.sequifiApiBaseUrl  ?? "").replace(/\/$/, "");
  }
}

function resolveKey(system: AutomationSystem): string {
  switch (system) {
    case "enerflo": return env.enerfloV1ApiKey ?? "";
    case "terros":  return env.terrosApiKey    ?? "";
    case "sequifi": return env.sequifiApiKey   ?? "";
  }
}

function buildHeaders(system: AutomationSystem, key: string): Record<string, string> {
  const base: Record<string, string> = { "Content-Type": "application/json" };
  if (!key) return base;
  switch (system) {
    case "enerflo": return { ...base, "api-key": key };
    case "terros":  return { ...base, "Authorization": `Bearer ${key}` };
    case "sequifi": return { ...base, "Authorization": `Bearer ${key}` };
  }
}
