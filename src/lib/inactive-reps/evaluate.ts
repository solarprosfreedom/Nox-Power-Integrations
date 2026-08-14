import { env } from "@/lib/env";
import {
  buildIdentityKey,
  matchSaleAttribution,
  normalizeEmail,
  normalizePersonName,
  type SalesAttributionValue,
  type SalesCandidateIdentity,
} from "@/lib/inactive-reps/identity";
import { asIso, type InactiveRepSourceSnapshot, type SourceAccount } from "@/lib/inactive-reps/sources";
import {
  INACTIVE_REP_WINDOW_DAYS,
  type CandidateBuildResult,
  type InactiveRepCandidate,
  type InactiveRepPlatform,
  type PlatformAccountSnapshot,
  type SaleMatch,
} from "@/lib/inactive-reps/types";
import type { SequifiUserRecord } from "@/lib/onboarding/types";

const DAY_MS = 86_400_000;

const SALE_DATE_PATHS = [
  "project.contract_signed_date",
  "raw.contract_signed_date",
  "raw.sale_date",
  "raw.sold_date",
  "raw.deal_date",
  "raw.close_date",
  "raw.contract_date",
  "raw.raw_payload.saleDate",
  "raw.raw_payload.soldDate",
  "raw.raw_payload.contractSignedDate",
  "raw.raw_payload.dealDate",
];

const SALE_EMAIL_PATHS = [
  "project.sales_advisor_email",
  "project.closer_email",
  "project.setter_email",
  "raw.sales_advisor_email",
  "raw.sales_rep_email",
  "raw.rep_email",
  "raw.closer_email",
  "raw.owner_email",
  "raw.setter_email",
  "raw.raw_payload.salesRep.email",
  "raw.raw_payload.setter.email",
  "raw.raw_payload.closer.email",
];

const SALE_NAME_PATHS = [
  "project.sales_advisor_name",
  "project.closer_name",
  "project.setter_name",
  "raw.sales_advisor_name",
  "raw.sales_advisor",
  "raw.sales_rep_name",
  "raw.sales_rep",
  "raw.rep_name",
  "raw.closer_name",
  "raw.closer_1",
  "raw.closer_2",
  "raw.owner_name",
  "raw.setter_name",
  "raw.setter_1",
  "raw.setter_2",
  "raw.raw_payload.salesRep.name",
  "raw.raw_payload.setter.name",
  "raw.raw_payload.closer.name",
  "raw.raw_properties.sales_rep_setter_name",
  "raw.raw_properties.sales_rep_name__deal_",
  "remittance.sales_advisor",
];

function mapPush<T>(map: Map<string, T[]>, key: string, value: T): void {
  if (!key) return;
  const rows = map.get(key) ?? [];
  rows.push(value);
  map.set(key, rows);
}

function hasRepLabel(labels: string[]): boolean {
  return labels.some(label =>
    /\b(sales\s*rep|appt\s*setter|setter|closer|self\s*gen|agent|can_help|closer_only|needs_help)\b/i.test(
      label,
    ),
  );
}

function hasPrivilegedLabel(labels: string[]): boolean {
  return labels.some(label =>
    /\b(admin(?:istrator)?|super\s*admin|supercompany|company(?:\s*admin)?|officeadmin|manager|regionalmanager|projectmanager|operations|ops|owner)\b/i.test(
      label,
    ),
  );
}

function isManagerFlag(value: unknown): boolean {
  if (value === true || value === 1 || value === "1") return true;
  return typeof value === "string" && ["true", "yes"].includes(value.trim().toLowerCase());
}

function looksLikeServiceAccount(email: string, name: string): boolean {
  const local = normalizeEmail(email).split("@")[0] ?? "";
  return (
    /^(admin|api|automation|marketing|support|test|createrep|xlead|noreply|no-reply)/i.test(local) ||
    /(^|\s)(admin|service account|automation account|test(?: account| user)?)(\s|$)/i.test(name)
  );
}

export function evaluateAccountActivity(
  account: SourceAccount,
  cutoffAt: Date,
): Pick<PlatformAccountSnapshot, "activityState" | "activityReason"> {
  if (account.evidenceIssue) {
    return { activityState: "unknown", activityReason: account.evidenceIssue };
  }
  const lastLoginMs = account.lastLoginAt ? Date.parse(account.lastLoginAt) : Number.NaN;
  if (Number.isFinite(lastLoginMs)) {
    if (lastLoginMs >= cutoffAt.getTime()) {
      return { activityState: "recent", activityReason: "Login within the rolling 30-day window" };
    }
    return { activityState: "inactive", activityReason: "Last login is at least 30 days old" };
  }
  const createdMs = account.createdAt ? Date.parse(account.createdAt) : Number.NaN;
  if (!Number.isFinite(createdMs)) {
    return {
      activityState: "unknown",
      activityReason: "No login history and account creation date is unavailable",
    };
  }
  if (createdMs >= cutoffAt.getTime()) {
    return {
      activityState: "recent",
      activityReason: "No login history; account is still within the 30-day grace period",
    };
  }
  return {
    activityState: "inactive",
    activityReason: "No login history; account is older than 30 days",
  };
}

