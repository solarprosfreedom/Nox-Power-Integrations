import type { SaleMatch } from "@/lib/inactive-reps/types";

export function normalizeEmail(value: unknown): string {
  const raw = String(value ?? "").trim().toLowerCase();
  const match = raw.match(/^([^@+]+)(?:\+[^@]*)?@([^@]+)$/);
  if (!match) return "";
  return `${match[1]}@${match[2]}`;
}

function canonicalDomainEmail(value: unknown): string {
  const email = normalizeEmail(value);
  if (!email) return "";
  const [local, domain] = email.split("@");
  return domain === "solarpros.io" || domain === "noxpwr.com"
    ? `${local}@noxpwr.com`
    : email;
}

export function buildIdentityKey(aliasesJson?: string): (value: unknown) => string {
  const pairs: Array<[string, string]> = [];
  try {
    const aliases = JSON.parse(aliasesJson || "{}") as Record<string, unknown>;
    for (const [left, right] of Object.entries(aliases)) {
      const a = canonicalDomainEmail(left);
      const b = canonicalDomainEmail(right);
      if (a && b) pairs.push([a, b]);
    }
  } catch {
    // Invalid optional aliases must not weaken exact matching.
  }

  return (value: unknown) => {
    const start = canonicalDomainEmail(value);
    if (!start) return "";
    const seen = new Set([start]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const [a, b] of pairs) {
        if (seen.has(a) && !seen.has(b)) {
          seen.add(b);
          changed = true;
        }
        if (seen.has(b) && !seen.has(a)) {
          seen.add(a);
          changed = true;
        }
      }
    }
    return [...seen].sort()[0] ?? start;
  };
}

export function normalizePersonName(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\([^)]*(closer|setter|sales|rep|advisor|owner)[^)]*\)/g, " ")
    .replace(/\b(closer|setter|sales rep|sales advisor)\b$/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/^e on\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function levenshtein(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const old = row[j]!;
      row[j] = Math.min(
        row[j]! + 1,
        row[j - 1]! + 1,
        previous + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      previous = old;
    }
  }
  return row[b.length]!;
}

function nameParts(value: unknown): { normalized: string; first: string; last: string } {
  const normalized = normalizePersonName(value);
  const tokens = normalized.split(" ").filter(Boolean);
  return {
    normalized,
    first: tokens[0] ?? "",
    last: tokens.length >= 2 ? tokens[tokens.length - 1]! : "",
  };
}

export function fuzzyNameScore(
  sourceValue: unknown,
  candidateName: unknown,
): { score: number; distance: number } | null {
  const source = nameParts(sourceValue);
  const candidate = nameParts(candidateName);
  if (!source.first || !source.last || !candidate.first || !candidate.last) return null;

  const firstDistance = levenshtein(source.first, candidate.first);
  const lastDistance = levenshtein(source.last, candidate.last);
  const lastLength = Math.max(source.last.length, candidate.last.length);
  const sourceFull = source.normalized.replaceAll(" ", "");
  const candidateFull = candidate.normalized.replaceAll(" ", "");
  const fullDistance = levenshtein(sourceFull, candidateFull);
  const fullLength = Math.max(sourceFull.length, candidateFull.length);
  const firstExact = source.first === candidate.first;
  const lastExact = source.last === candidate.last;
  const allowedLastDistance = lastLength >= 7 ? 2 : 1;

  const lastTypo =
    firstExact &&
    lastDistance > 0 &&
    lastDistance <= allowedLastDistance &&
    lastDistance / lastLength <= 0.28;
  const firstTypo =
    lastExact && firstDistance === 1 && Math.max(source.first.length, candidate.first.length) >= 4;
  const wholeNameTypo =
    (firstExact || lastExact) &&
    fullDistance > 0 &&
    fullDistance <= 2 &&
    fullDistance / fullLength <= 0.18;

  if (!lastTypo && !firstTypo && !wholeNameTypo) return null;
  return { score: Number((1 - fullDistance / fullLength).toFixed(4)), distance: fullDistance };
}

export interface SalesCandidateIdentity {
  identityKey: string;
  identityEmail: string;
  name: string;
}

export interface SalesAttributionValue {
  value: string;
  path: string;
}

export function matchSaleAttribution(
  emails: SalesAttributionValue[],
  names: SalesAttributionValue[],
  candidates: SalesCandidateIdentity[],
  identityKey: (value: unknown) => string,
): {
  matches: Map<string, Omit<SaleMatch, "installer" | "saleDate">>;
  ambiguousIdentityKeys: Set<string>;
} {
  const byKey = new Map<string, SalesCandidateIdentity[]>();
  const byName = new Map<string, SalesCandidateIdentity[]>();
  for (const candidate of candidates) {
    const keyRows = byKey.get(candidate.identityKey) ?? [];
    keyRows.push(candidate);
    byKey.set(candidate.identityKey, keyRows);
    const nameKey = normalizePersonName(candidate.name);
    const nameRows = byName.get(nameKey) ?? [];
    nameRows.push(candidate);
    byName.set(nameKey, nameRows);
  }

  const matches = new Map<string, Omit<SaleMatch, "installer" | "saleDate">>();
  for (const item of emails) {
    const exact = byKey.get(identityKey(item.value)) ?? [];
    if (exact.length === 1) {
      matches.set(exact[0]!.identityKey, {
        method: "exact_email",
        sourcePath: item.path,
        score: 1,
      });
    }
  }

  for (const item of names) {
    const exact = byName.get(normalizePersonName(item.value)) ?? [];
    if (exact.length === 1 && !matches.has(exact[0]!.identityKey)) {
      matches.set(exact[0]!.identityKey, {
        method: "exact_unique_name",
        sourcePath: item.path,
        score: 1,
      });
    }
  }

  const ambiguousIdentityKeys = new Set<string>();
  for (const item of names) {
    if ((byName.get(normalizePersonName(item.value)) ?? []).length) continue;
    const options = candidates
      .filter(candidate => !matches.has(candidate.identityKey))
      .map(candidate => {
        const fuzzy = fuzzyNameScore(item.value, candidate.name);
        return fuzzy ? { candidate, ...fuzzy } : null;
      })
      .filter((value): value is NonNullable<typeof value> => Boolean(value))
      .sort((a, b) => b.score - a.score || a.distance - b.distance);
    const best = options[0];
    const runnerUp = options.find(option => option.candidate.identityKey !== best?.candidate.identityKey);
    if (best && (!runnerUp || best.score - runnerUp.score >= 0.08)) {
      matches.set(best.candidate.identityKey, {
        method: "fuzzy_unique_best_name",
        sourcePath: item.path,
        score: best.score,
      });
    } else if (best) {
      for (const option of options.slice(0, 3)) {
        ambiguousIdentityKeys.add(option.candidate.identityKey);
      }
    }
  }
  return { matches, ambiguousIdentityKeys };
}
