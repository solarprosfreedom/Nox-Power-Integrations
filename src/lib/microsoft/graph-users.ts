import { env } from "@/lib/env";
import { getGraphAccessToken, GRAPH_BASE, clearGraphAccessTokenCache } from "@/lib/microsoft/graph-auth";

export interface GraphUserResult {
  id: string;
  userPrincipalName: string;
  mail?: string;
}

export class GraphUserPermissionError extends Error {
  constructor(message = "Microsoft Graph User.Read.All permission required to look up users.") {
    super(message);
    this.name = "GraphUserPermissionError";
  }
}

function escapeODataString(value: string): string {
  return value.replace(/'/g, "''");
}

async function graphUserRequest(url: string, retried = false): Promise<Response> {
  const token = await getGraphAccessToken();
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 403 && !retried) {
    clearGraphAccessTokenCache();
    return graphUserRequest(url, true);
  }
  return res;
}

function parseGraphUser(data: {
  id?: string;
  userPrincipalName?: string;
  mail?: string;
}): GraphUserResult | null {
  if (!data.id || !data.userPrincipalName) return null;
  return {
    id: data.id,
    userPrincipalName: data.userPrincipalName,
    mail: data.mail,
  };
}

function assertGraphUserOk(res: Response, text: string): void {
  if (res.status === 403) {
    throw new GraphUserPermissionError();
  }
  if (!res.ok) {
    throw new Error(`Graph user lookup failed (${res.status}): ${text.slice(0, 200)}`);
  }
}

/** Direct GET by UPN — fast path when UPN is known. */
export async function findGraphUserByUpn(upn: string): Promise<GraphUserResult | null> {
  const res = await graphUserRequest(`${GRAPH_BASE}/users/${encodeURIComponent(upn)}`);
  const text = await res.text();
  if (res.status === 404) return null;
  assertGraphUserOk(res, text);
  const data = JSON.parse(text) as { id?: string; userPrincipalName?: string; mail?: string };
  return parseGraphUser(data);
}

/** Search by work UPN and/or primary mail (matches M365 admin "Username" column). */
export async function findGraphUserByEmailOrUpn(
  email: string,
  options?: { upn?: string },
): Promise<GraphUserResult | null> {
  const normalized = email.trim().toLowerCase();
  const upn = options?.upn?.trim().toLowerCase();
  const candidates = [...new Set([normalized, upn].filter(Boolean))] as string[];

  for (const candidate of candidates) {
    const direct = await findGraphUserByUpn(candidate);
    if (direct) return direct;
  }

  const filters = candidates.flatMap(candidate => [
    `userPrincipalName eq '${escapeODataString(candidate)}'`,
    `mail eq '${escapeODataString(candidate)}'`,
  ]);
  const filter = [...new Set(filters)].join(" or ");
  const url = `${GRAPH_BASE}/users?$filter=${encodeURIComponent(filter)}&$select=id,userPrincipalName,mail&$top=1`;
  const res = await graphUserRequest(url);
  const text = await res.text();
  if (res.status === 404) return null;
  assertGraphUserOk(res, text);
  const data = JSON.parse(text) as { value?: Array<{ id?: string; userPrincipalName?: string; mail?: string }> };
  const first = data.value?.[0];
  return first ? parseGraphUser(first) : null;
}

function msUsageLocation(): string {
  const code = env.msUsageLocation?.trim().toUpperCase() ?? "US";
  return /^[A-Z]{2}$/.test(code) ? code : "US";
}

