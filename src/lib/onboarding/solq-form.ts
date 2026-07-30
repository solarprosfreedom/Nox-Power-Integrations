/**
 * SolQ partner onboarding — LeadConnector "Employee Submission" form.
 *
 * Form: https://msg.black33.io/widget/form/zEAvzxnz1cl1TTDNNMSz
 *
 * Trigger: Sequifi Other Installers? contains SolQ / SOLQ.
 * Cloudflare sits in front of LeadConnector submit, so submission drives a
 * headless browser (see solq-form-browser.ts), same stack as Tron/Empower.
 *
 * SOP defaults: Full Time, Outside Org Rep, Outside Org Name = Solar Pros,
 * submitter = Nox Power Admin, start date = Sequifi or today. Rep Card /
 * shirt / coat / headshot left blank per ops.
 */
import { env } from "@/lib/env";
import { updateJobStep } from "@/lib/onboarding/repository";
import {
  isApptSetterName,
  sequifiPositionContextFromJob,
} from "@/lib/onboarding/role-map";
import { resolveSalesManagerName } from "@/lib/onboarding/tron-jotform";
import { getSequifiFieldValue, parseSequifiFields } from "@/lib/onboarding/sequifi-fields";
import { submitSolqFormViaBrowser } from "@/lib/onboarding/solq-form-browser";
import type { OnboardingJob } from "@/lib/onboarding/types";

const SENT_FLAG = "sent";
const DEFAULT_FORM_URL = "https://msg.black33.io/widget/form/zEAvzxnz1cl1TTDNNMSz";

export const SOLQ_MARKETS = ["Iowa", "Michigan", "Wisconsin", "Illinois", "Other"] as const;
export type SolqMarket = (typeof SOLQ_MARKETS)[number];

export const SOLQ_POSITIONS = ["Closer", "Setter", "Setter & Closer", "Other"] as const;
export type SolqPosition = (typeof SOLQ_POSITIONS)[number];

const MARKET_ALIASES: Record<string, SolqMarket> = {
  iowa: "Iowa",
  ia: "Iowa",
  michigan: "Michigan",
  mi: "Michigan",
  wisconsin: "Wisconsin",
  wi: "Wisconsin",
  illinois: "Illinois",
  il: "Illinois",
};

function trim(s: string | null | undefined): string {
  return (s ?? "").trim();
}

export function isSolqFormConfigured(): boolean {
  return Boolean(env.solqFormEnabled && (env.solqFormUrl?.trim() || DEFAULT_FORM_URL));
}

/** Match SolQ / SOLQ from Other Installers or roster tab. */
export function isSolqTabName(name: string | null | undefined): boolean {
  return /^solq$/i.test(trim(name));
}

export function jobHasSolqInstallerTab(job: OnboardingJob): boolean {
  const tabs = parseSequifiFields(job.raw_sequifi_payload ?? {}).installerTabs;
  if (tabs.some(isSolqTabName)) return true;
  const other = getSequifiFieldValue(job.raw_sequifi_payload ?? {}, "Other Installers?");
  if (!other) return false;
  if (isSolqTabName(other)) return true;
  return other.split(/[,;/]+/).some(part => isSolqTabName(part));
}

export function solqFormAlreadySent(job: OnboardingJob): boolean {
  return job.step_errors.solq_form === SENT_FLAG;
}

/** Map Sequifi position → SolQ form Position picklist. */
export function mapSolqPosition(
  job: Pick<OnboardingJob, "raw_sequifi_payload" | "role_label">,
): SolqPosition {
  const ctx = sequifiPositionContextFromJob(job);
  const displayed = (ctx.subPositionName || ctx.positionName).trim();
  const lower = displayed.toLowerCase();
  if (/setter\s*&\s*closer|closer\s*&\s*setter|both/i.test(displayed)) return "Setter & Closer";
  if (isApptSetterName(displayed) || lower === "setter") return "Setter";
  if (/^closer$/i.test(displayed) || /sales\s*rep/i.test(displayed)) return "Closer";
  return "Other";
}

/** Map Sequifi markets into SolQ's IA/MI/WI/IL/Other picklist; default Iowa. */
export function resolveSolqMarkets(job: Pick<OnboardingJob, "raw_sequifi_payload">): SolqMarket[] {
  const markets = parseSequifiFields(job.raw_sequifi_payload ?? {}).markets;
  const out = new Set<SolqMarket>();
  for (const part of markets.split(/[,/;]+/)) {
    const token = part.trim().toLowerCase();
    if (!token) continue;
    const mapped = MARKET_ALIASES[token];
    if (mapped) out.add(mapped);
  }
  if (!out.size) out.add("Iowa");
  return SOLQ_MARKETS.filter(m => out.has(m));
}

