import { env } from "@/lib/env";
import { buildWorkUpn } from "@/lib/onboarding/normalize";
import { updateJobStep } from "@/lib/onboarding/repository";
import {
  isApptSetterName,
  sequifiPositionContextFromJob,
} from "@/lib/onboarding/role-map";
import { getSequifiFieldValue, parseSequifiFields } from "@/lib/onboarding/sequifi-fields";
import { submitTronJotFormViaBrowser } from "@/lib/onboarding/tron-jotform-browser";
import type { OnboardingJob } from "@/lib/onboarding/types";

const SENT_FLAG = "sent";
const SALES_ORG_NAME = "NOX Power";

/**
 * Full platform checklist for Sales Reps (Closers). Appt Setters/Setters only get
 * Aurora — see resolveTronPlatforms below.
 */
const ALL_TRON_PLATFORMS = [
  "Aurora",
  "Sunrun",
  "Palmetto",
  "Dividend",
  "Coperniq",
  "GroupMe Access",
  "Enfin",
] as const;

function trim(s: string | null | undefined): string {
  return (s ?? "").trim();
}

export function isTronJotFormConfigured(): boolean {
  return Boolean(env.jotformTronEnabled && env.jotformTronFormId?.trim());
}

export function jobHasTronInstallerTab(job: OnboardingJob): boolean {
  return parseSequifiFields(job.raw_sequifi_payload ?? {}).installerTabs.some(
    tab => tab.trim().toLowerCase() === "tron",
  );
}

export function tronJotFormAlreadySent(job: OnboardingJob): boolean {
  return job.step_errors.tron_jotform === SENT_FLAG;
}

/**
 * Platforms Log-Ins Needed checklist — decided purely by Sequifi's sub_position_name
 * (the "Position" label Sequifi's own UI displays), same field/rule used for the Axia
 * notification skip and the EMPWR HubSpot role mapping. A hybrid rep flagged "May act
 * as both Setter and Closer" still only gets Aurora if their displayed position is
 * Setter/Appt Setter — the closer-capability flag does not upgrade them here.
 */
export function resolveTronPlatforms(
  job: Pick<OnboardingJob, "raw_sequifi_payload" | "role_label">,
): string[] {
  const ctx = sequifiPositionContextFromJob(job);
  const displayedPosition = ctx.subPositionName || ctx.positionName;
  return isApptSetterName(displayedPosition) ? ["Aurora"] : [...ALL_TRON_PLATFORMS];
}

/**
 * Sequifi's GET /v1/users response carries the manager as a structured object —
 * `manager: { id, first_name, last_name, email }` — not a custom field (confirmed
 * against live data). Falls back to a "Manager" custom field or a plain string, in
 * case older cached job payloads or a future API shape carry it differently.
 */
export function resolveSalesManagerName(
  job: Pick<OnboardingJob, "raw_sequifi_payload">,
): string {
  const raw = job.raw_sequifi_payload ?? {};
  const managerObj = raw.manager as Record<string, unknown> | null | undefined;
  if (managerObj && typeof managerObj === "object") {
    const first = trim(String(managerObj.first_name ?? ""));
    const last = trim(String(managerObj.last_name ?? ""));
    const name = [first, last].filter(Boolean).join(" ");
    if (name) return name;
    const email = trim(String(managerObj.email ?? ""));
    if (email) return email;
  }
  if (typeof raw.manager === "string" && raw.manager.trim()) return raw.manager.trim();

  const fromCustomField = getSequifiFieldValue(raw, "Manager");
  if (fromCustomField) return fromCustomField;

  return String(raw.manager_name ?? raw.reporting_manager_name ?? "").trim();
}

function workEmailForJob(job: OnboardingJob): string {
  const upn = trim(job.microsoft_upn);
  if (upn) return upn;
  const domain = env.msDefaultDomain?.trim() || "noxpwr.com";
  return buildWorkUpn(job.first_name ?? "", job.last_name ?? "", domain);
}

