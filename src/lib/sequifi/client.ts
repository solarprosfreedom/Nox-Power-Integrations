import { env } from "@/lib/env";
import { sequifiUserFromApi } from "@/lib/onboarding/normalize";
import type { SequifiUserRecord } from "@/lib/onboarding/types";

function getSequifiBearer(): string {
  const token =
    env.sequifiAccessToken?.trim() ||
    env.sequifiApiKey?.trim();
  if (!token) {
    throw new Error(
      "Sequifi not configured. Set SEQUIFI_ACCESS_TOKEN (or SEQUIFI_API_KEY) in .env.local."
    );
  }
  return token;
}

function baseUrl(): string {
  return (env.sequifiApiBaseUrl ?? "https://marketplace-api.sequifi.com").replace(/\/$/, "");
}

/** Sequifi status_id = 1 is active (see GET /v1/users?status=active). */
const ACTIVE_STATUS_ID = 1;

export function isActiveSequifiUser(user: SequifiUserRecord): boolean {
  if (user.status_id == null) return true;
  return user.status_id === ACTIVE_STATUS_ID;
}

/** Fetches active reps only (`status=active` / status_id = 1). */
export async function fetchAllSequifiUsers(): Promise<SequifiUserRecord[]> {
  const bearer = getSequifiBearer();
  const all: SequifiUserRecord[] = [];

  for (let page = 1; page <= 100; page++) {
    const url = `${baseUrl()}/v1/users?page=${page}&per_page=100&status=active`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${bearer}`, Accept: "application/json" },
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Sequifi GET /v1/users failed (${res.status}): ${text.slice(0, 300)}`);
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new Error("Sequifi /v1/users returned invalid JSON");
    }

    const data = parsed.data as Record<string, unknown> | undefined;
    const users = (data?.users ?? parsed.users ?? parsed.data) as unknown;
    const batch = Array.isArray(users) ? users : [];
    if (!batch.length) break;

    for (const item of batch) {
      if (item && typeof item === "object") {
        const rec = sequifiUserFromApi(item as Record<string, unknown>);
        if (rec && isActiveSequifiUser(rec)) all.push(rec);
      }
    }

    const lastPage =
      typeof data?.last_page === "number"
        ? data.last_page
        : typeof parsed.last_page === "number"
          ? parsed.last_page
          : page;
    if (page >= lastPage || batch.length < 100) break;
  }

  return all;
}

export async function fetchSequifiUserById(id: number): Promise<SequifiUserRecord | null> {
  const bearer = getSequifiBearer();
  const url = `${baseUrl()}/v1/users/${id}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${bearer}`, Accept: "application/json" },
  });
  const text = await res.text();
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`Sequifi GET /v1/users/${id} failed (${res.status}): ${text.slice(0, 300)}`);
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`Sequifi /v1/users/${id} returned invalid JSON`);
  }

  const data = parsed.data as Record<string, unknown> | undefined;
  const users = data?.users;
  const fromUsers =
    Array.isArray(users) && users[0] && typeof users[0] === "object"
      ? (users[0] as Record<string, unknown>)
      : undefined;
  const raw =
    fromUsers ??
    (data?.user as Record<string, unknown> | undefined) ??
    (data as Record<string, unknown> | undefined) ??
    parsed;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (!fromUsers && !data?.user && "users" in raw) return null;

  const rec = sequifiUserFromApi(raw);
  if (!rec) return null;
  return rec;
}

export function filterUsersByGoLive(users: SequifiUserRecord[]): SequifiUserRecord[] {
  const goLive = env.onboardingGoLiveAt?.trim();
  if (!goLive) return users;
  const cutoff = new Date(goLive).getTime();
  if (Number.isNaN(cutoff)) return users;
  return users.filter(u => {
    if (!u.created_at) return false;
    const t = new Date(u.created_at).getTime();
    return !Number.isNaN(t) && t >= cutoff;
  });
}
