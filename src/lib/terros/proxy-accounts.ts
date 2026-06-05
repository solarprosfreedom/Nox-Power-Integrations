import { env } from "@/lib/env";
import type { TerrosProxyAccess, TerrosProxyFilter } from "@/lib/terros/proxy-config";
import {
  fetchTerrosAccountListPage,
  parseTerrosAccountRow,
  type TerrosSummary,
} from "@/lib/sync/terros-accounts";
import { resolveTerrosUserIdByEmail } from "@/lib/sync/terros-users";
import {
  fetchTerrosUsersForTeam,
  resolveTerrosTeamIdByName,
  terrosUserIdsFromUsers,
} from "@/lib/terros/proxy-teams";

export interface TerrosProxyAccountsQuery {
  page?: number;
  pageSize?: number;
}

export interface TerrosProxyAccountsResult {
  installerId: string;
  filter: "rep" | "team";
  ownerEmail?: string;
  ownerId?: string;
  teamId?: string;
  teamName?: string;
  memberCount?: number;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  count: number;
  /** True when the full scoped list was served from cache (fast pagination). */
  cached: boolean;
  accounts: TerrosSummary[];
}

export type TerrosProxyAccountsError =
  | { code: "terros_not_configured" }
  | { code: "owner_not_found"; ownerEmail: string }
  | { code: "team_not_found"; teamName?: string; teamId?: string };

const TERROS_LIST_SIZE = 1000;
const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 1000;
const SCOPE_CACHE_MS = 15 * 60_000;
const PROXY_TERROS_GAP_MS = 150;
const TEAM_FETCH_CONCURRENCY = 4;

interface ScopedAccountsCacheEntry {
  at: number;
  meta: Omit<
    TerrosProxyAccountsResult,
    "page" | "pageSize" | "total" | "totalPages" | "count" | "cached" | "accounts"
  >;
  accounts: TerrosSummary[];
}

const scopedAccountsCache = new Map<string, ScopedAccountsCacheEntry>();

/** Account is in scope when the rep is owner, closer, or setter. */
export function accountMatchesTerrosUsers(
  acc: Record<string, unknown>,
  userIds: ReadonlySet<string>,
): boolean {
  const owner = String(acc.ownerId ?? "").trim();
  const closer = String(acc.closerId ?? "").trim();
  const setter = String(acc.setterId ?? "").trim();
  return (
    userIds.has(owner) ||
    userIds.has(closer) ||
    (setter.length > 0 && userIds.has(setter))
  );
}

function accountMatchesUser(acc: Record<string, unknown>, userId: string): boolean {
  return accountMatchesTerrosUsers(acc, new Set([userId]));
}

function terrosBaseAndKey(): { base: string; key: string } | null {
  const key = env.terrosApiKey?.trim();
  if (!key) return null;
  const base = (env.terrosApiBaseUrl ?? "https://api.terros.com").replace(/\/$/, "");
  return { base, key };
}

function normalizePagination(query?: TerrosProxyAccountsQuery): { page: number; pageSize: number } {
  const page = Math.max(1, Math.floor(query?.page ?? DEFAULT_PAGE));
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Math.floor(query?.pageSize ?? DEFAULT_PAGE_SIZE)),
  );
  return { page, pageSize };
}

function scopeCacheKey(access: TerrosProxyAccess): string {
  if (access.filter.kind === "team") {
    return `${access.installerId}:team:${access.filter.teamId ?? ""}:${access.filter.teamName ?? ""}`;
  }
  return `${access.installerId}:rep:${access.filter.ownerEmail}`;
}

function paginateAccounts(
  accounts: TerrosSummary[],
  page: number,
  pageSize: number,
): { total: number; totalPages: number; count: number; accounts: TerrosSummary[] } {
  const total = accounts.length;
  const totalPages = total ? Math.ceil(total / pageSize) : 0;
  const start = (page - 1) * pageSize;
  const slice = accounts.slice(start, start + pageSize);
  return { total, totalPages, count: slice.length, accounts: slice };
}

