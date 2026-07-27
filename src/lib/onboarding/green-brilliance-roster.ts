/**
 * Green Brilliance partner onboarding — append a roster row to their shared
 * Google Sheet so Bob/Amir can add the rep to Blaze.
 *
 * Sheet: https://docs.google.com/spreadsheets/d/1MvCndbCtMLYf9Rr12T6DJ9Xj1wvASlz39Zc1bdRQ_X4
 * Trigger: Sequifi "Other Installers?" contains "Green Brilliance" (or "GB"
 * as a whole word). Sungage Access is left blank — SOP does not define a source.
 */
import { getSheetsClient, isGoogleServiceAccountConfigured } from "@/lib/google-sheets/client";
import { env } from "@/lib/env";
import { buildWorkUpn } from "@/lib/onboarding/normalize";
import { updateJobStep } from "@/lib/onboarding/repository";
import { getSequifiFieldValue, parseSequifiFields } from "@/lib/onboarding/sequifi-fields";
import type { OnboardingJob } from "@/lib/onboarding/types";

const SENT_FLAG = "sent";
const DEFAULT_SPREADSHEET_ID = "1MvCndbCtMLYf9Rr12T6DJ9Xj1wvASlz39Zc1bdRQ_X4";
const TAB_NAME = "Green Brilliance";
const HEADERS = [
  "First Name",
  "Last Name",
  "Phone Number",
  "Email",
  "License (HIS)",
  "Sungage Access",
  "Market",
  "Date Added",
  "Notes",
] as const;

function trim(s: string | null | undefined): string {
  return (s ?? "").trim();
}

function escapeSheetTab(name: string): string {
  return `'${name.replace(/'/g, "''")}'`;
}

export function isGreenBrillianceRosterConfigured(): boolean {
  return Boolean(
    env.greenBrillianceRosterEnabled &&
      isGoogleServiceAccountConfigured() &&
      (env.greenBrillianceSpreadsheetId?.trim() || DEFAULT_SPREADSHEET_ID),
  );
}

export function isGreenBrillianceTabName(name: string | null | undefined): boolean {
  const n = trim(name).toLowerCase();
  if (!n) return false;
  if (n.includes("green brilliance")) return true;
  // Whole-word "GB" only — avoid matching unrelated strings.
  return /\bgb\b/.test(n);
}

export function jobHasGreenBrillianceInstallerTab(job: OnboardingJob): boolean {
  const tabs = parseSequifiFields(job.raw_sequifi_payload ?? {}).installerTabs;
  if (tabs.some(isGreenBrillianceTabName)) return true;
  const other = getSequifiFieldValue(job.raw_sequifi_payload ?? {}, "Other Installers?");
  return isGreenBrillianceTabName(other);
}

export function greenBrillianceRosterAlreadySent(job: OnboardingJob): boolean {
  return job.step_errors.green_brilliance_roster === SENT_FLAG;
}

function workEmailForJob(job: OnboardingJob): string {
  const upn = trim(job.microsoft_upn);
  if (upn) return upn;
  const domain = env.msDefaultDomain?.trim() || "noxpwr.com";
  return buildWorkUpn(job.first_name ?? "", job.last_name ?? "", domain);
}

export interface GreenBrillianceRosterRow {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  licenseHis: string;
  /** Always blank for now — no Sequifi/SOP source. */
  sungageAccess: string;
  market: string;
  dateAdded: string;
  notes: string;
}

export function buildGreenBrillianceRosterRow(
  job: OnboardingJob,
  now: Date = new Date(),
): GreenBrillianceRosterRow {
  const parsed = parseSequifiFields(job.raw_sequifi_payload ?? {});
  return {
    firstName: trim(job.first_name),
    lastName: trim(job.last_name),
    phone: trim(job.phone),
    email: workEmailForJob(job),
    licenseHis: parsed.caHis,
    sungageAccess: "",
    market: parsed.markets,
    dateAdded: now.toISOString().slice(0, 10),
    notes: "",
  };
}

export function greenBrillianceRowToSheetValues(row: GreenBrillianceRosterRow): string[] {
  return [
    row.firstName,
    row.lastName,
    row.phone,
    row.email,
    row.licenseHis,
    row.sungageAccess,
    row.market,
    row.dateAdded,
    row.notes,
  ];
}

async function readExistingEmails(spreadsheetId: string): Promise<Set<string>> {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${escapeSheetTab(TAB_NAME)}!D:D`,
  });
  const set = new Set<string>();
  for (const row of res.data.values ?? []) {
    const email = String(row[0] ?? "")
      .trim()
      .toLowerCase();
    if (email && email !== "email") set.add(email);
  }
  return set;
}

/**
 * Append the rep to the Green Brilliance shared roster sheet when Sequifi
 * Other Installers? indicates Green Brilliance. Sungage Access is left blank.
 */
export async function appendGreenBrillianceRoster(
  job: OnboardingJob,
  options?: { ignoreDryRun?: boolean },
): Promise<"sent" | "skipped" | "failed"> {
  if (!options?.ignoreDryRun && env.onboardingDryRun) return "skipped";
  if (job.status !== "completed") return "skipped";
  if (!jobHasGreenBrillianceInstallerTab(job)) return "skipped";
  if (!isGreenBrillianceRosterConfigured()) return "skipped";
  if (greenBrillianceRosterAlreadySent(job)) return "skipped";

  const row = buildGreenBrillianceRosterRow(job);
  if (!row.firstName || !row.lastName || !row.email) {
    await updateJobStep(job.id, {
      step_errors: {
        ...job.step_errors,
        green_brilliance_roster: "Missing required field(s): first name, last name, or email",
      },
    });
    return "failed";
  }

  const spreadsheetId = env.greenBrillianceSpreadsheetId?.trim() || DEFAULT_SPREADSHEET_ID;

  try {
    const existing = await readExistingEmails(spreadsheetId);
    if (existing.has(row.email.toLowerCase())) {
      await updateJobStep(job.id, {
        step_errors: { ...job.step_errors, green_brilliance_roster: "already in sheet" },
      });
      return "skipped";
    }

    const sheets = await getSheetsClient();
    // Ensure headers exist (sheet was seeded manually; re-write only if empty).
    const headerRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${escapeSheetTab(TAB_NAME)}!A1:I1`,
    });
    const firstRow = headerRes.data.values?.[0];
    if (!firstRow?.some(cell => String(cell ?? "").trim())) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${escapeSheetTab(TAB_NAME)}!A1:I1`,
        valueInputOption: "RAW",
        requestBody: { values: [Array.from(HEADERS)] },
      });
    }

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${escapeSheetTab(TAB_NAME)}!A:I`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [greenBrillianceRowToSheetValues(row)] },
    });

    await updateJobStep(job.id, {
      step_errors: { ...job.step_errors, green_brilliance_roster: SENT_FLAG },
    });
    return "sent";
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await updateJobStep(job.id, {
      step_errors: { ...job.step_errors, green_brilliance_roster: msg },
    });
    return "failed";
  }
}
