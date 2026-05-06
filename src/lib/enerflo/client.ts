import { env } from "@/lib/env";
import { writeApiLog, preview, type ApiLog } from "@/lib/logger";

export async function enerfloRequest(options: {
  operation: string;
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  path: string;
  pathParams?: Record<string, string>;
  query?: Record<string, string>;
  body?: Record<string, unknown>;
}): Promise<ApiLog & { ok: boolean }> {
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

  try {
    const res = await fetch(url, {
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
    responsePreview = preview(await res.text());
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
    return { ...log, ok };
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

  try {
    const res = await fetch(url, {
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
    const text = await res.text();
    responsePreview = preview(text);
    if (text.trim()) {
      try {
        data = JSON.parse(text) as T;
      } catch (e) {
        parseError = e instanceof Error ? e.message : String(e);
      }
    }
  } catch (e) {
    fetchError = e instanceof Error ? e.message : String(e);
  }

  const stub: ApiLog & { ok: boolean } = {
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
    return { ok, status, data, parseError, log: { ...log, ok } };
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
