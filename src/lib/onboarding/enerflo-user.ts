import { env } from "@/lib/env";
import { enerfloV1 } from "@/lib/enerflo/client";
import { emailsMatch } from "@/lib/sync/user-email-match";

function extractEnerfloUserList(parsed: unknown): Record<string, unknown>[] {
  if (!parsed || typeof parsed !== "object") return [];
  const p = parsed as Record<string, unknown>;
  for (const key of ["results", "data", "users", "items"]) {
    if (Array.isArray(p[key])) return p[key] as Record<string, unknown>[];
  }
  return [];
}

function getUserCompanyId(user: Record<string, unknown>): string {
  const value = user.company_id ?? user.companyId ?? user.companyID;
  if (typeof value === "number") return String(value);
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return value.trim();
  return "";
}

function getUserRoles(user: Record<string, unknown>): string[] {
  const rolesValue = user.roles as string[] | string | undefined;
  if (Array.isArray(rolesValue)) return rolesValue.map(r => String(r).trim().toLowerCase());
  if (typeof rolesValue === "string" && rolesValue) {
    return rolesValue.split(",").map(r => r.trim().toLowerCase());
  }
  if (user.role) return [String(user.role).trim().toLowerCase()];
  return [];
}

function detectTargetCompanyId(users: Record<string, unknown>[]): string {
  const envCompanyId = env.enerfloCompanyId?.trim() ?? "";
  if (/^\d+$/.test(envCompanyId)) return envCompanyId;

  for (const user of users) {
    if (getUserRoles(user).includes("supercompany")) {
      const companyId = getUserCompanyId(user);
      if (companyId) return companyId;
    }
  }

  const counts = new Map<string, number>();
  for (const user of users) {
    const companyId = getUserCompanyId(user);
    if (companyId) counts.set(companyId, (counts.get(companyId) ?? 0) + 1);
  }

  let targetCompanyId = "";
  let max = 0;
  for (const [companyId, count] of counts) {
    if (count > max) {
      max = count;
      targetCompanyId = companyId;
    }
  }
  return targetCompanyId;
}

async function fetchEnerfloUserPage(
  base: string,
  key: string,
  page: number,
  extraQuery = "",
): Promise<Record<string, unknown>[]> {
  const res = await fetch(`${base}/api/v3/users?page=${page}&pageSize=100${extraQuery}`, {
    headers: { "api-key": key, "Content-Type": "application/json" },
  });
  if (!res.ok) return [];
  try {
    return extractEnerfloUserList(await res.json());
  } catch {
    return [];
  }
}

/** Full Enerflo user list — no company filter (lookup must see all sub-companies). */
export async function fetchEnerfloUsersUnscoped(): Promise<Record<string, unknown>[]> {
  const base = (env.enerfloV1BaseUrl ?? "https://enerflo.io").replace(/\/$/, "");
  const key = env.enerfloV1ApiKey ?? "";
  const all: Record<string, unknown>[] = [];

  for (let page = 1; page <= 50; page++) {
    const batch = await fetchEnerfloUserPage(base, key, page);
    if (!batch.length) break;
    all.push(...batch);
    if (batch.length < 100) break;
  }

  const seenEmails = new Set(
    all.map(u => String(u.email ?? "").trim().toLowerCase()).filter(Boolean),
  );
  for (let page = 1; page <= 50; page++) {
    const batch = await fetchEnerfloUserPage(base, key, page, "&status=inactive");
    if (!batch.length) break;
    for (const user of batch) {
      const email = String(user.email ?? "").trim().toLowerCase();
      if (email && !seenEmails.has(email)) {
        all.push(user);
        seenEmails.add(email);
      }
    }
    if (batch.length < 100) break;
  }

  return all;
}

/** Company-scoped list for roster-style use. */
export async function fetchAllEnerfloUsers(): Promise<Record<string, unknown>[]> {
  const all = await fetchEnerfloUsersUnscoped();
  const targetCompanyId = detectTargetCompanyId(all);
  return targetCompanyId ? all.filter(u => getUserCompanyId(u) === targetCompanyId) : all;
}

function externalIdsForUser(user: Record<string, unknown>): string[] {
  const ids = new Set<string>();
  const push = (value: unknown) => {
    const text = String(value ?? "").trim().toLowerCase();
    if (text) ids.add(text);
  };

  push(user.external_user_id);
  push(user.externalUserId);

  const meta = user.meta as Record<string, unknown> | undefined;
  const epc = meta?.epc_external_ids;
  if (epc && typeof epc === "object") {
    for (const value of Object.values(epc as Record<string, unknown>)) {
      push(value);
    }
  }

  const agent = user.agent as Record<string, unknown> | undefined;
  push(agent?.external_user_id);

  return [...ids];
}

