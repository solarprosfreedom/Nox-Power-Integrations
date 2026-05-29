import { env } from "@/lib/env";
import { postTerros } from "@/lib/sync/terros-api";
import { fetchTerrosUsers, resolveTerrosUserFromList } from "@/lib/sync/terros-users";

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
  sendWelcomeEmail?: boolean;
}): Promise<{ userId: string | null; ok: boolean; error?: string }> {
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

  const { ok, text, status } = await postTerros(base, key, "/user/add", { user: userFields });

  if (!ok) {
    if (text.toLowerCase().includes("exist") || text.toLowerCase().includes("duplicate")) {
      const existing = await findTerrosUserByEmail(payload.email);
      if (existing) return { userId: existing.userId, ok: true };
    }
    return { userId: null, ok: false, error: `Terros ${status}: ${text.slice(0, 300)}` };
  }

  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const user = (parsed.user ?? parsed.data ?? parsed) as Record<string, unknown>;
    const userId = user?.userId ?? user?.id;
    const result = { userId: userId != null ? String(userId) : null, ok: true as const };
    if (payload.sendWelcomeEmail) {
      await sendTerrosWelcomeViaImport(base, key, payload);
    }
    return result;
  } catch {
    const existing = await findTerrosUserByEmail(payload.email);
    const result = { userId: existing?.userId ?? null, ok: true as const };
    if (payload.sendWelcomeEmail) {
      await sendTerrosWelcomeViaImport(base, key, payload);
    }
    return result;
  }
}

async function sendTerrosWelcomeViaImport(
  base: string,
  key: string,
  payload: {
    email: string;
    firstName: string;
    lastName: string;
    phone?: string;
    password?: string;
    roles?: string[];
  },
): Promise<void> {
  const record: Record<string, unknown> = {
    email: payload.email,
    firstName: payload.firstName,
    lastName: payload.lastName,
  };
  if (payload.phone) record.phone = payload.phone;
  if (payload.password) record.password = payload.password;
  if (payload.roles?.length) record.roles = payload.roles;

  await postTerros(
    base,
    key,
    "/import",
    {
      entity: "User",
      notifyUsers: true,
      addMissingUsers: false,
      records: [record],
    },
    { retries: 1 },
  );
}
