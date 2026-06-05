import { env } from "@/lib/env";

export type TerrosProxyFilterKind = "rep" | "team";

export interface TerrosProxyRepFilter {
  kind: "rep";
  ownerEmail: string;
}

export interface TerrosProxyTeamFilter {
  kind: "team";
  teamId?: string;
  teamName?: string;
}

export type TerrosProxyFilter = TerrosProxyRepFilter | TerrosProxyTeamFilter;

export interface TerrosProxyAccessEntry {
  installerId: string;
  secret: string;
  filter: TerrosProxyFilter;
}

export interface TerrosProxyAccess {
  installerId: string;
  filter: TerrosProxyFilter;
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function parseFilter(row: Record<string, unknown>): TerrosProxyFilter | null {
  const filterRaw = String(row.filter ?? "").trim().toLowerCase();
  const teamId = String(row.teamId ?? "").trim();
  const teamName = String(row.teamName ?? "").trim();
  const ownerEmail = String(row.ownerEmail ?? "").trim().toLowerCase();

  if (filterRaw === "team" || teamId || teamName) {
    if (!teamId && !teamName) return null;
    return {
      kind: "team",
      ...(teamId ? { teamId } : {}),
      ...(teamName ? { teamName } : {}),
    };
  }

  if (ownerEmail) {
    return { kind: "rep", ownerEmail };
  }

  return null;
}

let cachedEntries: TerrosProxyAccessEntry[] | null = null;

export function loadTerrosProxyAccessEntries(): TerrosProxyAccessEntry[] {
  if (cachedEntries) return cachedEntries;

  const raw = env.terrosProxyAccessJson?.trim();
  if (!raw) {
    cachedEntries = [];
    return cachedEntries;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      cachedEntries = [];
      return cachedEntries;
    }

    cachedEntries = parsed
      .map((item): TerrosProxyAccessEntry | null => {
        if (!item || typeof item !== "object") return null;
        const row = item as Record<string, unknown>;
        const installerId = String(row.installerId ?? "").trim();
        const secret = String(row.secret ?? "").trim();
        const filter = parseFilter(row);
        if (!installerId || !secret || !filter) return null;
        return { installerId, secret, filter };
      })
      .filter((e): e is TerrosProxyAccessEntry => e !== null);
  } catch {
    cachedEntries = [];
  }

  return cachedEntries;
}

/** Match Bearer token to an installer config (constant-time secret compare). */
export function resolveProxyAccess(bearerToken: string): TerrosProxyAccess | null {
  const token = bearerToken.trim();
  if (!token) return null;

  for (const entry of loadTerrosProxyAccessEntries()) {
    if (safeEqual(token, entry.secret)) {
      return { installerId: entry.installerId, filter: entry.filter };
    }
  }
  return null;
}

export function isTerrosProxyConfigured(): boolean {
  return loadTerrosProxyAccessEntries().length > 0;
}