function accountSnapshot(account: SourceAccount, cutoffAt: Date): PlatformAccountSnapshot {
  return { ...account, ...evaluateAccountActivity(account, cutoffAt) };
}

function getPath(row: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    return (current as Record<string, unknown>)[key];
  }, row);
}

function valuesAtPaths(
  row: Record<string, unknown>,
  paths: string[],
  kind: "email" | "name",
): SalesAttributionValue[] {
  const found: SalesAttributionValue[] = [];
  for (const path of paths) {
    const value = getPath(row, path);
    if (typeof value !== "string" || !value.trim()) continue;
    const pieces = kind === "email" ? value.split(/[;,\s]+/) : value.split(/\s+(?:\/|&|and)\s+/i);
    for (const piece of pieces) {
      const normalized = kind === "email" ? normalizeEmail(piece) : normalizePersonName(piece);
      if (normalized) found.push({ value: piece.trim(), path });
    }
  }
  return [
    ...new Map(found.map(item => [`${item.path}|${kind === "email" ? normalizeEmail(item.value) : normalizePersonName(item.value)}`, item])).values(),
  ];
}

function saleDateFor(row: Record<string, unknown>): string | null {
  for (const path of SALE_DATE_PATHS) {
    const parsed = asIso(getPath(row, path));
    if (parsed) return parsed;
  }
  return null;
}

function withinSalesWindow(saleDate: string, cutoffAt: Date, checkedAt: Date): boolean {
  const millis = Date.parse(saleDate);
  if (!Number.isFinite(millis) || millis > checkedAt.getTime() + DAY_MS) return false;
  if (millis >= cutoffAt.getTime()) return true;
  // Date-only values represent the whole day. Protect the cutoff calendar day.
  return saleDate.slice(0, 10) === cutoffAt.toISOString().slice(0, 10);
}

function buildSalesProtection(
  snapshot: InactiveRepSourceSnapshot,
  people: SalesCandidateIdentity[],
  identityKey: (value: unknown) => string,
  cutoffAt: Date,
  checkedAt: Date,
): { matches: Map<string, SaleMatch[]>; ambiguousKeys: Set<string>; ambiguousRows: number } {
  const matches = new Map<string, SaleMatch[]>();
  const ambiguousKeys = new Set<string>();
  let ambiguousRows = 0;
  for (const feed of snapshot.salesFeeds) {
    for (const row of feed.rows) {
      const saleDate = saleDateFor(row);
      if (!saleDate || !withinSalesWindow(saleDate, cutoffAt, checkedAt)) continue;
      const attribution = matchSaleAttribution(
        valuesAtPaths(row, SALE_EMAIL_PATHS, "email"),
        valuesAtPaths(row, SALE_NAME_PATHS, "name"),
        people,
        identityKey,
      );
      for (const key of attribution.ambiguousIdentityKeys) ambiguousKeys.add(key);
      if (attribution.ambiguousIdentityKeys.size) ambiguousRows++;
      for (const [key, match] of attribution.matches) {
        const rows = matches.get(key) ?? [];
        rows.push({ installer: feed.installer, saleDate, ...match });
        matches.set(key, rows);
      }
    }
  }
  return { matches, ambiguousKeys, ambiguousRows };
}

interface EligiblePerson {
  key: string;
  identityEmail: string;
  name: string;
  role: string;
  roleSource: string;
  sequifiUserId: string | null;
  accounts: Partial<Record<InactiveRepPlatform, PlatformAccountSnapshot>>;
}

function activeSequifiRole(user: SequifiUserRecord): string[] {
  return [String(user.sub_position_name ?? "").trim(), String(user.position_name ?? "").trim()].filter(Boolean);
}

function describeReason(accounts: PlatformAccountSnapshot[]): string {
  const platforms = accounts.map(account => account.platform[0]!.toUpperCase() + account.platform.slice(1));
  const hasNoHistory = accounts.some(account => !account.lastLoginAt);
  return `${hasNoHistory ? "No login within the last 30 days or no login history" : "No login within the last 30 days"} across existing ${platforms.join(", ")} account(s), and no attributable sales activity within the last 30 days.`;
}

