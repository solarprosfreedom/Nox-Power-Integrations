import { env } from "@/lib/env";
import { enerfloV1 } from "@/lib/enerflo/client";
import { findUserByEmailInList } from "@/lib/sync/user-email-match";

export async function fetchAllEnerfloUsers(): Promise<Record<string, unknown>[]> {
  const base = (env.enerfloV1BaseUrl ?? "https://enerflo.io").replace(/\/$/, "");
  const key = env.enerfloV1ApiKey ?? "";
  const all: Record<string, unknown>[] = [];

  for (let page = 1; page <= 50; page++) {
    const url = `${base}/api/v3/users?page=${page}`;
    const res = await fetch(url, { headers: { "api-key": key } });
    if (!res.ok) break;
    const parsed = (await res.json()) as { results?: Record<string, unknown>[] };
    const batch = parsed.results ?? [];
    if (!batch.length) break;
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all;
}

export async function findEnerfloUserByEmail(
  email: string,
): Promise<{ id: string; email: string; exactMatch: boolean } | null> {
  const users = await fetchAllEnerfloUsers();
  const normalized = email.trim().toLowerCase();

  const exact = users.find(u => {
    const uEmail = typeof u.email === "string" ? u.email.trim().toLowerCase() : "";
    return uEmail === normalized;
  });
  if (exact) {
    const id = String(exact.id ?? exact.userId ?? "");
    const matchedEmail = typeof exact.email === "string" ? exact.email : email;
    return id ? { id, email: matchedEmail, exactMatch: true } : null;
  }

  const alias = findUserByEmailInList(email, users, u =>
    typeof u.email === "string" ? u.email : undefined,
  );
  if (!alias) return null;
  const id = String(alias.id ?? alias.userId ?? "");
  const matchedEmail = typeof alias.email === "string" ? alias.email : email;
  return id ? { id, email: matchedEmail, exactMatch: false } : null;
}

export async function createEnerfloUserForOnboarding(payload: {
  email: string;
  first_name: string;
  last_name: string;
  phone?: string;
  roles: string[];
  external_user_id: string;
  password?: string;
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
    return { id: null, ok: false, error: log.responsePreview || log.fetchError || "Enerflo create failed" };
  }

  try {
    const parsed = JSON.parse(log.responsePreview.replace(/\.\.\.$/, "")) as Record<string, unknown>;
    const user = (parsed.user ?? parsed.data ?? parsed) as Record<string, unknown>;
    const id = user?.id != null ? String(user.id) : null;
    return { id, ok: true };
  } catch {
    return { id: null, ok: true };
  }
}
