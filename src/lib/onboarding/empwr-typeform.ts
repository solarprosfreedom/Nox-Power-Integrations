/**
 * EMPWR / Empower partner onboarding — "Empower New Rep Request" Typeform.
 *
 * Form: https://form.typeform.com/to/UvpPrheO
 *
 * Replaces the previous HubSpot form submit. Typeform has no public create-
 * response API, so submission drives a headless browser (see
 * empwr-typeform-browser.ts), same stack as Tron JotForm.
 *
 * SOP: Appt Setters skip this form (jump to roster). Closers fill Team ID 803,
 * New to Empower, all home services, all financiers except Goodleap, consent,
 * Sequifi markets (AZ/CA/UT/TX only), and HIS when CA.
 */
import { env } from "@/lib/env";
import { submitEmpwrTypeformViaBrowser } from "@/lib/onboarding/empwr-typeform-browser";
import { updateJobStep } from "@/lib/onboarding/repository";
import {
  isApptSetterName,
  sequifiPositionContextFromJob,
} from "@/lib/onboarding/role-map";
import { parseSequifiFields } from "@/lib/onboarding/sequifi-fields";
import type { OnboardingJob } from "@/lib/onboarding/types";

const SENT_FLAG = "sent";

export const EMPWR_TYPEFORM_STATES = ["AZ", "CA", "UT", "TX"] as const;
export type EmpwrTypeformState = (typeof EMPWR_TYPEFORM_STATES)[number];

export const EMPWR_HOME_SERVICES = [
  "Solar + Storage",
  "Roofing",
  "HVAC",
  "Maintenance Plans",
] as const;

/** SOP: select all financiers except Goodleap. */
export const EMPWR_FINANCIERS_EXCEPT_GOODLEAP = [
  "Credit Human",
  "Enfin",
  "Lightreach",
  "Participate",
  "Solrite",
] as const;

export type EmpwrTypeformAccess = "Closer" | "Admin";

const STATE_NAME_TO_CODE: Record<string, EmpwrTypeformState> = {
  arizona: "AZ",
  az: "AZ",
  california: "CA",
  ca: "CA",
  utah: "UT",
  ut: "UT",
  texas: "TX",
  tx: "TX",
};

function trim(s: string | null | undefined): string {
  return (s ?? "").trim();
}

function localPartFromName(firstName: string, lastName: string): string {
  return `${firstName}${lastName}`.toLowerCase().replace(/[^a-z0-9]/g, "") || "user";
}

/** Empower form email: firstnamelastname+emp@solarpros.io (not Outlook UPN). */
export function buildEmpwrTypeformEmail(
  firstName: string,
  lastName: string,
  domain?: string,
): string {
  const d = (domain ?? env.empwrTypeformEmailDomain)?.trim() || "solarpros.io";
  return `${localPartFromName(firstName, lastName)}+emp@${d}`;
}

export function isEmpwrTypeformConfigured(): boolean {
  return Boolean(env.empwrTypeformEnabled && env.empwrTypeformUrl?.trim());
}

export function jobHasEmpwrInstallerTab(job: OnboardingJob): boolean {
  return parseSequifiFields(job.raw_sequifi_payload ?? {}).installerTabs.some(
    tab => tab.trim().toLowerCase() === "empwr",
  );
}

export function empwrTypeformAlreadySent(job: OnboardingJob): boolean {
  return job.step_errors.empwr_typeform === SENT_FLAG;
}

/**
 * SOP step 1: Appt Setters / Setters skip the Onboarding Link (jump to roster).
 * Uses displayed Sequifi Position (sub_position_name, else position_name).
 */
export function shouldSkipEmpwrTypeformForSetter(
  job: Pick<OnboardingJob, "raw_sequifi_payload" | "role_label">,
): boolean {
  const ctx = sequifiPositionContextFromJob(job);
  const displayed = ctx.subPositionName || ctx.positionName;
  return isApptSetterName(displayed);
}

/** Access Needed dropdown: Admin when position is Admin; otherwise Closer. */
export function mapEmpwrTypeformAccess(
  job: Pick<OnboardingJob, "raw_sequifi_payload" | "role_label">,
): EmpwrTypeformAccess {
  const ctx = sequifiPositionContextFromJob(job);
  const position = `${ctx.positionName} ${ctx.subPositionName}`.toLowerCase();
  if (/\badmin\b/.test(position)) return "Admin";
  return "Closer";
}

/** Map Sequifi markets into the Typeform's AZ/CA/UT/TX picklist. */
export function resolveEmpwrTypeformStates(
  job: Pick<OnboardingJob, "raw_sequifi_payload">,
): EmpwrTypeformState[] {
  const markets = parseSequifiFields(job.raw_sequifi_payload ?? {}).markets;
  const out = new Set<EmpwrTypeformState>();
  for (const part of markets.split(/[,/;]+/)) {
    const token = part.trim().toLowerCase();
    if (!token) continue;
    const code = STATE_NAME_TO_CODE[token];
    if (code) out.add(code);
  }
  return EMPWR_TYPEFORM_STATES.filter(s => out.has(s));
}

