/**
 * GoodPWR partner onboarding — "New Sales Rep Onboarding" JotForm (Step 1 of
 * the SOP).
 *
 * Form: https://form.jotform.com/261804783661160
 *
 * Same SOP field defaults as the prior Google Form. JotForm's public submit
 * endpoint challenges scripted POSTs with CAPTCHA, so submission drives a
 * headless browser (see goodpwr-jotform-browser.ts), same stack as Tron.
 */
import { env } from "@/lib/env";
import { buildWorkUpn } from "@/lib/onboarding/normalize";
import { updateJobStep } from "@/lib/onboarding/repository";
import { getSequifiFieldValue, parseSequifiFields } from "@/lib/onboarding/sequifi-fields";
import { submitGoodPwrJotFormViaBrowser } from "@/lib/onboarding/goodpwr-jotform-browser";
import type { OnboardingJob } from "@/lib/onboarding/types";

const SENT_FLAG = "sent";
const DEFAULT_FORM_ID = "261804783661160";

/** Static per the SOP: "We are only selling in New York, OR and IL currently." */
const SOP_MARKETS = ["New York", "Oregon", "Illinois"];
/** Static per the SOP: "No HIS should be required." */
const SOP_HIS_LICENSE = "Not selling in these markets";
/** Static per the SOP: "Yes to Enerflo." */
const SOP_USING_ENERFLO = "Yes";
const SOP_SALES_ORG = "Solar Pros";
/** SOP defaults (exact JotForm option labels). Sequifi custom fields override. */
const SOP_PREFERRED_LENDER = "Sungage";
const SOP_PREFERRED_TPO = "LightReach";

/** Optional Sequifi overrides; if unset we use SOP_PREFERRED_*. */
const LENDER_FIELD_NAMES = ["Preferred Lender", "GoodPWR Lender", "GoodPWR Preferred Lender", "Lender"];
const TPO_FIELD_NAMES = ["Preferred TPO", "GoodPWR TPO", "GoodPWR Preferred TPO", "TPO"];

function trim(s: string | null | undefined): string {
  return (s ?? "").trim();
}

/** Format a phone number for JotForm's masked "(000) 000-0000" phone field. */
function formatPhoneForJotForm(raw: string | null | undefined): string {
  const digits = (raw ?? "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return trim(raw);
}

export function isGoodPwrFormConfigured(): boolean {
  return Boolean(env.goodPwrFormEnabled && (env.jotformGoodPwrFormId?.trim() || DEFAULT_FORM_ID));
}

export function jobHasGoodPwrInstallerTab(job: OnboardingJob): boolean {
  return parseSequifiFields(job.raw_sequifi_payload ?? {}).installerTabs.some(
    tab => tab.trim().toLowerCase() === "goodpwr",
  );
}

export function goodPwrFormAlreadySent(job: OnboardingJob): boolean {
  return job.step_errors.goodpwr_form === SENT_FLAG;
}

/** Sequifi custom field if present; otherwise SOP default Sungage. */
export function resolveGoodPwrLender(job: Pick<OnboardingJob, "raw_sequifi_payload">): string {
  const raw = job.raw_sequifi_payload ?? {};
  for (const name of LENDER_FIELD_NAMES) {
    const value = getSequifiFieldValue(raw, name);
    if (value) return value;
  }
  return SOP_PREFERRED_LENDER;
}

/** Sequifi custom field if present; otherwise SOP default LightReach. */
export function resolveGoodPwrTpo(job: Pick<OnboardingJob, "raw_sequifi_payload">): string {
  const raw = job.raw_sequifi_payload ?? {};
  for (const name of TPO_FIELD_NAMES) {
    const value = getSequifiFieldValue(raw, name);
    if (value) return value;
  }
  return SOP_PREFERRED_TPO;
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
  /** Optional Recheck # — left blank (not required on the form). */
  recheck: string;
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
    phone: formatPhoneForJotForm(job.phone),
    salesOrganization: SOP_SALES_ORG,
    recheck: "",
    markets: [...SOP_MARKETS],
    hisLicense: SOP_HIS_LICENSE,
    usingEnerflo: SOP_USING_ENERFLO,
    preferredLender: resolveGoodPwrLender(job),
    preferredTpo: resolveGoodPwrTpo(job),
    comments: "",
  };
}

/**
 * Build the application/x-www-form-urlencoded body JotForm's own form posts.
 * Field names read from https://form.jotform.com/261804783661160.
 */
export function buildGoodPwrFormBody(fields: GoodPwrFormFields, formId: string): URLSearchParams {
  const body = new URLSearchParams();
  body.append("formID", formId);
  body.append("simple_spc", formId);
  body.append("website", "");
  body.append("q3_repFull[first]", fields.firstName);
  body.append("q3_repFull[last]", fields.lastName);
  body.append("q51_phoneNumber[full]", fields.phone);
  body.append("q31_email", fields.email);
  body.append("q26_salesPartner", fields.salesOrganization);
  if (fields.recheck) body.append("q35_recheck", fields.recheck);
  for (const market of fields.markets) {
    body.append("q45_marketsselect[]", market);
  }
  body.append("q46_hisLicense[]", fields.hisLicense);
  body.append("q47_willYou", fields.usingEnerflo);
  body.append("q48_preferredLender", fields.preferredLender);
  body.append("q49_preferredTpo", fields.preferredTpo);
  if (fields.comments) body.append("q50_anyAdditional", fields.comments);
  return body;
}

/**
 * Submit rep details to the GoodPWR "New Sales Rep Onboarding" JotForm when
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
      !fields.preferredLender && "Preferred Lender",
      !fields.preferredTpo && "Preferred TPO",
    ]
      .filter(Boolean)
      .join(", ");
    await updateJobStep(job.id, {
      step_errors: { ...job.step_errors, goodpwr_form: `Missing required field(s): ${missing}` },
    });
    return "failed";
  }

  const formId = env.jotformGoodPwrFormId?.trim() || DEFAULT_FORM_ID;
  const result = await submitGoodPwrJotFormViaBrowser(fields, formId);

  await updateJobStep(job.id, {
    step_errors: {
      ...job.step_errors,
      goodpwr_form: result.status === "sent" ? SENT_FLAG : (result.reason ?? "failed"),
    },
  });
  return result.status;
}
