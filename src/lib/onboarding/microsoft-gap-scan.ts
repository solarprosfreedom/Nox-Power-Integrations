import {
  findGraphUserByEmailOrUpn,
  findGraphUserByUpn,
  GraphUserPermissionError,
  resolveUpnForUser,
} from "@/lib/microsoft/graph-users";
import { env } from "@/lib/env";
import { filterExcludedSequifiUsers } from "@/lib/onboarding/exclude";
import { fetchAllSequifiUsers, filterUsersByGoLive } from "@/lib/sequifi/client";
import type { SequifiUserRecord } from "@/lib/onboarding/types";

export type MicrosoftGapStatus = "member" | "guest_only" | "missing" | "error";

export interface SequifiMicrosoftGapRow {
  sequifi_user_id: number;
  sequifi_employee_id: string;
  first_name: string;
  last_name: string;
  sequifi_email: string;
  personal_email: string;
  work_upn: string;
  status: MicrosoftGapStatus;
  member_upn: string | null;
  guest_upn: string | null;
  error: string | null;
}

export interface SequifiMicrosoftGapScanResult {
  scanned: number;
  goLiveFiltered: number;
  /** Rows removed by temporary test blocklist in exclude.ts. */
  excludeFiltered: number;
  memberCount: number;
  guestOnlyCount: number;
  missingCount: number;
  errorCount: number;
  rows: SequifiMicrosoftGapRow[];
  /** Users without a member @noxpwr.com account (missing + guest_only). */
  gapRows: SequifiMicrosoftGapRow[];
  /** Users with a member @noxpwr.com account in Microsoft. */
  memberRows: SequifiMicrosoftGapRow[];
  scannedAt: string;
  error?: string;
}

function workDomain(): string {
  return env.msDefaultDomain?.trim() || "noxpwr.com";
}

export function isGuestUpn(upn: string): boolean {
  const lower = upn.toLowerCase();
  return lower.includes("#ext#") || lower.endsWith(".onmicrosoft.com");
}

export function isMemberUpn(upn: string, domain = workDomain()): boolean {
  const lower = upn.toLowerCase();
  return lower.endsWith(`@${domain.toLowerCase()}`) && !isGuestUpn(upn);
}

function personalEmailFromSequifi(user: SequifiUserRecord): string {
  const raw = user.raw;
  return (
    String(raw.personal_email ?? raw.personalEmail ?? user.email).trim() || user.email
  );
}

export async function classifyMicrosoftForSequifiUser(
  user: SequifiUserRecord,
): Promise<SequifiMicrosoftGapRow> {
  const domain = workDomain();
  const workUpn = resolveUpnForUser(user.email, user.first_name, user.last_name);
  const personalEmail = personalEmailFromSequifi(user);
  const base: SequifiMicrosoftGapRow = {
    sequifi_user_id: user.id,
    sequifi_employee_id: user.employee_id,
    first_name: user.first_name,
    last_name: user.last_name,
    sequifi_email: user.email,
    personal_email: personalEmail,
    work_upn: workUpn,
    status: "missing",
    member_upn: null,
    guest_upn: null,
    error: null,
  };

  try {
    let memberUpn: string | null = null;
    let guestUpn: string | null = null;

    const workUser = await findGraphUserByUpn(workUpn);
    if (workUser) {
      if (isMemberUpn(workUser.userPrincipalName, domain)) {
        memberUpn = workUser.userPrincipalName;
      } else if (isGuestUpn(workUser.userPrincipalName)) {
        guestUpn = workUser.userPrincipalName;
      }
    }

    if (!memberUpn) {
      const extraEmails = [...new Set([personalEmail, user.email].map(e => e.trim().toLowerCase()))].filter(
        e => e && e !== workUpn.toLowerCase(),
      );

      for (const email of extraEmails) {
        const found = await findGraphUserByEmailOrUpn(email);
        if (!found) continue;
        if (isMemberUpn(found.userPrincipalName, domain)) {
          memberUpn = found.userPrincipalName;
          break;
        }
        if (isGuestUpn(found.userPrincipalName) && !guestUpn) {
          guestUpn = found.userPrincipalName;
        }
      }
    }

    if (memberUpn) {
      return { ...base, status: "member", member_upn: memberUpn, guest_upn: guestUpn };
    }
    if (guestUpn) {
      return { ...base, status: "guest_only", guest_upn: guestUpn };
    }
    return base;
  } catch (e) {
    const msg =
      e instanceof GraphUserPermissionError
        ? "Microsoft Graph User.Read.All permission required."
        : e instanceof Error
          ? e.message
          : String(e);
    return { ...base, status: "error", error: msg };
  }
}

export function needsMicrosoftProvisioning(status: MicrosoftGapStatus): boolean {
  return status === "missing" || status === "guest_only" || status === "error";
}

/** Hired Sequifi users who lack a member @noxpwr.com Microsoft account. */
export async function filterSequifiUsersNeedingProvisioning(
  users: SequifiUserRecord[],
): Promise<SequifiUserRecord[]> {
  if (!users.length) return [];
  const rows = await mapWithConcurrency(users, u => classifyMicrosoftForSequifiUser(u), 5);
  return users.filter((_, i) => needsMicrosoftProvisioning(rows[i]!.status));
}

async function mapWithConcurrency<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency = 5,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!, i);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

export async function scanSequifiMicrosoftGaps(): Promise<SequifiMicrosoftGapScanResult> {
  try {
    const all = await fetchAllSequifiUsers();
    const afterGoLive = filterUsersByGoLive(all);
    const users = filterExcludedSequifiUsers(afterGoLive);
    const rows = await mapWithConcurrency(users, u => classifyMicrosoftForSequifiUser(u), 5);

    const memberCount = rows.filter(r => r.status === "member").length;
    const guestOnlyCount = rows.filter(r => r.status === "guest_only").length;
    const missingCount = rows.filter(r => r.status === "missing").length;
    const errorCount = rows.filter(r => r.status === "error").length;
    const gapRows = rows.filter(
      r => r.status === "missing" || r.status === "guest_only" || r.status === "error",
    );
    const memberRows = rows.filter(r => r.status === "member");

    const sortByName = (a: SequifiMicrosoftGapRow, b: SequifiMicrosoftGapRow) => {
      const nameA = `${a.last_name} ${a.first_name}`.toLowerCase();
      const nameB = `${b.last_name} ${b.first_name}`.toLowerCase();
      return nameA.localeCompare(nameB);
    };
    gapRows.sort(sortByName);
    memberRows.sort(sortByName);
    rows.sort(sortByName);

    return {
      scanned: rows.length,
      goLiveFiltered: all.length - afterGoLive.length,
      excludeFiltered: afterGoLive.length - users.length,
      memberCount,
      guestOnlyCount,
      missingCount,
      errorCount,
      rows,
      gapRows,
      memberRows,
      scannedAt: new Date().toISOString(),
    };
  } catch (e) {
    return {
      scanned: 0,
      goLiveFiltered: 0,
      excludeFiltered: 0,
      memberCount: 0,
      guestOnlyCount: 0,
      missingCount: 0,
      errorCount: 0,
      rows: [],
      gapRows: [],
      memberRows: [],
      scannedAt: new Date().toISOString(),
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
