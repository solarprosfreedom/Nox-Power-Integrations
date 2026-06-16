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
  // Terros /user/list ignores page/pageSize and returns ALL users in a single
  // response. The previous paginated loop therefore re-fetched the same full
  // list up to 10 times (duplicated data + wasted API calls); one request is
  // both correct and far cheaper.
  try {
    const { ok, text } = await postTerros(terrosBase, terrosKey, "/user/list", {});
    if (!ok) return [];
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const users = (parsed.users ?? parsed.data ?? parsed.results) as
      | Record<string, unknown>[]
      | undefined;
    return Array.isArray(users) ? users : [];
  } catch {
    /* best-effort */
    return [];
  }
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
