/**
 * Better Earth partner onboarding — "Sales Rep Onboarding" form submit.
 *
 * The form (https://forms.betterearth.solar/sales-onboarding) is built on
 * Fillout.com, not a plain HTML form. It has no CAPTCHA/anti-bot gate — the
 * client just calls two plain JSON REST endpoints:
 *   1. POST https://api.fillout.com/v1/flow/{flowId}/init     (open a session)
 *   2. POST https://api.fillout.com/v1/flow/{flowId}/continue (submit answers)
 * Both were confirmed reachable via a direct server-side fetch (no browser
 * needed), unlike Tron's JotForm.
 *
 * Field IDs, the flow's step ID, and the "States Selling in" option IDs below
 * were read directly off the flow's own published schema
 * (GET https://forms.betterearth.solar/_next/data/.../sales-onboarding.json).
 *
 * Conditional fields: if "States Selling in" includes California, the form
 * also requires "HIS Person License Number" + "HIS Person License Expiration
 * Date" (California's Home Improvement Sales licensing requirement) — sourced
 * from the same Sequifi custom fields already used for roster sheets
 * (parsed.caHis / parsed.hisExpDate).
 */
import { env } from "@/lib/env";
import { buildWorkUpn } from "@/lib/onboarding/normalize";
import { updateJobStep } from "@/lib/onboarding/repository";
import { parseSequifiFields } from "@/lib/onboarding/sequifi-fields";
import type { OnboardingJob } from "@/lib/onboarding/types";

const SENT_FLAG = "sent";
const STEP_ID = "x8AY";
const API_BASE = "https://api.fillout.com/v1";
const FORM_DOMAIN = "forms.betterearth.solar";
const FLOW_OWNER_USER_ID = 683604;
const ORGANIZATION_ID = 377876;

/** Field ids, read off the live flow schema. */
const FIELD = {
  salesCompany: "tFfy",
  firstName: "p1rc",
  lastName: "oWvu",
  phone: "rnVh",
  companyEmail: "h2FG",
  personalEmail: "spCC",
  dob: "p6Ha",
  states: "iY8D",
  hisLicenseNumber: "8zDR",
  hisLicenseExpDate: "geCw",
} as const;

/** "States Selling in" is a fixed 4-option list on the live form. */
const STATE_OPTION_IDS: Record<string, string> = {
  California: "bjGZ",
  Arizona: "w5vt",
  Florida: "d7xr",
  Texas: "fxnu",
};

const STATE_ABBREVIATIONS: Record<string, string> = {
  CA: "California",
  AZ: "Arizona",
  FL: "Florida",
  TX: "Texas",
};

function trim(s: string | null | undefined): string {
  return (s ?? "").trim();
}

export function isBetterEarthFormConfigured(): boolean {
  return Boolean(env.betterEarthFormEnabled && env.betterEarthFormFlowId?.trim());
}

export function jobHasBetterEarthInstallerTab(job: OnboardingJob): boolean {
  return parseSequifiFields(job.raw_sequifi_payload ?? {}).installerTabs.some(
    tab => tab.trim().toLowerCase() === "better earth",
  );
}

export function betterEarthFormAlreadySent(job: OnboardingJob): boolean {
  return job.step_errors.better_earth_form === SENT_FLAG;
}

function workEmailForJob(job: OnboardingJob): string {
  const upn = trim(job.microsoft_upn);
  if (upn) return upn;
  const domain = env.msDefaultDomain?.trim() || "noxpwr.com";
  return buildWorkUpn(job.first_name ?? "", job.last_name ?? "", domain);
}

function personalEmailForJob(job: OnboardingJob): string {
  return trim(job.welcome_email_to) || trim(job.email);
}

/** E.164, e.g. "+15555550123" — matches the format the live form itself sends. */
function formatPhoneE164(raw: string | null | undefined): string {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return trim(raw);
}

/** Sequifi's GET /v1/users `dob` field is already "YYYY-MM-DD" — exactly what
 * the form's DatePicker fields expect, no conversion needed. */