export async function resolveTeamScope(
  base: string,
  key: string,
  filter: Extract<TerrosProxyFilter, { kind: "team" }>,
): Promise<
  | { ok: true; teamId: string; teamName: string; userIds: string[] }
  | { ok: false; error: TerrosProxyAccountsError }
> {
  let teamId = filter.teamId?.trim() ?? "";
  let teamName = filter.teamName?.trim() ?? "";

  if (!teamId && teamName) {
    const resolved = await resolveTerrosTeamIdByName(base, key, teamName);
    if (!resolved) {
      return { ok: false, error: { code: "team_not_found", teamName } };
    }
    teamId = resolved.teamId;
    teamName = resolved.teamName;
  }

  if (!teamId) {
    return {
      ok: false,
      error: { code: "team_not_found", teamId: teamId || undefined, teamName: teamName || undefined },
    };
  }

  const users = await fetchTerrosUsersForTeam(base, key, teamId);
  const userIds = terrosUserIdsFromUsers(users);
  if (!userIds.length) {
    return { ok: false, error: { code: "team_not_found", teamId, teamName: teamName || undefined } };
  }

  if (!teamName) {
    for (const user of users) {
      const memberOf = user.memberOf;
      if (!Array.isArray(memberOf)) continue;
      for (const entry of memberOf) {
        if (!entry || typeof entry !== "object") continue;
        const row = entry as Record<string, unknown>;
        if (String(row.teamId ?? "").trim() === teamId) {
          teamName = String(row.name ?? "").trim();
          break;
        }
      }
      if (teamName) break;
    }
  }

  return { ok: true, teamId, teamName: teamName || teamId, userIds };
}

/** Fetch accounts for one Terros user (owner, closer, or setter). */
async function fetchAccountsForTerrosUser(
  base: string,
  key: string,
  userId: string,
): Promise<TerrosSummary[]> {
  const { raw } = await fetchTerrosAccountListPage(
    base,
    key,
    TERROS_LIST_SIZE,
    { userId },
    { minGapMs: PROXY_TERROS_GAP_MS },
  );
  return raw
    .filter(acc => accountMatchesUser(acc, userId))
    .map(parseTerrosAccountRow)
    .filter((a): a is TerrosSummary => a !== null);
}

/** Merge accounts across many Terros users (one list call per user, batched in parallel). */
async function fetchAccountsForTerrosUserIds(
  base: string,
  key: string,
  userIds: string[],
): Promise<TerrosSummary[]> {
  const byAccountId = new Map<string, TerrosSummary>();
  for (let i = 0; i < userIds.length; i += TEAM_FETCH_CONCURRENCY) {
    const batch = userIds.slice(i, i + TEAM_FETCH_CONCURRENCY);
    const batches = await Promise.all(
      batch.map(userId => fetchAccountsForTerrosUser(base, key, userId)),
    );
    for (const accounts of batches) {
      for (const account of accounts) {
        byAccountId.set(account.accountId, account);
      }
    }
  }
  return [...byAccountId.values()];
}

async function collectScopedAccounts(
  access: TerrosProxyAccess,
): Promise<
  | { ok: true; meta: ScopedAccountsCacheEntry["meta"]; accounts: TerrosSummary[]; cached: boolean }
  | { ok: false; error: TerrosProxyAccountsError }
