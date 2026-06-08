import { env } from "@/lib/env";

function extractList(parsed: unknown, keys: string[]): Record<string, unknown>[] {
  if (!parsed || typeof parsed !== "object") return [];
  const p = parsed as Record<string, unknown>;
  for (const k of keys) {
    if (Array.isArray(p[k])) return p[k] as Record<string, unknown>[];
  }
  if (Array.isArray(parsed)) return parsed as Record<string, unknown>[];
  return [];
}

export async function fetchAllEnerfloInstalls(): Promise<{
  installs: Record<string, unknown>[];
  error?: string;
}> {
  const enerfloKey = env.enerfloV1ApiKey?.trim();
  if (!enerfloKey) {
    return { installs: [], error: "ENERFLO_V1_API_KEY is not set." };
  }

  const enerfloBase = (env.enerfloV1BaseUrl ?? "https://enerflo.io").replace(/\/$/, "");
  const perPage = 100;
  const allInstalls: Record<string, unknown>[] = [];

  for (let page = 1; page <= 200; page++) {
    try {
      const res = await fetch(
        `${enerfloBase}/api/v3/installs?page=${page}&per_page=${perPage}`,
        { method: "GET", headers: { "api-key": enerfloKey, "Content-Type": "application/json" } },
      );
      if (!res.ok) {
        return {
          installs: allInstalls,
          error: allInstalls.length === 0 ? `Enerflo installs HTTP ${res.status}` : undefined,
        };
      }
      const parsed = JSON.parse(await res.text()) as Record<string, unknown>;
      const batch = extractList(parsed, ["results", "installs", "data", "items"]);
      if (batch.length === 0) break;
      allInstalls.push(...batch);
      const total = typeof parsed.total === "number" ? parsed.total : null;
      if (batch.length < perPage) break;
      if (total != null && allInstalls.length >= total) break;
    } catch (e) {
      return {
        installs: allInstalls,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  return { installs: allInstalls };
}
