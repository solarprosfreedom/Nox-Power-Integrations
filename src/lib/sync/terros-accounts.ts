/** Shared Terros account/list helpers for sync preview and execute. */

import { postTerros } from "@/lib/sync/terros-api";

export interface TerrosSummary {
  accountId: string;
  name: string;
  email: string;
  phone: string;
  addressLine1: string;
  city: string;
  stateCode: string;
  zip: string;
  addressFull: string;
  ownerEmail: string;
  externalLeadId: string;
}

export function terrosSuccess(text: string): boolean {
  try {
    const j = JSON.parse(text) as Record<string, unknown>;
    if (j.type === "error") return false;
  } catch { /* non-JSON */ }
  return true;
}

function extractList(parsed: unknown, keys: string[]): Record<string, unknown>[] {
  if (!parsed || typeof parsed !== "object") return [];
  const p = parsed as Record<string, unknown>;
  for (const k of keys) {
    if (Array.isArray(p[k])) return p[k] as Record<string, unknown>[];
  }
  if (Array.isArray(parsed)) return parsed as Record<string, unknown>[];
  return [];
}

export function parseTerrosAccountRow(acc: Record<string, unknown>): TerrosSummary | null {
  const accountId = String(acc.accountId ?? acc.id ?? "").trim();
  if (!accountId) return null;

  const resident = acc.resident as Record<string, unknown> | undefined;
  const loc = (acc.location ?? acc.address) as Record<string, unknown> | undefined;
  const owner = acc.owner as Record<string, unknown> | undefined;
  const line1 = String(loc?.line1 ?? "").trim();
  const city = String(loc?.locality ?? "").trim();
  const state = String(loc?.countrySubd ?? "").trim();
  const zip = String(loc?.postal1 ?? "").trim();
  const oneLine = String(
    loc?.oneLine ?? [line1, city, state, zip].filter(Boolean).join(", ")
  ).trim();
  const firstName = String(resident?.firstName ?? "").trim();
  const lastName = String(resident?.lastName ?? "").trim();
  const resName = String(resident?.name ?? "").trim();
  const fullName =
    resName ||
    (firstName || lastName ? [firstName, lastName].filter(Boolean).join(" ") : "") ||
    String(acc.name ?? "").trim();

  return {
    accountId,
    name: fullName,
    email: String(resident?.email ?? "").toLowerCase().trim(),
    phone: String(resident?.phone ?? "").trim(),
    addressLine1: line1,
    city,
    stateCode: state,
    zip,
    addressFull: oneLine,
    ownerEmail: String(owner?.email ?? "").trim(),
    externalLeadId: String(acc.externalLeadId ?? "").trim(),
  };
}

/** Terros account/list — documented params: size, searchInput (no page pagination). */
export async function fetchTerrosAccountListPage(
  base: string,
  key: string,
  size = 1000,
  searchInput?: Record<string, unknown>,
  opts?: { minGapMs?: number },
): Promise<{ accounts: TerrosSummary[]; raw: Record<string, unknown>[] }> {
  try {
    const body: Record<string, unknown> = { size };
    if (searchInput) body.searchInput = searchInput;
    const { ok, text } = await postTerros(base, key, "/account/list", body, opts);
    if (!ok) return { accounts: [], raw: [] };
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const rows = extractList(parsed, ["accounts", "data", "results", "items"]);
    const accounts = rows
      .map(parseTerrosAccountRow)
      .filter((a): a is TerrosSummary => a !== null);
    return { accounts, raw: rows };
  } catch {
    return { accounts: [], raw: [] };
  }
}

export async function fetchAllTerrosAccounts(base: string, key: string): Promise<TerrosSummary[]> {
  const { accounts } = await fetchTerrosAccountListPage(base, key, 1000);
  return accounts;
}

export interface TerrosLookupMaps {
  terrosEmailToAccount: Map<string, TerrosSummary>;
  terrosPhoneToAccount: Map<string, TerrosSummary>;
  terrosExternalLeadIdToAccount: Map<string, TerrosSummary>;
  terrosAccounts: TerrosSummary[];
}

/** Shared cache for Terros account/list searches within one preview/execute run. */
export type TerrosSearchCache = Map<string, Record<string, unknown>[]>;

export function createTerrosSearchCache(): TerrosSearchCache {
  return new Map();
}

export function buildTerrosLookupMaps(terrosAccounts: TerrosSummary[]): TerrosLookupMaps {
  const terrosEmailToAccount = new Map<string, TerrosSummary>();
  const terrosPhoneToAccount = new Map<string, TerrosSummary>();
  const terrosExternalLeadIdToAccount = new Map<string, TerrosSummary>();
  for (const acc of terrosAccounts) {
    if (acc.email) terrosEmailToAccount.set(acc.email, acc);
    if (acc.externalLeadId) terrosExternalLeadIdToAccount.set(acc.externalLeadId, acc);
    const normPhone = acc.phone.replace(/\D/g, "");
    if (normPhone.length >= 7) terrosPhoneToAccount.set(normPhone, acc);
  }
  return { terrosEmailToAccount, terrosPhoneToAccount, terrosExternalLeadIdToAccount, terrosAccounts };
}