function emailMatchesOnboardingLookup(
  userEmail: string,
  primaryEmail: string,
  alternateEmails: string[],
): boolean {
  if (!userEmail) return false;
  const primary = primaryEmail.trim().toLowerCase();
  if (userEmail === primary) return true;
  if (emailsMatch(primary, userEmail)) return true;
  return alternateEmails.some(alt => {
    const normalized = alt.trim().toLowerCase();
    return normalized && (userEmail === normalized || emailsMatch(normalized, userEmail));
  });
}

function matchEnerfloUserRow(
  user: Record<string, unknown>,
  primaryEmail: string,
  alternateEmails: string[],
  externalUserId?: string,
): { exactMatch: boolean } | null {
  const userEmail = typeof user.email === "string" ? user.email.trim().toLowerCase() : "";
  const emailMatch = emailMatchesOnboardingLookup(userEmail, primaryEmail, alternateEmails);
  if (!emailMatch) return null;

  const exactMatch = userEmail === primaryEmail.trim().toLowerCase();
  const externalNeedle = externalUserId?.trim().toLowerCase() ?? "";
  if (externalNeedle && externalIdsForUser(user).includes(externalNeedle)) {
    return { exactMatch: exactMatch || userEmail === primaryEmail.trim().toLowerCase() };
  }

  return { exactMatch };
}

export function isEnerfloEmailTakenError(responsePreview: string): boolean {
  const lower = responsePreview.toLowerCase();
  return (
    lower.includes("already been taken") ||
    lower.includes("email has already been taken") ||
    lower.includes("email already exists") ||
    lower.includes("duplicate email")
  );
}

export function enerfloEmailTakenWithoutUserError(email: string): string {
  return (
    `Enerflo rejected ${email} as already taken, but no matching user appears in the Enerflo API user list (active or inactive). ` +
    `The address may be reserved on a deleted account — contact Enerflo support to release it, or use a different test hire.`
  );
}

export async function findEnerfloUserByEmail(
  email: string,
  alternateEmails: string[] = [],
  externalUserId?: string,
): Promise<{ id: string; email: string; exactMatch: boolean } | null> {
  const users = await fetchEnerfloUsersUnscoped();
  const externalNeedle = externalUserId?.trim().toLowerCase() ?? "";

  for (const user of users) {
    const match = matchEnerfloUserRow(user, email, alternateEmails, externalNeedle);
    if (!match) continue;
    const id = String(user.id ?? user.userId ?? "");
    const matchedEmail = typeof user.email === "string" ? user.email : email;
    if (id) return { id, email: matchedEmail, exactMatch: match.exactMatch };
  }

  return null;
}

export async function createEnerfloUserForOnboarding(payload: {
  email: string;
  first_name: string;
  last_name: string;
  phone?: string;
  roles: string[];
  external_user_id: string;
  password?: string;
  alternateEmails?: string[];
}): Promise<{ id: string | null; ok: boolean; error?: string }> {
  const log = await enerfloV1({
    operation: "onboarding:enerflo:create",
    method: "POST",
    path: "/api/v1/users",
    body: {
      email: payload.email,
      first_name: payload.first_name,
      last_name: payload.last_name,
      phone: payload.phone,
      roles: payload.roles,
      external_user_id: payload.external_user_id,
      password: payload.password,
      notify_email: true,
      allow_optimus: false,
      can_create_customers: true,
      can_reassign_leads: true,
      timezone: "America/Phoenix",
    },
  });

  if (!log.ok) {
    const responsePreview = log.responsePreview || log.fetchError || "Enerflo create failed";
    if (isEnerfloEmailTakenError(responsePreview)) {
      const existing = await findEnerfloUserByEmail(
        payload.email,
        payload.alternateEmails,
        payload.external_user_id,
      );
      if (existing) return { id: existing.id, ok: true };
      return { id: null, ok: false, error: enerfloEmailTakenWithoutUserError(payload.email) };
    }
    return { id: null, ok: false, error: responsePreview };
  }

  try {
    const parsed = JSON.parse(log.responsePreview.replace(/\.\.\.$/, "")) as Record<string, unknown>;
    const user = (parsed.user ?? parsed.data ?? parsed) as Record<string, unknown>;
    const id = user?.id != null ? String(user.id) : null;
    if (id) return { id, ok: true };

    const existing = await findEnerfloUserByEmail(
      payload.email,
      payload.alternateEmails,
      payload.external_user_id,
    );
    if (existing) return { id: existing.id, ok: true };
    return {
      id: null,
      ok: false,
      error: `Enerflo create returned OK but no user id for ${payload.email}`,
    };
  } catch {
    const existing = await findEnerfloUserByEmail(
      payload.email,
      payload.alternateEmails,
      payload.external_user_id,
    );
    if (existing) return { id: existing.id, ok: true };
    return {
      id: null,
      ok: false,
      error: `Enerflo create returned OK but response could not be parsed for ${payload.email}`,
    };
  }
}