/** Prefer Sequifi start/hire date; fall back to today (YYYY-MM-DD). */
export function resolveSolqStartDate(
  job: Pick<OnboardingJob, "raw_sequifi_payload" | "created_at">,
  now: Date = new Date(),
): string {
  const raw = job.raw_sequifi_payload ?? {};
  const candidates = [
    getSequifiFieldValue(raw, "Start Date"),
    getSequifiFieldValue(raw, "Hire Date"),
    getSequifiFieldValue(raw, "Employment Start Date"),
    typeof raw.start_date === "string" ? raw.start_date : "",
    typeof raw.hire_date === "string" ? raw.hire_date : "",
    typeof raw.created_at === "string" ? raw.created_at : "",
    trim(job.created_at),
  ];
  for (const c of candidates) {
    const iso = toIsoDate(c);
    if (iso) return iso;
  }
  return now.toISOString().slice(0, 10);
}

function toIsoDate(raw: string): string {
  const s = trim(raw);
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const us = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (us) {
    return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  }
  const t = Date.parse(s);
  if (!Number.isNaN(t)) return new Date(t).toISOString().slice(0, 10);
  return "";
}

/** Notes: team + manager (+ office when present). */
export function buildSolqNotes(job: OnboardingJob): string {
  const raw = job.raw_sequifi_payload ?? {};
  const team =
    getSequifiFieldValue(raw, "Team") ||
    trim(String(raw.team_name ?? raw.team ?? ""));
  const office =
    getSequifiFieldValue(raw, "Office") ||
    trim(String(raw.office_name ?? ""));
  const manager = resolveSalesManagerName(job);
  const parts: string[] = [];
  if (team) parts.push(`Team: ${team}`);
  if (office) parts.push(`Office: ${office}`);
  if (manager) parts.push(`Manager: ${manager}`);
  return parts.join(" | ") || "Solar Pros / Nox Power";
}

export interface SolqFormFields {
  submitterName: string;
  markets: SolqMarket[];
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  position: SolqPosition;
  employmentType: "Full Time";
  startDate: string;
  internalOrOutside: "Outside Org Rep";
  outsideOrgName: string;
  notes: string;
}

export function buildSolqFormFields(job: OnboardingJob, now: Date = new Date()): SolqFormFields {
  return {
    submitterName: env.solqFormSubmitterName?.trim() || "Nox Power Admin",
    markets: resolveSolqMarkets(job),
    firstName: trim(job.first_name),
    lastName: trim(job.last_name),
    phone: trim(job.phone),
    email: trim(job.email),
    position: mapSolqPosition(job),
    employmentType: "Full Time",
    startDate: resolveSolqStartDate(job, now),
    internalOrOutside: "Outside Org Rep",
    outsideOrgName: env.solqOutsideOrgName?.trim() || "Solar Pros",
    notes: buildSolqNotes(job),
  };
}

export function validateSolqFormFields(fields: SolqFormFields): string | null {
  if (!fields.submitterName) return "Missing required field: submitter name";
  if (!fields.firstName) return "Missing required field: first name";
  if (!fields.lastName) return "Missing required field: last name";
  if (!fields.phone) return "Missing required field: phone";
  if (!fields.email) return "Missing required field: personal email";
  if (!fields.position) return "Missing required field: position";
  if (!fields.startDate) return "Missing required field: start date";
  if (!fields.outsideOrgName) return "Missing required field: Outside Org Name";
  if (!fields.notes) return "Missing required field: notes";
  return null;
}

/**
 * Submit SolQ Employee Submission form when Other Installers / SolQ tab is set
 * (non-blocking).
 */
export async function submitSolqForm(
  job: OnboardingJob,
  options?: { ignoreDryRun?: boolean },
): Promise<"sent" | "skipped" | "failed"> {
  if (!options?.ignoreDryRun && env.onboardingDryRun) return "skipped";
  if (job.status !== "completed") return "skipped";
  if (!jobHasSolqInstallerTab(job)) return "skipped";
  if (!isSolqFormConfigured()) return "skipped";
  if (solqFormAlreadySent(job)) return "skipped";

  const fields = buildSolqFormFields(job);
  const validationError = validateSolqFormFields(fields);
  if (validationError) {
    await updateJobStep(job.id, {
      step_errors: { ...job.step_errors, solq_form: validationError },
    });
    return "failed";
  }

  const url = env.solqFormUrl?.trim() || DEFAULT_FORM_URL;
  const result = await submitSolqFormViaBrowser(fields, url);

  await updateJobStep(job.id, {
    step_errors: {
      ...job.step_errors,
      solq_form: result.status === "sent" ? SENT_FLAG : (result.reason ?? "failed"),
    },
  });
  return result.status;
}
