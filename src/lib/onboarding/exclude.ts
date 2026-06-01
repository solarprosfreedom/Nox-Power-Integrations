import type { SequifiUserRecord } from "@/lib/onboarding/types";

const TEMP_EXCLUDE_SEQUIFI_USER_IDS = new Set<string>([]);

export function sequifiExcludeUserIds(): Set<string> {
  return TEMP_EXCLUDE_SEQUIFI_USER_IDS;
}

export function isSequifiUserExcluded(user: { id: number | string }): boolean {
  return sequifiExcludeUserIds().has(String(user.id));
}

export function filterExcludedSequifiUsers(users: SequifiUserRecord[]): SequifiUserRecord[] {
  const excluded = sequifiExcludeUserIds();
  if (!excluded.size) return users;
  return users.filter(u => !excluded.has(String(u.id)));
}
