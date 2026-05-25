import { CoperniqApiClient } from "@coperniq/node-sdk";
import { env } from "@/lib/env";

export type CoperniqProjectRecord = {
  id: string;
  title: string;
  addressFull: string;
  primaryEmail: string;
  primaryPhone: string;
  systemSize: number | null;
  systemPrice: number | null;
  trades: string[];
  status: string;
  updatedAt: string;
  raw: Record<string, unknown>;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeProject(raw: Record<string, unknown>): CoperniqProjectRecord {
  const addressParts = Array.isArray(raw.address)
    ? (raw.address as unknown[]).map(String).filter(Boolean)
    : raw.address
      ? [String(raw.address)]
      : [];
  const trades = Array.isArray(raw.trades) ? raw.trades.map(String) : [];

  return {
    id: String(raw.id ?? raw.number ?? ""),
    title: String(raw.title ?? raw.description ?? "").trim(),
    addressFull: addressParts.join(", ").trim(),
    primaryEmail: String(raw.primaryEmail ?? "").trim(),
    primaryPhone: String(raw.primaryPhone ?? "").trim(),
    systemSize: typeof raw.size === "number" ? raw.size : typeof raw.systemSize === "number" ? raw.systemSize : null,
    systemPrice: typeof raw.value === "number" ? raw.value : typeof raw.systemPrice === "number" ? raw.systemPrice : null,
    trades,
    status: String((raw.status as Record<string, unknown> | undefined)?.name ?? raw.status ?? "").trim(),
    updatedAt: String(raw.updatedAt ?? raw.updated_at ?? ""),
    raw,
  };
}

export async function fetchAllCoperniqProjects(): Promise<{
  projects: CoperniqProjectRecord[];
  error?: string;
}> {
  const apiKey = env.coperniqApiKey?.trim();
  if (!apiKey) {
    return { projects: [], error: "Missing COPERNIQ_API_KEY in .env.local" };
  }

  const client = new CoperniqApiClient({
    apiKey,
    baseUrl: env.coperniqApiBaseUrl ?? "https://api.coperniq.io",
  });

  const all: CoperniqProjectRecord[] = [];
  try {
    for (let page = 1; page <= 100; page++) {
      const batch = await client.projects.listProjects({
        page,
        pageSize: 100,
        includeArchived: false,
      });
      if (!batch.length) break;
      for (const item of batch) {
        all.push(normalizeProject(asRecord(item)));
      }
      if (batch.length < 100) break;
    }
    return { projects: all.filter(p => p.id) };
  } catch (e) {
    return {
      projects: all,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
