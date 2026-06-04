import { env } from "@/lib/env";

export interface TerrosProxyAccessEntry {
  installerId: string;
  secret: string;
  ownerEmail: string;
}

export interface TerrosProxyAccess {
  installerId: string;
  ownerEmail: string;
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
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
        const ownerEmail = String(row.ownerEmail ?? "").trim().toLowerCase();
        if (!installerId || !secret || !ownerEmail) return null;
        return { installerId, secret, ownerEmail };
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
      return { installerId: entry.installerId, ownerEmail: entry.ownerEmail };
    }
  }
  return null;
}

export function isTerrosProxyConfigured(): boolean {
  return loadTerrosProxyAccessEntries().length > 0;
}
