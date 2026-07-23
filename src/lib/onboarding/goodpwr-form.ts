/**
 * GoodPWR partner onboarding — "New Sales Rep Onboarding" Google Form (Step 1 of
 * the SOP). Submits via Google's formResponse endpoint (plain POST — unlike Tron's
 * JotForm, Google Forms has no CAPTCHA/anti-bot gate on this form; it only
 * enforces required fields server-side, confirmed via research).
 *
 * Field → entry ID mapping below was read directly off the live form's embedded
 * FB_PUBLIC_LOAD_DATA_ config:
 * https://docs.google.com/forms/d/e/1FAIpQLScKv_hEmeYO_rg75JysNuR8pzX04zvT5bQe_1hb-XOjunCFYA/viewform
 */
import { env } from "@/lib/env";
import { buildWorkUpn } from "@/lib/onboarding/normalize";
import { updateJobStep } from "@/lib/onboarding/repository";
import { getSequifiFieldValue, parseSequifiFields } from "@/lib/onboarding/sequifi-fields";
import type { OnboardingJob } from "@/lib/onboarding/types";

const SENT_FLAG = "sent";

/** Static per the SOP: "We are only selling in New York, OR and IL currently." */
const SOP_MARKETS = ["New York", "Oregon", "Illinois"];
/** Static per the SOP: "No HIS should be required." */
const SOP_HIS_LICENSE = "Not selling in these markets";
/** Static per the SOP: "Yes to Enerflo." */
const SOP_USING_ENERFLO = "Yes";
const SOP_SALES_ORG = "Solar Pros";

/** Plausible custom-field names to check for Preferred Lender/TPO, in case ops
 * adds them to Sequifi later. None of these exist yet as of the last live check
 * against all active Sequifi users (confirmed via direct API scan). */
const LENDER_FIELD_NAMES = ["Preferred Lender", "GoodPWR Lender", "GoodPWR Preferred Lender", "Lender"];
const TPO_FIELD_NAMES = ["Preferred TPO", "GoodPWR TPO", "GoodPWR Preferred TPO", "TPO"];

function trim(s: string | null | undefined): string {
  return (s ?? "").trim();
}

export function isGoodPwrFormConfigured(): boolean {
  return Boolean(env.googleFormsGoodPwrEnabled && env.googleFormsGoodPwrFormId?.trim());
}

export function jobHasGoodPwrInstallerTab(job: OnboardingJob): boolean {
  return parseSequifiFields(job.raw_sequifi_payload ?? {}).installerTabs.some(
    tab => tab.trim().toLowerCase() === "goodpwr",
  );
}

export function goodPwrFormAlreadySent(job: OnboardingJob): boolean {
  return job.step_errors.goodpwr_form === SENT_FLAG;
}

/** No source in Sequifi today — checks a few plausible custom-field names for
 * forward-compatibility. Returns "" (not resolvable) if none are set. */
export function resolveGoodPwrLender(job: Pick<OnboardingJob, "raw_sequifi_payload">): string {
  const raw = job.raw_sequifi_payload ?? {};
  for (const name of LENDER_FIELD_NAMES) {
    const value = getSequifiFieldValue(raw, name);
    if (value) return value;
  }
  return "";
}

/** Same as resolveGoodPwrLender, for Preferred TPO. */
export function resolveGoodPwrTpo(job: Pick<OnboardingJob, "raw_sequifi_payload">): string {
  const raw = job.raw_sequifi_payload ?? {};
  for (const name of TPO_FIELD_NAMES) {
    const value = getSequifiFieldValue(raw, name);
    if (value) return value;
  }
  return "";
}

function workEmailForJob(job: OnboardingJob): string {
  const upn = trim(job.microsoft_upn);
  if (upn) return upn;
  const domain = env.msDefaultDomain?.trim() || "noxpwr.com";
  return buildWorkUpn(job.first_name ?? "", job.last_name ?? "", domain);
}

export interface GoodPwrFormFields {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  salesOrganization: string;
  markets: string[];
  hisLicense: string;
  usingEnerflo: string;
  preferredLender: string;
  preferredTpo: string;
  comments: string;
}

