import { env } from "@/lib/env";
import { fetchTerrosUsers } from "@/lib/sync/terros-users";
import { parseOfficeName } from "@/lib/google-sheets/roster-map";

export interface TerrosTeamRef {
  teamId: string;
  teamName: string;
}

export type TerrosTeamResolution = { ok: true; team: TerrosTeamRef } | { ok: false; reason: string };

/**
 * Terros team names sometimes carry their own trailing "(Region)" suffix
 * (e.g. "Prosper (Mambas)") that doesn't line up 1:1 with Sequifi's
 * office_name suffix (e.g. plain "Prosper", or "Scarface (Envision)" vs
 * Terros's plain "Scarface") — strip it from BOTH sides before comparing so
 * either convention still matches.
 */
export function canonicalTeamKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Pure builder: {canonical name -> team(s)} from a raw Terros /user/list
 * response (each user's `memberOf` carries their team refs). Exported
 * separately from the live fetch so tests can feed a fixture list.
 */
export function buildTerrosTeamCatalog(users: Record<string, unknown>[]): Map<string, TerrosTeamRef[]> {
  const byKey = new Map<string, TerrosTeamRef[]>();
  const seenTeamIds = new Set<string>();

  for (const user of users) {
    const memberOf = user.memberOf;
    if (!Array.isArray(memberOf)) continue;
    for (const entry of memberOf) {
      if (!entry || typeof entry !== "object") continue;
      const row = entry as Record<string, unknown>;
      const teamId = String(row.teamId ?? "").trim();
      const name = String(row.name ?? "").trim();
      if (!teamId || !name || seenTeamIds.has(teamId)) continue;
      seenTeamIds.add(teamId);

      const canonical = canonicalTeamKey(name);
      const list = byKey.get(canonical) ?? [];
      list.push({ teamId, teamName: name });
      byKey.set(canonical, list);
    }
  }

  return byKey;
}

/**
 * Pure matcher: resolve a Sequifi office_name against an already-built team
 * catalog. Exported separately so tests can exercise the matching rules
 * (exact-after-stripping, no match, ambiguous match) without any network
 * calls — see resolveTerrosTeamForOffice() for the live-fetching wrapper.
 */
export function matchTerrosTeamForOffice(
  officeName: string | null | undefined,
  catalog: Map<string, TerrosTeamRef[]>,
): TerrosTeamResolution {
  const office = parseOfficeName(officeName);
  const baseName = office.team.trim();
  if (!baseName) {
    return {
      ok: false,
      reason: `No Sequifi office_name to resolve a Terros team from (got "${officeName ?? ""}")`,
    };
  }

  const needle = canonicalTeamKey(baseName);
  const matches = catalog.get(needle) ?? [];

  if (matches.length === 1) {
    return { ok: true, team: matches[0]! };
  }
  if (matches.length === 0) {
    return {
      ok: false,
      reason: `No Terros team found matching Sequifi office "${officeName}" (looked for "${baseName}")`,
    };
  }
  return {
    ok: false,
    reason:
      `Ambiguous Terros team for Sequifi office "${officeName}" — ${matches.length} teams named ` +
      `"${baseName}" (${matches.map(m => m.teamId).join(", ")})`,
  };
}

interface TeamCatalogCache {
  byKey: Map<string, TerrosTeamRef[]>;
  fetchedAt: number;
}

let cachedCatalog: TeamCatalogCache | null = null;
const CATALOG_TTL_MS = 10 * 60 * 1000;

/**
 * Builds (and caches for 10 min, since a single onboarding cron run can
 * process several jobs) the team catalog from Terros's live /user/list.
 */
async function loadTeamCatalog(base: string, key: string): Promise<Map<string, TerrosTeamRef[]>> {
  if (cachedCatalog && Date.now() - cachedCatalog.fetchedAt < CATALOG_TTL_MS) {
    return cachedCatalog.byKey;
  }

  const users = await fetchTerrosUsers(base, key);
  const byKey = buildTerrosTeamCatalog(users);
  cachedCatalog = { byKey, fetchedAt: Date.now() };
  return byKey;
}

/** Test-only: force the next call to loadTeamCatalog() to refetch. */
export function _resetTerrosTeamCatalogCacheForTests(): void {
  cachedCatalog = null;
}

/**
 * Resolve a Sequifi `office_name` (e.g. "Beast Coast (Abundance)") to a
 * Terros team.
 *
 * Terros started rejecting POST /user/add with "All users in your company
 * must be part of a team" around 2026-07-17 (previously team membership was
 * optional) — confirmed live that a top-level `teamId` sibling of `user` on
 * /user/add satisfies this and correctly assigns the team (verify via
 * /user/get, NOT /user/list — that endpoint's `memberOf` is unreliable).
 * See createTerrosUserForOnboarding's `teamId` param.
 *
 * Matches on the base team name with any trailing "(Region)" suffix
 * stripped from both sides. Returns ok:false (never guesses) when there's
 * no match or more than one team shares the same base name (e.g. Terros has
 * three teams literally named "Drivin") — callers should fail the job
 * cleanly with the reason rather than assign a possibly-wrong team.
 */
export async function resolveTerrosTeamForOffice(
  officeName: string | null | undefined,
): Promise<TerrosTeamResolution> {
  const base = env.terrosApiBaseUrl ?? "https://api.terros.com";
  const key = env.terrosApiKey ?? "";
  const catalog = await loadTeamCatalog(base, key);
  return matchTerrosTeamForOffice(officeName, catalog);
}
