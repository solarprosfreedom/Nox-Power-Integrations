/** Resolve Enerflo rep emails to Terros user IDs for sync + webhooks. */

import { postTerros } from "@/lib/sync/terros-api";
import {
  expandEmailCandidates,
  findUserByEmailInList,
} from "@/lib/sync/user-email-match";

export { expandEmailCandidates, emailsMatch, resolveEmailFromUserList } from "@/lib/sync/user-email-match";

export function resolveTerrosUserIdFromList(
  email: string,
  users: Record<string, unknown>[],
): string | null {
  const match = findUserByEmailInList(email, users, (u) =>
    typeof u.email === "string" ? u.email : undefined,
  );
  return (match?.userId as string | undefined) ?? null;
}

export function resolveTerrosUserFromList(
  email: string,
  users: Record<string, unknown>[],
): Record<string, unknown> | undefined {
  return findUserByEmailInList(email, users, (u) =>
    typeof u.email === "string" ? u.email : undefined,
  );
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
      const users = (parsed.users ?? parsed.data ?? parsed.results) as
        | Record<string, unknown>[]
        | undefined;
      if (!Array.isArray(users) || users.length === 0) break;
      allUsers.push(...users);
      if (users.length < 100) break;
    }
  } catch {
    /* best-effort */
  }
  return allUsers;
}

export async function resolveTerrosUserIdByEmail(
  terrosBase: string,
  terrosKey: string,
  email: string,
): Promise<{ userId: string | null; status: number | null; ok: boolean; preview: string }> {
  const candidates = expandEmailCandidates(email);
  try {
    const allUsers = await fetchTerrosUsers(terrosBase, terrosKey);
    const match = resolveTerrosUserFromList(email, allUsers);
    const userId = (match?.userId as string | undefined) ?? null;
    const preview =
      `totalFetched:${allUsers.length} candidates:${JSON.stringify(candidates.slice(0, 8))}` +
      (candidates.length > 8 ? "…" : "") +
      ` matched:${match && typeof match.email === "string" ? match.email : "none"} userId:${userId ?? "null"}`;
    return { userId, status: 200, ok: true, preview };
  } catch (e) {
    const preview = e instanceof Error ? e.message : String(e);
    return { userId: null, status: null, ok: false, preview };
  }
}
