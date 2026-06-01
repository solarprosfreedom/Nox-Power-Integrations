import { env } from "@/lib/env";
import type { SequifiUserRecord } from "@/lib/onboarding/types";

/** Parse ONBOARDING_EXCLUDE_SEQUIFI_USER_IDS (comma-separated Sequifi user ids). */
export function sequifiExcludeUserIds(): Set<string> {
  const raw = env.onboardingExcludeSequifiUserIds?.trim();
  if (!raw) return new Set();
  return new Set(
    raw
      .split(/[,;\s]+/)
      .map(id => id.trim())
      .filter(Boolean),
  );
}

export function isSequifiUserExcluded(user: { id: number | string }): boolean {
  return sequifiExcludeUserIds().has(String(user.id));
}

export function filterExcludedSequifiUsers(users: SequifiUserRecord[]): SequifiUserRecord[] {
  const excluded = sequifiExcludeUserIds();
  if (!excluded.size) return users;
  return users.filter(u => !excluded.has(String(u.id)));
}