/** Normalize Sequifi date strings to YYYY-MM-DD for Typeform date fields. */
export function normalizeEmpwrTypeformDate(raw: string): string {
  const s = trim(raw);
  if (!s) return "";
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (us) {
    const mm = us[1].padStart(2, "0");
    const dd = us[2].padStart(2, "0");
    return `${us[3]}-${mm}-${dd}`;
  }
  return s;
}

export interface EmpwrTypeformFields {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  teamId: string;
  newToEmpower: "New to Empower";
  accessNeeded: EmpwrTypeformAccess;
  homeServices: string[];
  financiers: string[];
  consentYes: true;
  states: EmpwrTypeformState[];
  /** Present only when CA is among states — required by form logic. */
  his: {
    licenseNumber: string;
    issueDate: string;
    expirationDate: string;
    cslbPermissionYes: true;
  } | null;
}

export function buildEmpwrTypeformFields(job: OnboardingJob): EmpwrTypeformFields {
  const parsed = parseSequifiFields(job.raw_sequifi_payload ?? {});
  const states = resolveEmpwrTypeformStates(job);
  const needsHis = states.includes("CA");

  return {
    firstName: trim(job.first_name),
    lastName: trim(job.last_name),
    phone: trim(job.phone),
    email: buildEmpwrTypeformEmail(job.first_name ?? "", job.last_name ?? ""),
    teamId: (env.empwrTypeformTeamId?.trim() || "803"),
    newToEmpower: "New to Empower",
    accessNeeded: mapEmpwrTypeformAccess(job),
    homeServices: [...EMPWR_HOME_SERVICES],
    financiers: [...EMPWR_FINANCIERS_EXCEPT_GOODLEAP],
    consentYes: true,
    states,
    his: needsHis
      ? {
          licenseNumber: trim(parsed.caHis),
          issueDate: normalizeEmpwrTypeformDate(parsed.hisIssueDate),
          expirationDate: normalizeEmpwrTypeformDate(parsed.hisExpDate),
          cslbPermissionYes: true,
        }
      : null,
  };
}

export function validateEmpwrTypeformFields(fields: EmpwrTypeformFields): string | null {
  if (!fields.firstName) return "Missing required field: first name";
  if (!fields.lastName) return "Missing required field: last name";
  if (!fields.phone) return "Missing required field: phone";
  if (!fields.email) return "Missing required field: email";
  if (!fields.teamId) return "Missing required field: Team ID";
  if (!fields.states.length) {
    return "No Empwr Typeform states mapped from Sequifi markets (need AZ, CA, UT, and/or TX)";
  }
  if (fields.his) {
    if (!fields.his.licenseNumber) return "CA selected but HIS License Number is missing";
    if (!fields.his.issueDate) return "CA selected but HIS Issue Date is missing";
    if (!fields.his.expirationDate) return "CA selected but HIS Exp Date is missing";
  }
  if (fields.financiers.includes("Goodleap")) {
    return "Goodleap must not be selected (SOP)";
  }
  return null;
}

/**
 * Submit closer/admin Empwr reps to the Empower Typeform when Sequifi EMPWR
 * tab is set (non-blocking). Setters are skipped per SOP.
 */
export async function submitEmpwrTypeform(
  job: OnboardingJob,
  options?: { ignoreDryRun?: boolean },
): Promise<"sent" | "skipped" | "failed"> {
  if (!options?.ignoreDryRun && env.onboardingDryRun) return "skipped";
  if (job.status !== "completed") return "skipped";
  if (!jobHasEmpwrInstallerTab(job)) return "skipped";
  if (!isEmpwrTypeformConfigured()) return "skipped";
  if (empwrTypeformAlreadySent(job)) return "skipped";
  if (shouldSkipEmpwrTypeformForSetter(job)) return "skipped";

  const fields = buildEmpwrTypeformFields(job);
  const validationError = validateEmpwrTypeformFields(fields);
  if (validationError) {
    await updateJobStep(job.id, {
      step_errors: { ...job.step_errors, empwr_typeform: validationError },
    });
    return "failed";
  }

  const url = env.empwrTypeformUrl?.trim() || "https://form.typeform.com/to/UvpPrheO";
  const result = await submitEmpwrTypeformViaBrowser(fields, url);

  await updateJobStep(job.id, {
    step_errors: {
      ...job.step_errors,
      empwr_typeform: result.status === "sent" ? SENT_FLAG : (result.reason ?? "failed"),
    },
  });
  return result.status;
}
