/**
 * Cross-platform user email matching (Enerflo ↔ Terros).
 * Handles domain aliases, +tags, middle-initial local parts, and optional env alias map.
 */

import { env } from "@/lib/env";

const DOMAIN_ALIASES: string[][] = [["noxpwr.com", "solarpros.io"]];

let cachedAliasMap: Record<string, string> | null = null;

function getEmailAliasMap(): Record<string, string> {
  if (cachedAliasMap) return cachedAliasMap;
  cachedAliasMap = {};
  const raw = env.userEmailAliasesJson?.trim();
  if (!raw) return cachedAliasMap;
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    for (const [k, v] of Object.entries(parsed)) {
      if (k && v) {
        cachedAliasMap[k.trim().toLowerCase()] = v.trim().toLowerCase();
      }
    }
  } catch {
    /* ignore invalid JSON */
  }
  return cachedAliasMap;
}

/** Local-part variants: original plus drop-one-char (middle initial) permutations. */
export function localPartVariants(local: string): string[] {
  const normalized = local.trim().toLowerCase();
  const set = new Set<string>([normalized]);
  if (normalized.length >= 6 && !/[._-]/.test(normalized)) {
    for (let i = 1; i < normalized.length - 1; i++) {
      set.add(normalized.slice(0, i) + normalized.slice(i + 1));
    }
  }
  return [...set];
}

function addEmailVariants(set: Set<string>, local: string, domain: string): void {
  for (const loc of localPartVariants(local)) {
    set.add(`${loc}@${domain}`);
    for (const group of DOMAIN_ALIASES) {
      if (group.includes(domain)) {
        for (const alt of group) {
          if (alt !== domain) set.add(`${loc}@${alt}`);
        }
      }
    }
  }
}

/** All email strings that should match the same person across Enerflo/Terros. */
export function expandEmailCandidates(email: string, aliasDepth = 0): string[] {
  const needle = email.trim().toLowerCase();
  if (!needle.includes("@")) return [];

  const stripped = needle.replace(/\+[^@]*(@)/, "$1");
  const set = new Set<string>();

  for (const e of [needle, stripped]) {
    const atIdx = e.lastIndexOf("@");
    if (atIdx === -1) continue;
    addEmailVariants(set, e.slice(0, atIdx), e.slice(atIdx + 1));
  }

  if (aliasDepth < 2) {
    const aliasMap = getEmailAliasMap();
    for (const e of [...set]) {
      const mapped = aliasMap[e];
      if (mapped) {
        for (const m of expandEmailCandidates(mapped, aliasDepth + 1)) {
          set.add(m);
        }
      }
    }
  }

  return [...set].filter(Boolean);
}

export function emailsMatch(sourceEmail: string, targetEmail: string): boolean {
  const source = expandEmailCandidates(sourceEmail);
  const target = expandEmailCandidates(targetEmail);
  return source.some((s) => target.includes(s));
}

export function findUserByEmailInList<T extends Record<string, unknown>>(
  sourceEmail: string,
  users: T[],
  getEmail: (user: T) => string | undefined,
): T | undefined {
  const candidates = expandEmailCandidates(sourceEmail);
  return users.find((u) => {
    const email = getEmail(u);
    if (!email) return false;
    const userCandidates = expandEmailCandidates(email);
    return userCandidates.some((ue) => candidates.includes(ue));
  });
}

export function resolveEmailFromUserList(
  sourceEmail: string,
  users: Record<string, unknown>[],
): string | null {
  const match = findUserByEmailInList(sourceEmail, users, (u) =>
    typeof u.email === "string" ? u.email : undefined,
  );
  return match && typeof match.email === "string" ? match.email.trim() : null;
}