export function buildInactiveRepCandidates(
  snapshot: InactiveRepSourceSnapshot,
  checkedAt = new Date(),
): CandidateBuildResult {
  const cutoffAt = new Date(checkedAt.getTime() - INACTIVE_REP_WINDOW_DAYS * DAY_MS);
  const identityKey = buildIdentityKey(env.userEmailAliasesJson);
  const sequifi = new Map<string, SequifiUserRecord[]>();
  const accounts = {
    enerflo: new Map<string, SourceAccount[]>(),
    microsoft: new Map<string, SourceAccount[]>(),
    terros: new Map<string, SourceAccount[]>(),
  };
  for (const user of snapshot.sequifiUsers) mapPush(sequifi, identityKey(user.email), user);
  for (const platform of ["enerflo", "microsoft", "terros"] as const) {
    for (const account of snapshot.accounts[platform]) {
      mapPush(accounts[platform], identityKey(account.email), account);
    }
  }

  const exclusions: Record<string, number> = {};
  const exclude = (reason: string) => {
    exclusions[reason] = (exclusions[reason] ?? 0) + 1;
  };
  const eligible: EligiblePerson[] = [];
  const rootKeys = new Set([
    ...sequifi.keys(),
    ...accounts.enerflo.keys(),
    ...accounts.terros.keys(),
  ]);

  for (const key of rootKeys) {
    if (!key) continue;
    const seq = sequifi.get(key) ?? [];
    const ef = accounts.enerflo.get(key) ?? [];
    const ms = accounts.microsoft.get(key) ?? [];
    const tr = accounts.terros.get(key) ?? [];
    if (seq.length > 1 || ef.length > 1 || ms.length > 1 || tr.length > 1) {
      exclude("ambiguous platform identity");
      continue;
    }

    let role = "";
    let roleSource = "";
    let sequifiUserId: string | null = null;
    if (seq.length === 1) {
      const user = seq[0]!;
      const labels = activeSequifiRole(user);
      if (
        Number(user.status_id) !== 1 ||
        !hasRepLabel(labels) ||
        hasPrivilegedLabel(labels) ||
        isManagerFlag(user.raw.is_manager)
      ) {
        exclude("Sequifi non-rep, inactive, admin, or manager");
        continue;
      }
      role = labels.join(" / ");
      roleSource = "Sequifi";
      sequifiUserId = String(user.id);
    } else if (
      ef.length === 1 &&
      hasRepLabel(ef[0]!.roles) &&
      !hasPrivilegedLabel(ef[0]!.roles) &&
      !ef[0]!.isAdmin
    ) {
      role = ef[0]!.roles.join(", ");
      roleSource = "Enerflo fallback (no Sequifi record)";
    } else if (
      tr.length === 1 &&
      tr[0]!.roles.some(label => ["Can_Help", "Closer_Only", "Needs_Help"].includes(label)) &&
      !hasPrivilegedLabel(tr[0]!.roles)
    ) {
      role = tr[0]!.roles.find(label => ["Can_Help", "Closer_Only", "Needs_Help"].includes(label)) ?? "Closer";
      roleSource = "Terros fallback (no Sequifi or Enerflo rep record)";
    } else {
      exclude("no verified sales-rep role");
      continue;
    }

    const identityEmail = normalizeEmail(seq[0]?.email ?? ef[0]?.email ?? tr[0]?.email ?? key);
    const name =
      `${seq[0]?.first_name ?? ""} ${seq[0]?.last_name ?? ""}`.trim() ||
      ef[0]?.name ||
      tr[0]?.name ||
      ms[0]?.name ||
      identityEmail;
    if (
      looksLikeServiceAccount(identityEmail, name) ||
      ef.some(account => account.isAdmin || hasPrivilegedLabel(account.roles)) ||
      tr.some(account => account.isAdmin || hasPrivilegedLabel(account.roles))
    ) {
      exclude("admin, manager, or service-account override");
      continue;
    }

    const currentAccounts: Partial<Record<InactiveRepPlatform, PlatformAccountSnapshot>> = {};
    if (ef[0]) currentAccounts.enerflo = accountSnapshot(ef[0], cutoffAt);
    if (ms[0]) currentAccounts.microsoft = accountSnapshot(ms[0], cutoffAt);
    if (tr[0]) currentAccounts.terros = accountSnapshot(tr[0], cutoffAt);
    const existing = Object.values(currentAccounts);
    if (!existing.length) {
      exclude("no matched platform account");
      continue;
    }
    if (existing.some(account => account.activityState === "recent")) {
      exclude("recent platform login or new-account grace period");
      continue;
    }
    if (existing.some(account => account.activityState === "unknown")) {
      exclude("missing or conflicting platform activity evidence");
      continue;
    }
    if (!existing.some(account => account.active)) {
      exclude("no active inactive account to deactivate");
      continue;
    }
    eligible.push({ key, identityEmail, name, role, roleSource, sequifiUserId, accounts: currentAccounts });
  }

  const salesPeople: SalesCandidateIdentity[] = eligible.map(person => ({
    identityKey: person.key,
    identityEmail: person.identityEmail,
    name: person.name,
  }));
  const sales = buildSalesProtection(snapshot, salesPeople, identityKey, cutoffAt, checkedAt);
  const candidates: InactiveRepCandidate[] = [];
  for (const person of eligible) {
    const exactSales = sales.matches.get(person.key) ?? [];
    if (exactSales.length) {
      exclude("sales activity within the last 30 days");
      continue;
    }
    if (sales.ambiguousKeys.has(person.key)) {
      exclude("ambiguous possible sales attribution");
      continue;
    }
    const existing = Object.values(person.accounts);
    const targets = existing.filter(account => account.active);
    const latestSale = exactSales.sort((a, b) => b.saleDate.localeCompare(a.saleDate))[0] ?? null;
    candidates.push({
      identityKey: person.key,
      identityEmail: person.identityEmail,
      name: person.name,
      role: person.role,
      roleSource: person.roleSource,
      sequifiUserId: person.sequifiUserId,
      reason: describeReason(existing),
      checkedAt: checkedAt.toISOString(),
      cutoffAt: cutoffAt.toISOString(),
      accounts: person.accounts,
      targets,
      latestSale,
    });
  }
  candidates.sort((a, b) => a.name.localeCompare(b.name) || a.identityKey.localeCompare(b.identityKey));
  return {
    candidates,
    exclusions,
    ambiguousSales: sales.ambiguousRows,
    sourceSummary: snapshot.sourceSummary,
    checkedAt: checkedAt.toISOString(),
    cutoffAt: cutoffAt.toISOString(),
  };
}

