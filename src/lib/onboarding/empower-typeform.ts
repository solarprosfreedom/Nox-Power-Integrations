/**
 * Empower partner onboarding — "Empower New Rep Request" Typeform.
 *
 * Form: https://form.typeform.com/to/UvpPrheO
 *
 * Distinct from Empwr (HubSpot / Sequifi "Onboard to Empwr?"). Empower is
 * typically selected via Sequifi "Other Installers?" and the Empower roster tab.
 *
 * Typeform has no public create-response API, so submission drives a headless
 * browser (see empower-typeform-browser.ts), same stack as Tron JotForm.
 *
 * SOP: Appt Setters skip this form (jump to roster). Closers fill Team ID 803,
 * New to Empower, all home services, all financiers except Goodleap, consent,
 * Sequifi markets (AZ/CA/UT/TX only), and HIS when CA.
 */
import { env } from "@/lib/env";
import { submitEmpowerTypeformViaBrowser } from "@/lib/onboarding/empower-typeform-browser";
import { updateJobStep } from "@/lib/onboarding/repository";
import {
  isApptSetterName,
  sequifiPositionContextFromJob,
} from "@/lib/onboarding/role-map";
import { getSequifiFieldValue, parseSequifiFields } from "@/lib/onboarding/sequifi-fields";
import type { OnboardingJob } from "@/lib/onboarding/types";

const SENT_FLAG = "sent";

export const EMPOWER_TYPEFORM_STATES = ["AZ", "CA", "UT", "TX"] as const;
export type EmpowerTypeformState = (typeof EMPOWER_TYPEFORM_STATES)[number];

export const EMPOWER_HOME_SERVICES = [
  "Solar + Storage",
  "Roofing",
  "HVAC",
  "Maintenance Plans",
] as const;

/** SOP: select all financiers except Goodleap. */
export const EMPOWER_FINANCIERS_EXCEPT_GOODLEAP = [
  "Credit Human",
  "Enfin",
  "Lightreach",
  "Participate",
  "Solrite",
] as const;

export type EmpowerTypeformAccess = "Closer" | "Admin";