/** Format a phone number for JotForm's masked "(000) 000-0000" phone field. */
function formatPhoneForJotForm(raw: string | null | undefined): string {
  const digits = (raw ?? "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return trim(raw);
}

export interface TronDob {
  month: string;
  day: string;
  year: string;
}

/**
 * Sequifi's GET /v1/users now returns a top-level `dob` field as "YYYY-MM-DD"
 * (confirmed against live data — was null/absent when this integration was first
 * built, populated for ~239/273 active users as of the last check). Split it into
 * JotForm's month/day/year sub-fields (see buildTronJotFormBody). Returns null if
 * missing or unparseable so callers can treat it like any other missing field.
 */
export function resolveDob(job: Pick<OnboardingJob, "raw_sequifi_payload">): TronDob | null {
  const raw = job.raw_sequifi_payload ?? {};
  const dob = raw.dob;
  if (typeof dob !== "string") return null;
  const match = dob.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const [, year, month, day] = match;
  return { month, day, year };
}

export interface TronJotFormFields {
  firstName: string;
  lastName: string;
  salesOrganization: string;
  email: string;
  phone: string;
  salesManager: string;
  notes: string;
  platforms: string[];
  dob: TronDob | null;
}

export function buildTronJotFormFields(job: OnboardingJob): TronJotFormFields {
  return {
    firstName: trim(job.first_name),
    lastName: trim(job.last_name),
    salesOrganization: SALES_ORG_NAME,
    email: workEmailForJob(job),
    phone: formatPhoneForJotForm(job.phone),
    salesManager: resolveSalesManagerName(job),
    // Left blank per business decision — no reliable source today.
    notes: "",
    platforms: resolveTronPlatforms(job),
    dob: resolveDob(job),
  };
}

/**
 * Build the application/x-www-form-urlencoded body JotForm's own form posts
 * (action="https://submit.jotform.com/submit/{formId}", no enctype override — plain
 * form-urlencoded since there's no file upload field). Field names/qids below were
 * read directly off the published form (question 3 = name, 4 = platforms, 5 = email,
 * 6 = phone, 7 = date of birth [month]/[day]/[year] sub-fields, 9 = sales org,
 * 15 = notes, 18 = sales manager).
 */
export function buildTronJotFormBody(fields: TronJotFormFields, formId: string): URLSearchParams {
  const body = new URLSearchParams();
  body.append("formID", formId);
  body.append("simple_spc", formId);
  // Honeypot anti-spam field — must stay empty.
  body.append("website", "");
  body.append("q3_name[first]", fields.firstName);
  body.append("q3_name[last]", fields.lastName);
  body.append("q9_typeA", fields.salesOrganization);
  body.append("q5_email", fields.email);
  body.append("q6_phoneNumber[full]", fields.phone);
  if (fields.dob) {
    body.append("q7_dateOf[month]", fields.dob.month);
    body.append("q7_dateOf[day]", fields.dob.day);
    body.append("q7_dateOf[year]", fields.dob.year);
  }
  for (const platform of fields.platforms) {
    body.append("q4_platformsLogins[]", platform);
  }
  if (fields.salesManager) body.append("q18_pleaseInput", fields.salesManager);
  body.append("q15_notes", fields.notes);
  return body;
}

/**
 * Submit rep details to the Tron "Log-In Request Form" (JotForm) when the Sequifi
 * "Onboard to Tron?" tab is set.
 *
 * Uses a real headless browser (see tron-jotform-browser.ts), not a plain POST —
 * JotForm's public submit endpoint returns a CAPTCHA challenge for scripted POSTs,
 * but reliably accepts a genuine browser session (confirmed via live testing).
 */
export async function submitTronJotForm(
  job: OnboardingJob,
  options?: { ignoreDryRun?: boolean },
): Promise<"sent" | "skipped" | "failed"> {
  if (!options?.ignoreDryRun && env.onboardingDryRun) return "skipped";
  if (job.status !== "completed") return "skipped";
  if (!jobHasTronInstallerTab(job)) return "skipped";
  if (!isTronJotFormConfigured()) return "skipped";
  if (tronJotFormAlreadySent(job)) return "skipped";

  const formId = env.jotformTronFormId?.trim() ?? "";
  const fields = buildTronJotFormFields(job);
  if (!fields.firstName || !fields.lastName || !fields.email || !fields.phone || !fields.dob) {
    await updateJobStep(job.id, {
      step_errors: {
        ...job.step_errors,
        tron_jotform: "Missing required field (first/last name, email, phone, or DOB)",
      },
    });
    return "failed";
  }

  const result = await submitTronJotFormViaBrowser(fields, formId);

  await updateJobStep(job.id, {
    step_errors: {
      ...job.step_errors,
      tron_jotform: result.status === "sent" ? SENT_FLAG : (result.reason ?? "failed"),
    },
  });
  return result.status;
}