function resolveDobString(job: Pick<OnboardingJob, "raw_sequifi_payload">): string {
  const raw = job.raw_sequifi_payload ?? {};
  const dob = raw.dob;
  if (typeof dob !== "string") return "";
  return /^\d{4}-\d{2}-\d{2}/.test(dob.trim()) ? dob.trim().slice(0, 10) : "";
}

export interface BetterEarthStates {
  /** States Better Earth's form actually supports (California/Arizona/Florida/Texas). */
  supported: string[];
  /** States Sequifi listed that the form has no option for — surfaced as a warning, not a hard failure. */
  unsupported: string[];
}

/** Parses Sequifi's markets/state_code field (e.g. "CA, NV" or "AZ") against the
 * form's fixed 4-state list. Accepts both 2-letter codes and full names. */
export function resolveBetterEarthStates(job: Pick<OnboardingJob, "raw_sequifi_payload">): BetterEarthStates {
  const markets = parseSequifiFields(job.raw_sequifi_payload ?? {}).markets;
  const supported = new Set<string>();
  const unsupported = new Set<string>();

  for (const part of markets.split(/[,/;]+/)) {
    const token = part.trim();
    if (!token) continue;
    const full = STATE_ABBREVIATIONS[token.toUpperCase()] ?? token;
    const matched = Object.keys(STATE_OPTION_IDS).find(s => s.toLowerCase() === full.toLowerCase());
    if (matched) supported.add(matched);
    else unsupported.add(token);
  }

  return { supported: [...supported], unsupported: [...unsupported] };
}

export interface BetterEarthFormFields {
  salesCompany: string;
  firstName: string;
  lastName: string;
  phone: string;
  companyEmail: string;
  personalEmail: string;
  dob: string;
  states: BetterEarthStates;
  hisLicenseNumber: string;
  hisLicenseExpDate: string;
}

export function buildBetterEarthFormFields(job: OnboardingJob): BetterEarthFormFields {
  const parsed = parseSequifiFields(job.raw_sequifi_payload ?? {});
  return {
    salesCompany: env.betterEarthSalesCompany?.trim() || "NOX Power",
    firstName: trim(job.first_name),
    lastName: trim(job.last_name),
    phone: formatPhoneE164(job.phone),
    companyEmail: workEmailForJob(job),
    personalEmail: personalEmailForJob(job),
    dob: resolveDobString(job),
    states: resolveBetterEarthStates(job),
    hisLicenseNumber: parsed.caHis,
    hisLicenseExpDate: parsed.hisExpDate,
  };
}