> {
  const cacheKey = scopeCacheKey(access);
  const cached = scopedAccountsCache.get(cacheKey);
  if (cached && Date.now() - cached.at < SCOPE_CACHE_MS) {
    return { ok: true, meta: cached.meta, accounts: cached.accounts, cached: true };
  }

  const creds = terrosBaseAndKey();
  if (!creds) return { ok: false, error: { code: "terros_not_configured" } };

  const { base, key } = creds;

  if (access.filter.kind === "rep") {
    const email = access.filter.ownerEmail.trim().toLowerCase();
    const resolved = await resolveTerrosUserIdByEmail(base, key, email);
    const ownerId = resolved.userId?.trim() ?? "";
    if (!ownerId) {
      return { ok: false, error: { code: "owner_not_found", ownerEmail: email } };
    }

    const accounts = await fetchAccountsForTerrosUser(base, key, ownerId);
    const meta = {
      installerId: access.installerId,
      filter: "rep" as const,
      ownerEmail: email,
      ownerId,
    };
    scopedAccountsCache.set(cacheKey, { at: Date.now(), meta, accounts });
    return { ok: true, meta, accounts, cached: false };
  }

  const teamScope = await resolveTeamScope(base, key, access.filter);
  if (!teamScope.ok) return teamScope;

  const { teamId, teamName, userIds } = teamScope;
  const accounts = await fetchAccountsForTerrosUserIds(base, key, userIds);
  const meta = {
    installerId: access.installerId,
    filter: "team" as const,
    teamId,
    teamName,
    memberCount: userIds.length,
  };
  scopedAccountsCache.set(cacheKey, { at: Date.now(), meta, accounts });
  return { ok: true, meta, accounts, cached: false };
}

/** @deprecated Use listAccountsForProxy. */
export async function listAccountsForOwner(
  installerId: string,
  ownerEmail: string,
): Promise<
  | { ok: true; data: TerrosProxyAccountsResult }
  | { ok: false; error: TerrosProxyAccountsError }
> {
  return listAccountsForProxy(
    { installerId, filter: { kind: "rep", ownerEmail } },
    { page: DEFAULT_PAGE, pageSize: DEFAULT_PAGE_SIZE },
  );
}

export async function listAccountsForProxy(
  access: TerrosProxyAccess,
  query?: TerrosProxyAccountsQuery,
): Promise<
  | { ok: true; data: TerrosProxyAccountsResult }
  | { ok: false; error: TerrosProxyAccountsError }
> {
  const { page, pageSize } = normalizePagination(query);
  const collected = await collectScopedAccounts(access);
  if (!collected.ok) return collected;

  const paged = paginateAccounts(collected.accounts, page, pageSize);
  return {
    ok: true,
    data: {
      ...collected.meta,
      page,
      pageSize,
      total: paged.total,
      totalPages: paged.totalPages,
      count: paged.count,
      cached: collected.cached,
      accounts: paged.accounts,
    },
  };
}

/** All scoped accounts (for calendar). Uses same cache as paginated list. */
export async function listAllAccountsForProxy(
  access: TerrosProxyAccess,
): Promise<
  | { ok: true; data: ScopedAccountsCacheEntry["meta"] & { accounts: TerrosSummary[] } }
  | { ok: false; error: TerrosProxyAccountsError }
> {
  const collected = await collectScopedAccounts(access);
  if (!collected.ok) return collected;
  return {
    ok: true,
    data: { ...collected.meta, accounts: collected.accounts },
  };
}

export async function resolveProxyScopeUserIds(
  access: TerrosProxyAccess,
): Promise<
  | { ok: true; userIds: Set<string> }
  | { ok: false; error: TerrosProxyAccountsError }
> {
  const creds = terrosBaseAndKey();
  if (!creds) return { ok: false, error: { code: "terros_not_configured" } };

  const { base, key } = creds;
  if (access.filter.kind === "rep") {
    const email = access.filter.ownerEmail.trim().toLowerCase();
    const resolved = await resolveTerrosUserIdByEmail(base, key, email);
    const ownerId = resolved.userId?.trim() ?? "";
    if (!ownerId) {
      return { ok: false, error: { code: "owner_not_found", ownerEmail: email } };
    }
    return { ok: true, userIds: new Set([ownerId]) };
  }

  const teamScope = await resolveTeamScope(base, key, access.filter);
  if (!teamScope.ok) return teamScope;
  return { ok: true, userIds: new Set(teamScope.userIds) };
}
