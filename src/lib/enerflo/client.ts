import { env } from "@/lib/env";
import { writeApiLog, preview, type ApiLog } from "@/lib/logger";

/**
 * Per-request timeout for Enerflo calls. Without this, a slow/struggling Enerflo
 * (we've seen 504s on their appointment + scheduling subsystems) makes fetch hang
 * indefinitely. In a background after() task that hang runs until Vercel's 60s
 * function limit kills the whole task mid-flight — so the lead/add upsert fallback
 * never runs and the update is silently dropped. A bounded timeout makes each call
 * fail fast so the handler can fall through to its fallback and still log an outcome.
 */
const ENERFLO_FETCH_TIMEOUT_MS = 15_000;

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = ENERFLO_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function enerfloRequest(options: {
  operation: string;
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  path: string;
  pathParams?: Record<string, string>;
  query?: Record<string, string>;
  body?: Record<string, unknown>;
}): Promise<ApiLog & { ok: boolean; rawResponseText: string }> {
  const base = (env.enerfloV1BaseUrl ?? "https://enerflo.io").replace(/\/$/, "");

  // Substitute path params e.g. /api/v3/customers/{id}/appointments/
  let resolvedPath = options.path;
  if (options.pathParams) {
    for (const [key, val] of Object.entries(options.pathParams)) {
      resolvedPath = resolvedPath.replace(`{${key}}`, encodeURIComponent(val));
    }
  }

  // Build query string
  let url = `${base}${resolvedPath}`;
  if (options.query && Object.keys(options.query).length > 0) {
    const qs = new URLSearchParams(
      Object.entries(options.query).filter(([, v]) => v !== "")
    ).toString();
    if (qs) url += `?${qs}`;
  }

  const key = env.enerfloV1ApiKey ?? "";
  const hadApiKey = Boolean(key);

  let status: number | null = null;
  let statusText: string | undefined;
  let responsePreview = "";
  let fetchError: string | undefined;
  let ok = false;
  let rawResponseText = "";

  try {
    const res = await fetchWithTimeout(url, {
      method: options.method,
      headers: {
        "Content-Type": "application/json",
        "api-key": key,
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    status = res.status;
    statusText = res.statusText;
    ok = res.ok;
    rawResponseText = await res.text();
    responsePreview = preview(rawResponseText);
  } catch (e) {
    fetchError = e instanceof Error ? e.message : String(e);
  }

  if (options.method !== "GET") {
    const log = await writeApiLog({
      operation: options.operation,
      vendor: "enerflo",
      method: options.method,
      url,
      hadApiKey,
      status,
      statusText,
      ok,
      responsePreview,
      fetchError,
    });
    return { ...log, ok, rawResponseText };
  }

  // GET — skip writing to the activity log
  return {
    id: "",
    timestamp: new Date().toISOString(),
    operation: options.operation,
    vendor: "enerflo",
    method: options.method,
    url,
    hadApiKey,
    status,
    statusText,
    ok,
    responsePreview,
    fetchError,
    rawResponseText,
  };
}

/** Same as enerfloRequest but parses JSON body (for list UIs). Still logs truncated preview. */
export async function enerfloRequestParsed<T = unknown>(options: {
  operation: string;
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  path: string;
  pathParams?: Record<string, string>;
  query?: Record<string, string>;
  body?: Record<string, unknown>;
}): Promise<{
  ok: boolean;
  status: number | null;
  data: T | null;
  parseError?: string;
  log: Awaited<ReturnType<typeof enerfloRequest>>;
}> {
  const base = (env.enerfloV1BaseUrl ?? "https://enerflo.io").replace(/\/$/, "");

  let resolvedPath = options.path;
  if (options.pathParams) {
    for (const [key, val] of Object.entries(options.pathParams)) {
      resolvedPath = resolvedPath.replace(`{${key}}`, encodeURIComponent(val));
    }
  }

  let url = `${base}${resolvedPath}`;
  if (options.query && Object.keys(options.query).length > 0) {
    const qs = new URLSearchParams(
      Object.entries(options.query).filter(([, v]) => v !== "")
    ).toString();
    if (qs) url += `?${qs}`;
  }

  const key = env.enerfloV1ApiKey ?? "";
  const hadApiKey = Boolean(key);

  let status: number | null = null;
  let statusText: string | undefined;
  let responsePreview = "";
  let fetchError: string | undefined;
  let ok = false;
  let data: T | null = null;
  let parseError: string | undefined;
  let rawResponseText = "";

  try {
    const res = await fetchWithTimeout(url, {
      method: options.method,
      headers: {
        "Content-Type": "application/json",
        "api-key": key,
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    status = res.status;
    statusText = res.statusText;
    ok = res.ok;
    rawResponseText = await res.text();
    responsePreview = preview(rawResponseText);
    if (rawResponseText.trim()) {
      try {
        data = JSON.parse(rawResponseText) as T;
      } catch (e) {
        parseError = e instanceof Error ? e.message : String(e);
      }
    }
  } catch (e) {
    fetchError = e instanceof Error ? e.message : String(e);
  }

  const stub: ApiLog & { ok: boolean; rawResponseText: string } = {
    id: "",
    timestamp: new Date().toISOString(),
    operation: options.operation,
    vendor: "enerflo",
    method: options.method,
    url,
    hadApiKey,
    status,
    statusText,
    ok,
    responsePreview: parseError ? `${responsePreview}\n(parse: ${parseError})` : responsePreview,
    fetchError,
    rawResponseText,
  };

  if (options.method !== "GET") {
    const log = await writeApiLog({
      operation: options.operation,
      vendor: "enerflo",
      method: options.method,
      url,
      hadApiKey,
      status,
      statusText,
      ok,
      responsePreview: parseError ? `${responsePreview}\n(parse: ${parseError})` : responsePreview,
      fetchError,
    });
    return { ok, status, data, parseError, log: { ...log, ok, rawResponseText } };
  }

  // GET — skip writing to the activity log
  return { ok, status, data, parseError, log: stub };
}

// Convenience alias kept for backward compat with existing createEnerfloUser/Customer actions
export const enerfloV1 = (opts: {
  operation: string;
  method: "GET" | "POST" | "PATCH" | "PUT";
  path: string;
  body?: Record<string, unknown>;
}) =>
  enerfloRequest({
    operation: opts.operation,
    method: opts.method,
    path: opts.path.startsWith("/api") ? opts.path : `/api${opts.path}`,
    body: opts.body,
  });
