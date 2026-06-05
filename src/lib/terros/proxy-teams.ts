import { postTerros } from "@/lib/sync/terros-api";
import { fetchTerrosUsers } from "@/lib/sync/terros-users";

export interface TerrosTeamRef {
  teamId: string;
  teamName: string;
}

function extractUsers(parsed: Record<string, unknown>): Record<string, unknown>[] {
  const users = parsed.users ?? parsed.data ?? parsed.results;
  return Array.isArray(users) ? (users as Record<string, unknown>[]) : [];
}

/** Resolve Terros teamId from a display name (e.g. "Scarface"). */
export async function resolveTerrosTeamIdByName(
  base: string,
  key: string,
  teamName: string,
): Promise<TerrosTeamRef | null> {
  const needle = teamName.trim().toLowerCase();
  if (!needle) return null;

  const users = await fetchTerrosUsers(base, key);
  for (const user of users) {
    const memberOf = user.memberOf;
    if (!Array.isArray(memberOf)) continue;
    for (const entry of memberOf) {
      if (!entry || typeof entry !== "object") continue;
      const row = entry as Record<string, unknown>;
      const name = String(row.name ?? "").trim();
      const teamId = String(row.teamId ?? "").trim();
      if (teamId && name.toLowerCase() === needle) {
        return { teamId, teamName: name };
      }
    }
  }
  return null;
}

/** All active users on a Terros team (POST /user/list { teamId }). */
export async function fetchTerrosUsersForTeam(
  base: string,
  key: string,
  teamId: string,
): Promise<Record<string, unknown>[]> {
  const allUsers: Record<string, unknown>[] = [];
  const id = teamId.trim();
  if (!id) return allUsers;

  try {
    for (let page = 1; page <= 20; page++) {
      const body =
        page === 1
          ? { teamId: id, size: 500 }
          : { teamId: id, page, pageSize: 500 };
      const { ok, text } = await postTerros(base, key, "/user/list", body);
      if (!ok) break;
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const users = extractUsers(parsed);
      if (!users.length) break;
      allUsers.push(...users);
      if (users.length < 500) break;
    }
  } catch {
    /* best-effort */
  }

  return allUsers;
}

export function terrosUserIdsFromUsers(users: Record<string, unknown>[]): string[] {
  const ids = new Set<string>();
  for (const user of users) {
    const userId = String(user.userId ?? user.id ?? "").trim();
    if (userId) ids.add(userId);
  }
  return [...ids];
}
