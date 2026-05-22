/** Resolve Enerflo rep emails to Terros user IDs for sync execute paths. */

import { postTerros } from "@/lib/sync/terros-api";

const DOMAIN_ALIASES: string[][] = [
  ["noxpwr.com", "solarpros.io"],
];

export function expandEmailCandidates(email: string): string[] {
  const needle = email.trim().toLowerCase();
  const stripped = needle.replace(/\+[^@]*(@)/, "$1");
  const set = new Set([needle, stripped].filter(Boolean));
  for (const e of [...set]) {
    const atIdx = e.lastIndexOf("@");
    if (atIdx === -1) continue;
    const local = e.slice(0, atIdx);
    const domain = e.slice(atIdx + 1);
    for (const group of DOMAIN_ALIASES) {
      if (group.includes(domain)) {
        for (const alt of group) {
          if (alt !== domain) set.add(`${local}@${alt}`);
        }
      }
    }
  }
  return [...set];
}

export function resolveTerrosUserIdFromList(
  email: string,
  users: Record<string, unknown>[],
): string | null {
  const candidates = expandEmailCandidates(email);
  const match = users.find((u) => {
    if (typeof u.email !== "string") return false;
    const userCandidates = expandEmailCandidates(u.email);
    return userCandidates.some((ue) => candidates.includes(ue));
  });
  return (match?.userId as string | undefined) ?? null;
}

export async function fetchTerrosUsers(
  terrosBase: string,
  terrosKey: string,
): Promise<Record<string, unknown>[]> {
  const allUsers: Record<string, unknown>[] = [];
  try {
    for (let page = 1; page <= 10; page++) {
      const { ok, text } = await postTerros(
        terrosBase,
        terrosKey,
        "/user/list",
        page === 1 ? {} : { page, pageSize: 100 },
      );
      if (!ok) break;
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const users = (parsed.users ?? parsed.data ?? parsed.results) as Record<string, unknown>[] | undefined;
      if (!Array.isArray(users) || users.length === 0) break;
      allUsers.push(...users);
      if (users.length < 100) break;
    }
  } catch { /* best-effort */ }
  return allUsers;
}
