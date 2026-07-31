import { env } from "@/lib/env";

export interface SequifiCustomField {
  id?: number;
  field_name?: string;
  field_type?: string;
  value?: string | null;
}

export interface ParsedSequifiFields {
  onboardAxia: boolean;
  installerTabs: string[];
  markets: string;
  caHis: string;
  hisIssueDate: string;
  hisExpDate: string;
}

function readFieldArray(raw: Record<string, unknown>, key: string): SequifiCustomField[] {
  const value = raw[key];
  return Array.isArray(value) ? (value as SequifiCustomField[]) : [];
}

export function getSequifiFieldValue(
  raw: Record<string, unknown>,
  fieldName: string,
): string {
  const arrays = [
    ...readFieldArray(raw, "employee_admin_only_fields"),
    ...readFieldArray(raw, "employee_personal_detail"),
  ];
  const match = arrays.find(
    f => String(f.field_name ?? "").trim().toLowerCase() === fieldName.trim().toLowerCase(),
  );
  return String(match?.value ?? "").trim();
}

export function isSequifiYes(value: string | null | undefined): boolean {
  return String(value ?? "").trim().toLowerCase() === "yes";
}

/**
 * Normalize Sequifi DOB values to `YYYY-MM-DD`.
 * Live GET /v1/users exposes top-level `dob` as that ISO date string for most
 * active reps; also accept common alternates / custom-field labels.
 */
export function normalizeSequifiDobToIso(value: unknown): string {
  if (value == null) return "";
  const s = String(value).trim();
  if (!s || s.toLowerCase() === "null" || s.toLowerCase() === "undefined") return "";

  const ymd = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (ymd) return `${ymd[1]}-${ymd[2]}-${ymd[3]}`;

  const mdy = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (mdy) {
    return `${mdy[3]}-${mdy[1]!.padStart(2, "0")}-${mdy[2]!.padStart(2, "0")}`;
  }

  return "";
}

function defaultDobIso(): string {
  return normalizeSequifiDobToIso(env.onboardingDefaultDob) || "1990-01-01";
}

/** Read DOB from Sequifi user payload (top-level `dob` first, then custom fields). */
export function getSequifiDobIso(
  raw: Record<string, unknown>,
  options?: { allowDefault?: boolean },
): string {
  const allowDefault = options?.allowDefault !== false;
  const candidates: unknown[] = [
    raw.dob,
    raw.date_of_birth,
    raw.dateOfBirth,
    getSequifiFieldValue(raw, "Date of Birth"),
    getSequifiFieldValue(raw, "DOB"),
    getSequifiFieldValue(raw, "Birth Date"),
  ];
  for (const candidate of candidates) {
    const iso = normalizeSequifiDobToIso(candidate);
    if (iso) return iso;
  }
  return allowDefault ? defaultDobIso() : "";
}

export function getSequifiDobParts(
  raw: Record<string, unknown>,
  options?: { allowDefault?: boolean },
): { month: string; day: string; year: string } | null {
  const iso = getSequifiDobIso(raw, options);
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return { year: match[1]!, month: match[2]!, day: match[3]! };
}

/**
 * Sequifi has, at least once (Axia, around 2026-07-17), silently renamed a
 * custom-field question's label — the short "Onboard to Axia?" became
 * "Please select which installer(s) the user needs to be onboarded to.
 * Must select at least one. Would you like to onboard the user to Axia?"
 * An exact-match lookup on the old label then silently drops the answer
 * for anyone whose form rendered the new one (confirmed: 4 real reps had
 * their "Yes" answer invisible to us this way).
 *
 * To survive future relabels without needing a code change every time,
 * fall back to a fuzzy match: any admin-only dropdown field whose name
 * contains "onboard" plus every word of the installer's name (e.g. both
 * "good" and "pwr" for "Good Pwr") is treated as that installer's
 * question, regardless of the exact surrounding sentence.
 */
function getSequifiInstallerFieldValue(raw: Record<string, unknown>, installerName: string): string {
  const exact = getSequifiFieldValue(raw, `Onboard to ${installerName}?`);
  if (exact) return exact;

  const words = installerName.toLowerCase().split(/\s+/).filter(Boolean);
  const fields = readFieldArray(raw, "employee_admin_only_fields");
  const fuzzy = fields.find(f => {
    const name = String(f.field_name ?? "").toLowerCase();
    return name.includes("onboard") && words.every(word => name.includes(word));
  });
  return String(fuzzy?.value ?? "").trim();
}

const INSTALLER_DROPDOWNS: { installerName: string; tabName: string }[] = [
  { installerName: "Axia", tabName: "Axia" },
  { installerName: "Empwr", tabName: "EMPWR" },
  { installerName: "Good Pwr", tabName: "GoodPWR" },
  { installerName: "Tron", tabName: "Tron" },
  { installerName: "Better Earth", tabName: "Better Earth" },
];

export function parseSequifiFields(raw: Record<string, unknown>): ParsedSequifiFields {
  const installerTabs: string[] = [];

  for (const { installerName, tabName } of INSTALLER_DROPDOWNS) {
    if (isSequifiYes(getSequifiInstallerFieldValue(raw, installerName))) {
      installerTabs.push(tabName);
    }
  }

  const otherInstallers = getSequifiFieldValue(raw, "Other Installers?");
  if (otherInstallers) {
    for (const part of otherInstallers.split(/[,;/]+/)) {
      const tab = part.trim();
      if (tab) installerTabs.push(tab);
    }
  }

  // Sequifi has used both "market(s)" and "state(s)" labels for the same question.
  const markets =
    getSequifiFieldValue(raw, "Please provide the market(s) you will be working in?") ||
    getSequifiFieldValue(raw, "Please provide the state(s) you will be working in.") ||
    getSequifiFieldValue(raw, "Please provide the state(s) you will be working in") ||
    String(raw.state_code ?? "").trim();

  const caHis =
    getSequifiFieldValue(raw, "HIS License Number") ||
    getSequifiFieldValue(raw, "CA HIS License Number") ||
    getSequifiFieldValue(raw, "CA HIS Number");

  return {
    onboardAxia: isSequifiYes(getSequifiInstallerFieldValue(raw, "Axia")),
    installerTabs: [...new Set(installerTabs)],
    markets,
    caHis,
    hisIssueDate: getSequifiFieldValue(raw, "HIS Issue Date") || getSequifiFieldValue(raw, "Issue Date"),
    hisExpDate: getSequifiFieldValue(raw, "HIS Exp Date") || getSequifiFieldValue(raw, "Exp Date"),
  };
}
