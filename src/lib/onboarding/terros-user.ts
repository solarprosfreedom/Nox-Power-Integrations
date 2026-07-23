import { env } from "@/lib/env";
import { postTerros } from "@/lib/sync/terros-api";
import { fetchTerrosUsers, resolveTerrosUserFromList } from "@/lib/sync/terros-users";

export async function findTerrosUserByExactEmail(
  email: string,
): Promise<{ userId: string; email: string } | null> {
  const base = env.terrosApiBaseUrl ?? "https://api.terros.com";
  const key = env.terrosApiKey ?? "";
  const users = await fetchTerrosUsers(base, key);
  const normalized = email.trim().toLowerCase();

  const exact = users.find(u => {
    const uEmail = typeof u.email === "string" ? u.email.trim().toLowerCase() : "";
    return uEmail === normalized;
  });
  if (!exact?.userId) return null;
  return {
    userId: String(exact.userId),
    email: typeof exact.email === "string" ? exact.email : email,
  };
}

export async function findTerrosUserByEmail(
  email: string,
): Promise<{ userId: string; email: string; exactMatch: boolean } | null> {
  const base = env.terrosApiBaseUrl ?? "https://api.terros.com";
  const key = env.terrosApiKey ?? "";
  const users = await fetchTerrosUsers(base, key);
  const normalized = email.trim().toLowerCase();

  const exact = users.find(u => {
    const uEmail = typeof u.email === "string" ? u.email.trim().toLowerCase() : "";
    return uEmail === normalized;
  });
  if (exact?.userId) {
    return {
      userId: String(exact.userId),
      email: typeof exact.email === "string" ? exact.email : email,
      exactMatch: true,
    };
  }

  const alias = resolveTerrosUserFromList(email, users);
  if (!alias?.userId) return null;
  return {
    userId: String(alias.userId),
    email: typeof alias.email === "string" ? alias.email : email,
    exactMatch: false,
  };
}

export async function createTerrosUserForOnboarding(payload: {
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  name?: string;
  password?: string;
  roles?: string[];
  /**
   * Terros team to assign the new user to. Required as of ~2026-07-17 —
   * Terros now rejects POST /user/add with "All users in your company must
   * be part of a team" if omitted. Must be sent as a TOP-LEVEL sibling of
   * `user` (NOT nested inside the user object) — confirmed live; nesting it
   * under `user` (as `teamId`/`team`/`teams`/`memberOf`) still triggers the
   * same error. Resolve via resolveTerrosTeamForOffice().
   */
  teamId?: string;
}): Promise<{ userId: string | null; ok: boolean; created: boolean; error?: string }> {
  const base = env.terrosApiBaseUrl ?? "https://api.terros.com";
  const key = env.terrosApiKey ?? "";
  const displayName =
    payload.name?.trim() || [payload.firstName, payload.lastName].filter(Boolean).join(" ").trim();

  const userFields: Record<string, unknown> = {
    email: payload.email,
    firstName: payload.firstName,
    lastName: payload.lastName,
    name: displayName,
  };
  if (payload.phone) userFields.phone = payload.phone;
  if (payload.password) userFields.password = payload.password;
  if (payload.roles?.length) userFields.roles = payload.roles;

  const requestBody: Record<string, unknown> = { user: userFields };
  if (payload.teamId) requestBody.teamId = payload.teamId;

  const { ok, text, status } = await postTerros(base, key, "/user/add", requestBody);

  if (!ok) {
    if (text.toLowerCase().includes("exist") || text.toLowerCase().includes("duplicate")) {
      const existing = await findTerrosUserByExactEmail(payload.email);
      if (existing) return { userId: existing.userId, ok: true, created: false };
    }
    return { userId: null, ok: false, created: false, error: `Terros ${status}: ${text.slice(0, 300)}` };
  }

  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const user = (parsed.user ?? parsed.data ?? parsed) as Record<string, unknown>;
    const userId = user?.userId ?? user?.id;
    return { userId: userId != null ? String(userId) : null, ok: true, created: true };
  } catch {
    const existing = await findTerrosUserByExactEmail(payload.email);
    return { userId: existing?.userId ?? null, ok: true, created: false };
  }
}
