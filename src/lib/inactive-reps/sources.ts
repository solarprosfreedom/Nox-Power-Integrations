import { env } from "@/lib/env";
import { getGraphAccessToken, GRAPH_BASE, requireAzureConfig } from "@/lib/microsoft/graph-auth";
import { sequifiUserFromApi } from "@/lib/onboarding/normalize";
import type { SequifiUserRecord } from "@/lib/onboarding/types";
import { normalizeEmail } from "@/lib/inactive-reps/identity";
import type { InactiveRepPlatform, SourceSummary } from "@/lib/inactive-reps/types";

const FETCH_TIMEOUT_MS = 45_000;
const SALES_FEEDS = ["axia", "illum", "tron", "empwr", "goodpwr", "owe"] as const;

export interface SourceAccount {
  platform: InactiveRepPlatform;
  id: string;
  secondaryId?: string;
  email: string;
  name: string;
  active: boolean;
  createdAt: string | null;
  lastLoginAt: string | null;
  roles: string[];
  isAdmin: boolean;
  evidenceSource: string;
  evidenceIssue?: string;
}

export interface SalesFeedData {
  installer: string;
  table: string;
  primaryKey: string;
  rows: Record<string, unknown>[];
}

export interface InactiveRepSourceSnapshot {
  sequifiUsers: SequifiUserRecord[];
  accounts: Record<InactiveRepPlatform, SourceAccount[]>;
  salesFeeds: SalesFeedData[];
  sourceSummary: SourceSummary;
}

interface EnerfloGraphqlUser {
  id: string;
  email: string;
  status: string;
  isActive: boolean;
  isOrgAdmin: boolean;
  isPlatformAdmin: boolean;
  createdAt: string;
  lastLogin: string | null;
  fullName: string;
  userOrgs: Array<{
    isOrgAdmin: boolean;
    roles: Array<{ id: string; name: string }>;
  }>;
}

function requireSetting(value: string | undefined, name: string): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new Error(`${name} is not configured`);
  return trimmed;
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
  } finally {
    clearTimeout(timer);
  }
}

export function listFromPayload(payload: unknown, paths: string[]): Record<string, unknown>[] {
  for (const path of paths) {
    const value = path.split(".").reduce<unknown>((current, key) => {
      if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
      return (current as Record<string, unknown>)[key];
    }, payload);
    if (Array.isArray(value)) {
      return value.filter(
        (row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row),
      );
    }
  }
  return [];
}

export function asIso(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value > 10_000_000_000) return new Date(value).toISOString();
    if (value > 1_000_000_000) return new Date(value * 1000).toISOString();
    if (value > 20_000) return new Date(Math.round((value - 25_569) * 86_400_000)).toISOString();
  }
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

export function asBoolean(value: unknown): boolean {
  if (value === true || value === 1 || value === "1") return true;
  if (typeof value === "string") {
    return ["true", "yes", "active", "enabled"].includes(value.trim().toLowerCase());
  }
  return false;
}

export function roleLabels(value: unknown): string[] {
  const rows = Array.isArray(value) ? value : String(value ?? "").split(",");
  return rows
    .map(role => {
      if (typeof role === "string") return role.trim();
      if (!role || typeof role !== "object") return "";
      const data = role as Record<string, unknown>;
      return String(data.name ?? data.roleName ?? data.label ?? data.title ?? data.slug ?? "").trim();
    })
    .filter(Boolean);
}