function csvCell(value: unknown): string {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildCandidateCsv(candidates: InactiveRepCandidate[]): string {
  const headers = [
    "name",
    "role",
    "role_source",
    "account_email",
    "microsoft_email",
    "microsoft_account_id",
    "microsoft_status",
    "microsoft_created",
    "microsoft_last_login",
    "microsoft_inactivity_basis",
    "terros_email",
    "terros_account_id",
    "terros_status",
    "terros_created",
    "terros_last_login",
    "terros_inactivity_basis",
    "enerflo_email",
    "enerflo_account_id",
    "enerflo_status",
    "enerflo_created",
    "enerflo_last_login",
    "enerflo_inactivity_basis",
    "platforms",
    "identity_match",
    "latest_matched_sale",
    "reason_for_deactivation",
    "checked_at_utc",
  ];
  const rows = candidates.map(candidate => {
    const microsoft = candidate.accounts.microsoft;
    const terros = candidate.accounts.terros;
    const enerflo = candidate.accounts.enerflo;
    return {
      name: candidate.name,
      role: candidate.role,
      role_source: candidate.roleSource,
      account_email: candidate.identityEmail,
      microsoft_email: microsoft?.email ?? "",
      microsoft_account_id: microsoft?.id ?? "",
      microsoft_status: microsoft ? (microsoft.active ? "active" : "inactive") : "",
      microsoft_created: microsoft?.createdAt ?? "",
      microsoft_last_login: microsoft?.lastLoginAt ?? "",
      microsoft_inactivity_basis: microsoft?.activityReason ?? "",
      terros_email: terros?.email ?? "",
      terros_account_id: terros?.id ?? "",
      terros_status: terros ? (terros.active ? "active" : "inactive") : "",
      terros_created: terros?.createdAt ?? "",
      terros_last_login: terros?.lastLoginAt ?? "",
      terros_inactivity_basis: terros?.activityReason ?? "",
      enerflo_email: enerflo?.email ?? "",
      enerflo_account_id: enerflo?.id ?? "",
      enerflo_status: enerflo ? (enerflo.active ? "active" : "inactive") : "",
      enerflo_created: enerflo?.createdAt ?? "",
      enerflo_last_login: enerflo?.lastLoginAt ?? "",
      enerflo_inactivity_basis: enerflo?.activityReason ?? "",
      platforms: candidate.targets.map(target => target.platform).join(" | "),
      identity_match: "normalized email / configured alias",
      latest_matched_sale: candidate.latestSale?.saleDate ?? "",
      reason_for_deactivation: candidate.reason,
      checked_at_utc: candidate.checkedAt,
    };
  });
  return [
    headers.join(","),
    ...rows.map(row => headers.map(header => csvCell(row[header as keyof typeof row])).join(",")),
  ].join("\n") + "\n";
}