function randomAlphaNumeric(length: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < length; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

/** Build the JSON body for POST /v1/flow/{flowId}/continue — shape confirmed
 * live against the real flow (single-step form, stepId "x8AY"). */
export function buildBetterEarthContinuePayload(
  fields: BetterEarthFormFields,
  sessionToken: string,
  submissionId: string,
): Record<string, unknown> {
  const selectedOptionIds = fields.states.supported.map(s => STATE_OPTION_IDS[s]).filter(Boolean);
  return {
    mode: "live",
    sessionToken,
    stepId: STEP_ID,
    model: {
      urlParams: {},
      stepHistory: { path: [STEP_ID] },
      calculations: {},
      globals: { submissionId },
      quiz: {},
      bShV: {},
      [STEP_ID]: {
        [FIELD.hisLicenseNumber]: { value: fields.hisLicenseNumber },
        [FIELD.hisLicenseExpDate]: { value: fields.hisLicenseExpDate },
        [FIELD.companyEmail]: { value: fields.companyEmail },
        [FIELD.states]: { value: fields.states.supported, selectedOptionIds },
        [FIELD.lastName]: { value: fields.lastName },
        [FIELD.firstName]: { value: fields.firstName },
        [FIELD.dob]: { value: fields.dob },
        [FIELD.phone]: { value: fields.phone },
        [FIELD.personalEmail]: { value: fields.personalEmail },
        [FIELD.salesCompany]: { value: fields.salesCompany },
      },
    },
    version: "v2",
    updateSequenceNumber: 1,
    metadata: { timeToCompleteInSeconds: 20, timezone: "America/New_York" },
  };
}

async function postFillout(path: string, body: Record<string, unknown>): Promise<{ ok: boolean; status: number; text: string }> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: `https://${FORM_DOMAIN}`,
      referer: `https://${FORM_DOMAIN}/sales-onboarding`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

/**
 * Submit rep details to the Better Earth "Sales Rep Onboarding" form when the
 * Sequifi "Onboard to Better Earth?" tab is set. Direct REST calls to Fillout's
 * API — no headless browser needed (confirmed no CAPTCHA on this form).
 */
export async function submitBetterEarthForm(
  job: OnboardingJob,
  options?: { ignoreDryRun?: boolean },
): Promise<"sent" | "skipped" | "failed"> {
  if (!options?.ignoreDryRun && env.onboardingDryRun) return "skipped";
  if (job.status !== "completed") return "skipped";
  if (!jobHasBetterEarthInstallerTab(job)) return "skipped";
  if (!isBetterEarthFormConfigured()) return "skipped";
  if (betterEarthFormAlreadySent(job)) return "skipped";

  const fields = buildBetterEarthFormFields(job);
  const missing = [
    !fields.salesCompany && "sales company",
    !fields.firstName && "first name",
    !fields.lastName && "last name",
    !fields.phone && "phone",
    !fields.companyEmail && "company email",
    !fields.personalEmail && "personal email",
    !fields.dob && "date of birth",
    !fields.states.supported.length && "states selling in (none of Sequifi's markets match Better Earth's supported states: California, Arizona, Florida, Texas)",
  ].filter(Boolean);

  const needsHis = fields.states.supported.includes("California");
  if (needsHis && !fields.hisLicenseNumber) missing.push("HIS license number (required for California, no value in Sequifi)");
  if (needsHis && !fields.hisLicenseExpDate) missing.push("HIS license expiration date (required for California, no value in Sequifi)");

  if (missing.length) {
    await updateJobStep(job.id, {
      step_errors: { ...job.step_errors, better_earth_form: `Missing required field(s): ${missing.join(", ")}` },
    });
    return "failed";
  }

  try {
    const flowId = env.betterEarthFormFlowId?.trim() ?? "";
    const sessionToken = randomAlphaNumeric(32);
    const init = await postFillout(`/flow/${flowId}/init`, {
      sessionToken,
      isEditingSubmission: false,
      domain: FORM_DOMAIN,
      flowOwnerUserId: FLOW_OWNER_USER_ID,
      mode: "live",
      organizationId: ORGANIZATION_ID,
      uniqueVisitor: true,
    });
    if (!init.ok) {
      await updateJobStep(job.id, {
        step_errors: { ...job.step_errors, better_earth_form: `Fillout init ${init.status}: ${init.text.slice(0, 300)}` },
      });
      return "failed";
    }

    const submissionId = crypto.randomUUID();
    const payload = buildBetterEarthContinuePayload(fields, sessionToken, submissionId);
    const submit = await postFillout(`/flow/${flowId}/continue`, payload);
    if (!submit.ok) {
      await updateJobStep(job.id, {
        step_errors: { ...job.step_errors, better_earth_form: `Fillout submit ${submit.status}: ${submit.text.slice(0, 500)}` },
      });
      return "failed";
    }

    if (fields.states.unsupported.length) {
      await updateJobStep(job.id, {
        step_errors: {
          ...job.step_errors,
          better_earth_form: SENT_FLAG,
          better_earth_form_note: `Submitted, but Sequifi also listed market(s) Better Earth's form has no option for: ${fields.states.unsupported.join(", ")}`,
        },
      });
    } else {
      await updateJobStep(job.id, {
        step_errors: { ...job.step_errors, better_earth_form: SENT_FLAG },
      });
    }
    return "sent";
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await updateJobStep(job.id, {
      step_errors: { ...job.step_errors, better_earth_form: msg },
    });
    return "failed";
  }
}