async function fetchSequifiUsersIncludingInactive(): Promise<SequifiUserRecord[]> {
  const token = requireSetting(env.sequifiAccessToken ?? env.sequifiApiKey, "SEQUIFI_ACCESS_TOKEN");
  const base = (env.sequifiApiBaseUrl ?? "https://marketplace-api.sequifi.com").replace(/\/$/, "");
  const users: SequifiUserRecord[] = [];
  for (let page = 1; page <= 100; page++) {
    const res = await fetchWithTimeout(`${base}/v1/users?page=${page}&per_page=100`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Sequifi users request failed (${res.status}): ${text.slice(0, 200)}`);
    const payload = JSON.parse(text) as Record<string, unknown>;
    const batch = listFromPayload(payload, ["data.users", "users", "data"]);
    for (const row of batch) {
      const normalized = sequifiUserFromApi(row);
      if (normalized) users.push(normalized);
    }
    const data = payload.data as Record<string, unknown> | undefined;
    const lastPage = Number(data?.last_page ?? payload.last_page ?? page);
    if (!batch.length || batch.length < 100 || page >= lastPage) break;
  }
  return users;
}

async function fetchEnerfloRestUsers(): Promise<Record<string, unknown>[]> {
  const key = requireSetting(env.enerfloV1ApiKey, "ENERFLO_V1_API_KEY");
  const base = (env.enerfloV1BaseUrl ?? "https://enerflo.io").replace(/\/$/, "");
  const url = new URL(`${base}/api/v3/users`);
  if (env.enerfloCompanyId?.trim()) url.searchParams.set("company_id", env.enerfloCompanyId.trim());
  const res = await fetchWithTimeout(url.toString(), {
    headers: { "api-key": key, Accept: "application/json" },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Enerflo REST users request failed (${res.status}): ${text.slice(0, 200)}`);
  return listFromPayload(JSON.parse(text), ["results", "users", "data.users", "data"]);
}

async function fetchEnerfloGraphqlUsers(): Promise<EnerfloGraphqlUser[]> {
  const apiKey = requireSetting(
    env.enerfloGraphqlApiKey,
    "ENERFLO_GRAPHQL_API_KEY (generate a separate V2 key in Enerflo Settings > Users > Integrations)",
  );
  const org = requireSetting(env.enerfloOrgSlug, "ENERFLO_ORG_SLUG");
  const endpoint = env.enerfloGraphqlBaseUrl ?? "https://api.enerflo.io/graphql";
  const query = `
    query InactiveRepUsers($input: UserListInput) {
      fetchUserList(input: $input) {
        items {
          id email status isActive isOrgAdmin isPlatformAdmin
          createdAt lastLogin fullName
          userOrgs { isOrgAdmin roles { id name } }
        }
        totalPageCount currentPage
      }
    }
  `;
  const users: EnerfloGraphqlUser[] = [];
  for (let page = 1; page <= 100; page++) {
    const res = await fetchWithTimeout(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "x-org": org,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ query, variables: { input: { page, pageSize: 100 } } }),
    });
    const payload = (await res.json()) as {
      data?: { fetchUserList?: { items?: EnerfloGraphqlUser[]; totalPageCount?: number } };
      errors?: Array<{ message?: string }>;
    };
    if (!res.ok || payload.errors?.length) {
      const detail = payload.errors?.map(error => error.message).filter(Boolean).join("; ") || res.statusText;
      throw new Error(`Enerflo GraphQL users request failed (${res.status}): ${detail}`);
    }
    const list = payload.data?.fetchUserList;
    const batch = Array.isArray(list?.items) ? list.items : [];
    users.push(...batch);
    const totalPages = Number(list?.totalPageCount ?? page);
    if (!batch.length || page >= totalPages) break;
  }
  return users;
}

function buildEnerfloAccounts(
  restUsers: Record<string, unknown>[],
  graphqlUsers: EnerfloGraphqlUser[],
): SourceAccount[] {
  const graphqlById = new Map(graphqlUsers.map(user => [String(user.id), user]));
  const graphqlByEmail = new Map<string, EnerfloGraphqlUser[]>();
  for (const user of graphqlUsers) {
    const email = normalizeEmail(user.email);
    const rows = graphqlByEmail.get(email) ?? [];
    rows.push(user);
    graphqlByEmail.set(email, rows);
  }

  return restUsers.flatMap(row => {
    const id = String(row.id ?? row.userId ?? "").trim();
    const email = normalizeEmail(row.email);
    if (!id || !email) return [];
    const v2Id = String(row.v2_user_id ?? row.v2UserId ?? "").trim();
    const byEmail = graphqlByEmail.get(email) ?? [];
    const graphql = (v2Id && graphqlById.get(v2Id)) || (byEmail.length === 1 ? byEmail[0] : undefined);
    const restActive = asBoolean(row.active ?? row.is_active ?? row.status);
    const graphqlConflict = graphql && graphql.isActive !== restActive;
    const graphqlRoles = graphql?.userOrgs.flatMap(org => org.roles.map(role => role.name)) ?? [];
    const roles = [...new Set([...roleLabels(row.roles), ...graphqlRoles])];
    const name = String(
      row.name ?? `${String(row.first_name ?? "").trim()} ${String(row.last_name ?? "").trim()}`,
    ).trim();
    return [{
      platform: "enerflo" as const,
      id,
      secondaryId: v2Id || graphql?.id,
      email,
      name: name || graphql?.fullName || email,
      active: restActive,
      createdAt: asIso(graphql?.createdAt ?? row.created_at),
      lastLoginAt: asIso(graphql?.lastLogin),
      roles,
      isAdmin: Boolean(
        graphql?.isOrgAdmin ||
        graphql?.isPlatformAdmin ||
        graphql?.userOrgs.some(org => org.isOrgAdmin),
      ),
      evidenceSource: "Enerflo REST v3 + GraphQL V2 live lastLogin",
      evidenceIssue: !graphql
        ? "Enerflo REST user has no unique GraphQL identity match"
        : graphqlConflict
          ? "Enerflo REST and GraphQL active status conflict"
          : undefined,
    }];
  });
}