export async function createGraphUser(options: {
  upn: string;
  firstName: string;
  lastName: string;
  displayName: string;
  password: string;
  mailNickname?: string;
}): Promise<GraphUserResult> {
  const token = await getGraphAccessToken();
  const localPart = options.upn.split("@")[0] ?? "user";
  const body: Record<string, unknown> = {
    accountEnabled: true,
    displayName: options.displayName,
    givenName: options.firstName || options.displayName,
    surname: options.lastName || ".",
    mailNickname: options.mailNickname ?? localPart.replace(/[^a-zA-Z0-9._-]/g, ""),
    userPrincipalName: options.upn,
    usageLocation: msUsageLocation(),
    passwordProfile: {
      forceChangePasswordNextSignIn: true,
      password: options.password,
    },
  };

  const res = await fetch(`${GRAPH_BASE}/users`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (res.status === 409) {
    const existing = await findGraphUserByUpn(options.upn);
    if (existing) return existing;
  }
  if (!res.ok) {
    throw new Error(`Graph create user failed (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = JSON.parse(text) as { id?: string; userPrincipalName?: string };
  if (!data.id || !data.userPrincipalName) {
    throw new Error("Graph create user returned unexpected response");
  }
  return { id: data.id, userPrincipalName: data.userPrincipalName };
}

function graphLicenseSkuId(): string | null {
  const skuId = env.msLicenseSkuId?.trim();
  return skuId && /^[0-9a-f-]{36}$/i.test(skuId) ? skuId : null;
}

export function isGraphLicenseAssignmentConfigured(): boolean {
  return env.onboardingAssignMsLicense && Boolean(graphLicenseSkuId());
}

async function graphUserHasLicenseSku(userId: string, skuId: string): Promise<boolean> {
  const res = await graphUserRequest(
    `${GRAPH_BASE}/users/${encodeURIComponent(userId)}?$select=assignedLicenses`,
  );
  const text = await res.text();
  if (!res.ok) return false;
  try {
    const data = JSON.parse(text) as {
      assignedLicenses?: Array<{ skuId?: string }>;
    };
    const normalized = skuId.toLowerCase();
    return (data.assignedLicenses ?? []).some(
      license => String(license.skuId ?? "").toLowerCase() === normalized,
    );
  } catch {
    return false;
  }
}

async function graphUserUsageLocation(userId: string): Promise<string | null> {
  const res = await graphUserRequest(
    `${GRAPH_BASE}/users/${encodeURIComponent(userId)}?$select=usageLocation`,
  );
  const text = await res.text();
  if (!res.ok) return null;
  try {
    const data = JSON.parse(text) as { usageLocation?: string };
    const loc = data.usageLocation?.trim().toUpperCase();
    return loc && /^[A-Z]{2}$/.test(loc) ? loc : null;
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Set usageLocation when missing — required for Exchange license assignment. */
export async function ensureGraphUserUsageLocation(userId: string): Promise<void> {
  const target = msUsageLocation();
  const current = await graphUserUsageLocation(userId);
  if (current === target) return;

  const token = await getGraphAccessToken();
  const res = await fetch(`${GRAPH_BASE}/users/${encodeURIComponent(userId)}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ usageLocation: target }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Graph set usageLocation failed (${res.status}): ${text.slice(0, 300)}`);
  }

  // Graph may reject assignLicense until usageLocation replicates.
  for (let attempt = 0; attempt < 5; attempt++) {
    await sleep(attempt === 0 ? 1500 : 2000);
    const loc = await graphUserUsageLocation(userId);
    if (loc === target) return;
  }
  throw new Error(`Graph usageLocation ${target} not visible after PATCH`);
}

/** Assign Exchange / M365 license sku after user create (requires User.ReadWrite.All). */
export async function assignGraphUserLicense(userId: string): Promise<{
  assigned: boolean;
  alreadyAssigned: boolean;
}> {
  const skuId = graphLicenseSkuId();
  if (!skuId) {
    throw new Error("MS_LICENSE_SKU_ID is not configured or invalid");
  }

  if (await graphUserHasLicenseSku(userId, skuId)) {
    return { assigned: true, alreadyAssigned: true };
  }

  await ensureGraphUserUsageLocation(userId);

  const token = await getGraphAccessToken();
  let lastText = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await sleep(2000);
    const res = await fetch(`${GRAPH_BASE}/users/${encodeURIComponent(userId)}/assignLicense`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        addLicenses: [{ skuId, disabledPlans: [] }],
        removeLicenses: [],
      }),
    });

    lastText = await res.text();
    if (res.ok) {
      return { assigned: true, alreadyAssigned: false };
    }

    if (
      lastText.toLowerCase().includes("invalid usage location") &&
      attempt < 3
    ) {
      await ensureGraphUserUsageLocation(userId);
      continue;
    }

    if (lastText.toLowerCase().includes("already") && (await graphUserHasLicenseSku(userId, skuId))) {
      return { assigned: true, alreadyAssigned: true };
    }

    break;
  }

  throw new Error(`Graph assignLicense failed: ${lastText.slice(0, 300)}`);
}

export async function ensureGraphUserLicensed(userId: string): Promise<{
  assigned: boolean;
  alreadyAssigned: boolean;
  skipped: boolean;
}> {
  if (!env.onboardingAssignMsLicense) {
    return { assigned: false, alreadyAssigned: false, skipped: true };
  }
  const result = await assignGraphUserLicense(userId);
  return { ...result, skipped: false };
}

export function resolveUpnForUser(
  email: string,
  firstName: string,
  lastName: string,
): string {
  const domain = env.msDefaultDomain?.trim() || "noxpwr.com";
  const normalizedEmail = email.trim().toLowerCase();
  if (normalizedEmail.includes("@") && normalizedEmail.endsWith(`@${domain}`)) {
    return normalizedEmail;
  }
  const local = `${firstName}${lastName}`.toLowerCase().replace(/[^a-z0-9]/g, "");
  return `${local || "user"}@${domain}`;
}