const STATE_NAME_TO_CODE: Record<string, EmpowerTypeformState> = {
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
export function buildEmpowerTypeformEmail(
  firstName: string,
  lastName: string,
  domain?: string,
): string {
  const d = (domain ?? env.empowerTypeformEmailDomain)?.trim() || "solarpros.io";
  return `${localPartFromName(firstName, lastName)}+emp@${d}`;
}

export function isEmpowerTypeformConfigured(): boolean {
  return Boolean(env.empowerTypeformEnabled && env.empowerTypeformUrl?.trim());
}

/**
 * Match Empower (Other Installers / roster tab). Never match Empwr — that
 * partner uses HubSpot via the Sequifi EMPWR dropdown.
 */
export function isEmpowerTabName(name: string | null | undefined): boolean {
  const n = trim(name).toLowerCase();
  if (!n) return false;
  if (n === "empwr") return false;
  return /\bempower\b/.test(n);
}

export function jobHasEmpowerInstallerTab(job: OnboardingJob): boolean {
  const tabs = parseSequifiFields(job.raw_sequifi_payload ?? {}).installerTabs;
  if (tabs.some(isEmpowerTabName)) return true;
  const other = getSequifiFieldValue(job.raw_sequifi_payload ?? {}, "Other Installers?");
  if (!other) return false;
  if (isEmpowerTabName(other)) return true;
  return other.split(/[,;/]+/).some(part => isEmpowerTabName(part));
}

export function empowerTypeformAlreadySent(job: OnboardingJob): boolean {
  return job.step_errors.empower_typeform === SENT_FLAG;
}

/**
 * SOP step 1: Appt Setters / Setters skip the Onboarding Link (jump to roster).
 * Uses displayed Sequifi Position (sub_position_name, else position_name).
 */
export function shouldSkipEmpowerTypeformForSetter(
  job: Pick<OnboardingJob, "raw_sequifi_payload" | "role_label">,
): boolean {
  const ctx = sequifiPositionContextFromJob(job);
  const displayed = ctx.subPositionName || ctx.positionName;
  return isApptSetterName(displayed);
}

/** Access Needed dropdown: Admin when position is Admin; otherwise Closer. */
export function mapEmpowerTypeformAccess(
  job: Pick<OnboardingJob, "raw_sequifi_payload" | "role_label">,
): EmpowerTypeformAccess {
  const ctx = sequifiPositionContextFromJob(job);
  const position = `${ctx.positionName} ${ctx.subPositionName}`.toLowerCase();
  if (/\badmin\b/.test(position)) return "Admin";
  return "Closer";
}

/** Map Sequifi markets into the Typeform's AZ/CA/UT/TX picklist. */
export function resolveEmpowerTypeformStates(
  job: Pick<OnboardingJob, "raw_sequifi_payload">,
): EmpowerTypeformState[] {
  const markets = parseSequifiFields(job.raw_sequifi_payload ?? {}).markets;
  const out = new Set<EmpowerTypeformState>();
  for (const part of markets.split(/[,/;]+/)) {
    const token = part.trim().toLowerCase();
    if (!token) continue;
    const code = STATE_NAME_TO_CODE[token];
    if (code) out.add(code);
  }
  return EMPOWER_TYPEFORM_STATES.filter(s => out.has(s));
}

/** Normalize Sequifi date strings to YYYY-MM-DD for Typeform date fields. */
export function normalizeEmpowerTypeformDate(raw: string): string {
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

export interface EmpowerTypeformFields {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  teamId: string;
  newToEmpower: "New to Empower";
  accessNeeded: EmpowerTypeformAccess;
  homeServices: string[];
  financiers: string[];
  consentYes: true;
  states: EmpowerTypeformState[];
  /** Present only when CA is among states — required by form logic. */
  his: {
    licenseNumber: string;
    issueDate: string;
    expirationDate: string;
    cslbPermissionYes: true;
  } | null;
}

export function buildEmpowerTypeformFields(job: OnboardingJob): EmpowerTypeformFields {
  const parsed = parseSequifiFields(job.raw_sequifi_payload ?? {});
  const states = resolveEmpowerTypeformStates(job);
  const needsHis = states.includes("CA");

  return {
    firstName: trim(job.first_name),
    lastName: trim(job.last_name),
    phone: trim(job.phone),
    email: buildEmpowerTypeformEmail(job.first_name ?? "", job.last_name ?? ""),
    teamId: env.empowerTypeformTeamId?.trim() || "803",
    newToEmpower: "New to Empower",
    accessNeeded: mapEmpowerTypeformAccess(job),
    homeServices: [...EMPOWER_HOME_SERVICES],
    financiers: [...EMPOWER_FINANCIERS_EXCEPT_GOODLEAP],
    consentYes: true,
    states,
    his: needsHis
      ? {
          licenseNumber: trim(parsed.caHis),
          issueDate: normalizeEmpowerTypeformDate(parsed.hisIssueDate),
          expirationDate: normalizeEmpowerTypeformDate(parsed.hisExpDate),
          cslbPermissionYes: true,
        }
      : null,
  };
}

export function validateEmpowerTypeformFields(fields: EmpowerTypeformFields): string | null {
  if (!fields.firstName) return "Missing required field: first name";
  if (!fields.lastName) return "Missing required field: last name";
  if (!fields.phone) return "Missing required field: phone";
  if (!fields.email) return "Missing required field: email";
  if (!fields.teamId) return "Missing required field: Team ID";
  if (!fields.states.length) {
    return "No Empower Typeform states mapped from Sequifi markets (need AZ, CA, UT, and/or TX)";
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
 * Submit closer/admin Empower reps to the Typeform when Other Installers /
 * Empower tab is set (non-blocking). Setters are skipped per SOP.
 */
export async function submitEmpowerTypeform(
  job: OnboardingJob,
  options?: { ignoreDryRun?: boolean },
): Promise<"sent" | "skipped" | "failed"> {
  if (!options?.ignoreDryRun && env.onboardingDryRun) return "skipped";
  if (job.status !== "completed") return "skipped";
  if (!jobHasEmpowerInstallerTab(job)) return "skipped";
  if (!isEmpowerTypeformConfigured()) return "skipped";
  if (empowerTypeformAlreadySent(job)) return "skipped";
  if (shouldSkipEmpowerTypeformForSetter(job)) return "skipped";

  const fields = buildEmpowerTypeformFields(job);
  const validationError = validateEmpowerTypeformFields(fields);
  if (validationError) {
    await updateJobStep(job.id, {
      step_errors: { ...job.step_errors, empower_typeform: validationError },
    });
    return "failed";
  }

  const url = env.empowerTypeformUrl?.trim() || "https://form.typeform.com/to/UvpPrheO";
  const result = await submitEmpowerTypeformViaBrowser(fields, url);

  await updateJobStep(job.id, {
    step_errors: {
      ...job.step_errors,
      empower_typeform: result.status === "sent" ? SENT_FLAG : (result.reason ?? "failed"),
    },
  });
  return result.status;
}