async function fetchMicrosoftAccounts(): Promise<SourceAccount[]> {
  const token = await getGraphAccessToken();
  const rows: SourceAccount[] = [];
  let url = `${GRAPH_BASE}/users?$top=999&$select=id,displayName,userPrincipalName,mail,userType,accountEnabled,createdDateTime,signInActivity`;
  for (let page = 1; page <= 20 && url; page++) {
    const res = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${token}` } });
    const text = await res.text();
    if (!res.ok) throw new Error(`Microsoft users request failed (${res.status}): ${text.slice(0, 200)}`);
    const payload = JSON.parse(text) as {
      value?: Array<Record<string, unknown>>;
      "@odata.nextLink"?: string;
    };
    for (const user of payload.value ?? []) {
      const id = String(user.id ?? "").trim();
      const email = normalizeEmail(user.mail ?? user.userPrincipalName);
      if (!id || !email || String(user.userType ?? "Member") !== "Member") continue;
      const signIn = user.signInActivity as Record<string, unknown> | undefined;
      rows.push({
        platform: "microsoft",
        id,
        email,
        name: String(user.displayName ?? email).trim(),
        active: user.accountEnabled === true,
        createdAt: asIso(user.createdDateTime),
        lastLoginAt: asIso(
          signIn?.lastSuccessfulSignInDateTime ?? signIn?.lastSignInDateTime,
        ),
        roles: [],
        isAdmin: false,
        evidenceSource: "Microsoft Graph live signInActivity",
      });
    }
    url = payload["@odata.nextLink"] ?? "";
  }
  return rows;
}

async function fetchTerrosAccounts(): Promise<SourceAccount[]> {
  const key = requireSetting(env.terrosApiKey, "TERROS_API_KEY");
  const base = (env.terrosApiBaseUrl ?? "https://api.terros.com").replace(/\/$/, "");
  const res = await fetchWithTimeout(`${base}/user/list`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `ApiKey ${key}` },
    body: "{}",
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Terros users request failed (${res.status}): ${text.slice(0, 200)}`);
  return listFromPayload(JSON.parse(text), ["users", "data", "results"]).flatMap(user => {
    const id = String(user.userId ?? user.id ?? "").trim();
    const email = normalizeEmail(user.email);
    if (!id || !email) return [];
    const roles = roleLabels(user.roles);
    const closerStatus = String(user.closerStatus ?? "").trim();
    if (closerStatus) roles.push(closerStatus);
    return [{
      platform: "terros" as const,
      id,
      email,
      name: `${String(user.firstName ?? "").trim()} ${String(user.lastName ?? "").trim()}`.trim(),
      active: !asBoolean(user.isDeleted),
      createdAt: null,
      lastLoginAt: asIso(user.lastAccess),
      roles: [...new Set(roles)],
      isAdmin: false,
      evidenceSource: "Terros /user/list live lastAccess",
    }];
  });
}

async function fetchSalesFeed(installer: string): Promise<SalesFeedData> {
  const key = requireSetting(env.publicDealsApiKey, "PUBLIC_DEALS_API_KEY");
  const base = (env.publicDealsApiBase ?? "https://hub.noxpwr.com/api/public/deals").replace(/\/$/, "");
  const rows: Record<string, unknown>[] = [];
  let table = "";
  let primaryKey = "";
  for (let page = 1; page <= 500; page++) {
    const res = await fetchWithTimeout(`${base}/${installer}?page=${page}&limit=100`, {
      headers: { "x-api-key": key, Accept: "application/json" },
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${installer} sales feed failed (${res.status}): ${text.slice(0, 200)}`);
    const payload = JSON.parse(text) as Record<string, unknown>;
    const batch = listFromPayload(payload, ["data", "deals", "results", "items"]);
    rows.push(...batch);
    table = String(payload.table ?? table);
    primaryKey = String(payload.pk ?? primaryKey);
    const hasMore = payload.hasMore === true;
    const total = Number(payload.total ?? rows.length);
    if (!batch.length || (!hasMore && rows.length >= total)) break;
  }
  return { installer, table, primaryKey, rows };
}

export async function fetchInactiveRepSourceSnapshot(): Promise<InactiveRepSourceSnapshot> {
  // Validate mail configuration here too so a report cannot be prepared if it cannot be sent.
  requireAzureConfig();
  const [
    sequifiUsers,
    enerfloRestUsers,
    enerfloGraphqlUsers,
    microsoftAccounts,
    terrosAccounts,
    salesFeeds,
  ] = await Promise.all([
    fetchSequifiUsersIncludingInactive(),
    fetchEnerfloRestUsers(),
    fetchEnerfloGraphqlUsers(),
    fetchMicrosoftAccounts(),
    fetchTerrosAccounts(),
    Promise.all(SALES_FEEDS.map(fetchSalesFeed)),
  ]);
  const enerfloAccounts = buildEnerfloAccounts(enerfloRestUsers, enerfloGraphqlUsers);
  return {
    sequifiUsers,
    accounts: {
      enerflo: enerfloAccounts,
      microsoft: microsoftAccounts,
      terros: terrosAccounts,
    },
    salesFeeds,
    sourceSummary: {
      sequifiUsers: sequifiUsers.length,
      enerfloRestUsers: enerfloRestUsers.length,
      enerfloGraphqlUsers: enerfloGraphqlUsers.length,
      microsoftUsers: microsoftAccounts.length,
      terrosUsers: terrosAccounts.length,
      salesRows: Object.fromEntries(salesFeeds.map(feed => [feed.installer, feed.rows.length])),
    },
  };
}
