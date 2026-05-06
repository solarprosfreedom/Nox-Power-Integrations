import { NextRequest, NextResponse } from "next/server";
import { getAllAutomations, recordRun } from "@/lib/automations";
import { writeApiLog } from "@/lib/logger";
import { env } from "@/lib/env";
import type { AutomationSystem, Automation } from "@/lib/automations-types";

const VALID_SYSTEMS: AutomationSystem[] = ["enerflo", "sequifi", "terros"];

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ system: string }> }
) {
  const { system } = await params;

  if (!VALID_SYSTEMS.includes(system as AutomationSystem)) {
    return NextResponse.json({ error: `Unknown system: ${system}` }, { status: 404 });
  }

  // Parse incoming payload
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const incomingEvent = (body.event as string) ?? "";
  const incomingData  = (body.data  as Record<string, unknown>) ?? body;

  // Find all enabled automations that match this system + event
  const all = getAllAutomations();
  const matched = all.filter(
    (a) => a.enabled && a.trigger.system === system && a.trigger.event === incomingEvent
  );

  if (matched.length === 0) {
    return NextResponse.json({
      received: true,
      system,
      event: incomingEvent,
      triggered: 0,
      message: "No enabled automations matched this event.",
    });
  }

  // Run each matched automation
  const results = await Promise.all(matched.map((a) => runOne(a, incomingData)));

  return NextResponse.json({
    received: true,
    system,
    event: incomingEvent,
    triggered: results.length,
    results,
  });
}

// ── GET — let callers verify the URL is alive ─────────────────────────────
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ system: string }> }
) {
  const { system } = await params;
  const all = getAllAutomations();
  const active = all.filter((a) => a.enabled && a.trigger.system === system);

  return NextResponse.json({
    ok: true,
    system,
    description: `Webhook endpoint for ${system}. POST with { event, data } to trigger matching automations.`,
    activeAutomations: active.map((a) => ({
      id: a.id,
      name: a.name,
      trigger_event: a.trigger.event,
    })),
  });
}

// ── Run a single automation with real payload ─────────────────────────────
async function runOne(
  automation: Automation,
  sourceData: Record<string, unknown>
): Promise<{ id: string; name: string; ok: boolean; status: number | null; error?: string }> {
  const { action } = automation;
  const base = resolveBase(action.system);
  const url  = `${base}${action.endpoint}`;
  const key  = resolveKey(action.system);

  // Build body from field mapping (source fields → target fields)
  const mappedBody: Record<string, unknown> = {};
  for (const [srcPath, tgtKey] of Object.entries(action.fieldMapping)) {
    const val = getNestedValue(sourceData, srcPath);
    if (val !== undefined) mappedBody[tgtKey] = val;
  }

  // Merge with samplePayload as defaults (mapped values take priority)
  const finalBody = { ...(action.samplePayload ?? {}), ...mappedBody };

  let status: number | null = null;
  let ok = false;
  let responseText = "";
  let fetchError: string | undefined;

  try {
    const res = await fetch(url, {
      method: action.method,
      headers: buildHeaders(action.system, key),
      body: action.method !== "GET" ? JSON.stringify(finalBody) : undefined,
    });
    status = res.status;
    ok = res.ok;
    responseText = (await res.text()).slice(0, 500);
  } catch (e) {
    fetchError = e instanceof Error ? e.message : String(e);
    responseText = fetchError;
  }

  // Log it
  await writeApiLog({
    operation: `webhook:${automation.id}`,
    vendor: action.system as "enerflo" | "terros" | "sequifi",
    method: action.method,
    url,
    hadApiKey: Boolean(key),
    status,
    ok,
    responsePreview: responseText,
    fetchError,
  });

  // Persist run result
  recordRun(automation.id, ok ? "success" : "failed", status, responseText);

  return { id: automation.id, name: automation.name, ok, status, error: fetchError };
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
    case "terros":  return { ...base, Authorization: `ApiKey ${key}` };
    case "sequifi": return { ...base, Authorization: `Bearer ${key}` };
  }
}

// Resolve dot-path like "lead.assign_to_email" from a nested object
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((cur, key) => {
    if (cur && typeof cur === "object") return (cur as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}