export function buildGoodPwrFormFields(job: OnboardingJob): GoodPwrFormFields {
  return {
    firstName: trim(job.first_name),
    lastName: trim(job.last_name),
    email: workEmailForJob(job),
    phone: trim(job.phone),
    salesOrganization: SOP_SALES_ORG,
    markets: [...SOP_MARKETS],
    hisLicense: SOP_HIS_LICENSE,
    usingEnerflo: SOP_USING_ENERFLO,
    preferredLender: resolveGoodPwrLender(job),
    preferredTpo: resolveGoodPwrTpo(job),
    // No source today — left blank, same as Tron's "notes".
    comments: "",
  };
}

/** Build the application/x-www-form-urlencoded body for Google's formResponse
 * endpoint. entry IDs read directly off the live form's embedded config. */
export function buildGoodPwrFormBody(fields: GoodPwrFormFields): URLSearchParams {
  const body = new URLSearchParams();
  body.append("entry.897722329", fields.firstName);
  body.append("entry.1646665289", fields.lastName);
  body.append("entry.219209550", fields.email);
  body.append("entry.41757151", fields.phone);
  body.append("entry.1235168892", fields.salesOrganization);
  for (const market of fields.markets) {
    body.append("entry.1790700221", market);
  }
  body.append("entry.1717147781", fields.hisLicense);
  body.append("entry.1551533457", fields.usingEnerflo);
  if (fields.preferredLender) body.append("entry.1667807314", fields.preferredLender);
  if (fields.preferredTpo) body.append("entry.879013296", fields.preferredTpo);
  if (fields.comments) body.append("entry.358987251", fields.comments);
  return body;
}

function submitUrl(formId: string): string {
  return `https://docs.google.com/forms/d/e/${formId}/formResponse`;
}

/**
 * Submit rep details to the GoodPWR "New Sales Rep Onboarding" Google Form when
 * the Sequifi "Onboard to Good Pwr?" tab is set (non-blocking).
 */
export async function submitGoodPwrForm(
  job: OnboardingJob,
  options?: { ignoreDryRun?: boolean },
): Promise<"sent" | "skipped" | "failed"> {
  if (!options?.ignoreDryRun && env.onboardingDryRun) return "skipped";
  if (job.status !== "completed") return "skipped";
  if (!jobHasGoodPwrInstallerTab(job)) return "skipped";
  if (!isGoodPwrFormConfigured()) return "skipped";
  if (goodPwrFormAlreadySent(job)) return "skipped";

  const fields = buildGoodPwrFormFields(job);
  if (
    !fields.firstName ||
    !fields.lastName ||
    !fields.email ||
    !fields.phone ||
    !fields.preferredLender ||
    !fields.preferredTpo
  ) {
    const missing = [
      !fields.firstName && "first name",
      !fields.lastName && "last name",
      !fields.email && "email",
      !fields.phone && "phone",
      !fields.preferredLender && "Preferred Lender (no source in Sequifi — ask the manager, add to Sequifi)",
      !fields.preferredTpo && "Preferred TPO (no source in Sequifi — ask the manager, add to Sequifi)",
    ]
      .filter(Boolean)
      .join(", ");
    await updateJobStep(job.id, {
      step_errors: { ...job.step_errors, goodpwr_form: `Missing required field(s): ${missing}` },
    });
    return "failed";
  }

  const formId = env.googleFormsGoodPwrFormId?.trim() ?? "";
  const body = buildGoodPwrFormBody(fields);

  try {
    const res = await fetch(submitUrl(formId), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const text = await res.text();
    const looksLikeValidationError = /this is a required question/i.test(text);
    if (!res.ok || looksLikeValidationError) {
      const reason = looksLikeValidationError
        ? `Google Forms rejected the submission — a required question was left blank: ${text.slice(0, 300)}`
        : `Google Forms ${res.status}: ${text.slice(0, 500)}`;
      await updateJobStep(job.id, {
        step_errors: { ...job.step_errors, goodpwr_form: reason },
      });
      return "failed";
    }

    await updateJobStep(job.id, {
      step_errors: { ...job.step_errors, goodpwr_form: SENT_FLAG },
    });
    return "sent";
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await updateJobStep(job.id, {
      step_errors: { ...job.step_errors, goodpwr_form: msg },
    });
    return "failed";
  }
}
