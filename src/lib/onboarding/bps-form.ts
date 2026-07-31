/**
 * Bright Planet Solar (BPS) partner onboarding — "Financier Portal Login Request"
 * Smartsheet form submit.
 *
 * Form URL (partner page embeds this Smartsheet form):
 * https://app.smartsheet.com/b/form/60e97ea684894846927bfc564a5a2d9e
 *
 * Submission is a plain multipart POST to Smartsheet's public form API
 * (GET form HTML → extract formToken → POST /api/submit/{publishKey}). Confirmed
 * live: CAPTCHA is NOT required for the main submit (captchaSiteKey exists for
 * the optional email-receipt path only). No headless browser needed.
 *
 * Trigger: Sequifi "Other Installers?" free-text containing "BPS" or
 * "Bright Planet Solar" (no dedicated Onboard-to dropdown today).
 */
import { env } from "@/lib/env";
import { buildWorkUpn } from "@/lib/onboarding/normalize";
import { updateJobStep } from "@/lib/onboarding/repository";
import { getSequifiDobIso, getSequifiFieldValue, parseSequifiFields } from "@/lib/onboarding/sequifi-fields";
import type { OnboardingJob } from "@/lib/onboarding/types";

const SENT_FLAG = "sent";
const FORM_URL = "https://app.smartsheet.com/b/form/60e97ea684894846927bfc564a5a2d9e";
const SUBMIT_BASE = "https://forms.smartsheet.com";
const DEFAULT_PUBLISH_KEY = "60e97ea684894846927bfc564a5a2d9e";
const SOP_SALES_ORG = "NOX Power";

/** Field keys from the live Smartsheet formDefinition. */
const FIELD = {
  salesOrganization: "Qvjp0mW",
  firstName: "G1qOPYQ",
  lastName: "8a3XzMb",
  phone: "l7Eekq9",
  email: "bXQrd3d",
  sellInCalifornia: "dZ0JJPw",
  caHisNumber: "DweMv7o",
  caHisExpDate: "5glzDNa",
  sellInConnecticut: "nXwglbY0w",
  ctHisNumber: "kXkvQ1Wq8",
  ctHisExpDate: "YadKL5Nqv",
  primarySellingState: "anrdPpe",
  dob: "jMyn5Q0",
  submissionStatus: "Onz66gk",
  title: "PWzpLD5",
} as const;

/** Primary Selling State picklist on the live form. */
const PRIMARY_STATES = ["CA", "CT", "IL", "MA", "NH", "NJ", "PR", "RI", "UT"] as const;
type PrimaryState = (typeof PRIMARY_STATES)[number];

const STATE_NAME_TO_CODE: Record<string, PrimaryState> = {
  california: "CA",
  ca: "CA",
  connecticut: "CT",
  ct: "CT",
  illinois: "IL",
  il: "IL",
  massachusetts: "MA",
  ma: "MA",
  "new hampshire": "NH",
  nh: "NH",
  "new jersey": "NJ",
  nj: "NJ",
  "puerto rico": "PR",
  pr: "PR",
  "rhode island": "RI",
  ri: "RI",
  utah: "UT",
  ut: "UT",
};

function trim(s: string | null | undefined): string {
  return (s ?? "").trim();
}

export function isBpsFormConfigured(): boolean {
  return Boolean(env.bpsFormEnabled && (env.bpsFormPublishKey?.trim() || DEFAULT_PUBLISH_KEY));
}

/** Match "BPS" / "Bright Planet Solar" in Other Installers? or installerTabs. */
export function jobHasBpsInstallerTab(job: OnboardingJob): boolean {
  const tabs = parseSequifiFields(job.raw_sequifi_payload ?? {}).installerTabs;
  if (tabs.some(isBpsTabName)) return true;

  // Also check the raw Other Installers? string directly in case the free-text
  // was split oddly (e.g. punctuation) before landing in installerTabs.
  const other = getSequifiFieldValue(job.raw_sequifi_payload ?? {}, "Other Installers?");
  return isBpsTabName(other);
}

export function isBpsTabName(name: string | null | undefined): boolean {
  const n = trim(name).toLowerCase();
  if (!n) return false;
  if (/\bbps\b/.test(n)) return true;
  if (n.includes("bright planet")) return true;
  return false;
}

export function bpsFormAlreadySent(job: OnboardingJob): boolean {
  return job.step_errors.bps_form === SENT_FLAG;
}

function workEmailForJob(job: OnboardingJob): string {
  const upn = trim(job.microsoft_upn);
  if (upn) return upn;
  const domain = env.msDefaultDomain?.trim() || "noxpwr.com";
  return buildWorkUpn(job.first_name ?? "", job.last_name ?? "", domain);
}

function resolveDobIso(job: Pick<OnboardingJob, "raw_sequifi_payload">): string {
  return getSequifiDobIso(job.raw_sequifi_payload ?? {});
}

/** Parse Sequifi markets/state_code into codes that appear in the form picklist. */
export function resolveBpsMarketStates(job: Pick<OnboardingJob, "raw_sequifi_payload">): PrimaryState[] {
  const markets = parseSequifiFields(job.raw_sequifi_payload ?? {}).markets;
  const out = new Set<PrimaryState>();
  for (const part of markets.split(/[,/;]+/)) {
    const token = part.trim().toLowerCase();
    if (!token) continue;
    const code = STATE_NAME_TO_CODE[token];
    if (code) out.add(code);
  }
  return [...out];
}

/**
 * Pick one Primary Selling State. Prefer the first Sequifi market that matches
 * the form's picklist; fall back to empty (caller fails cleanly).
 */
export function resolveBpsPrimaryState(states: PrimaryState[]): PrimaryState | "" {
  return states[0] ?? "";
}

export interface BpsFormFields {
  salesOrganization: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  sellInCalifornia: "Yes" | "No";
  sellInConnecticut: "Yes" | "No";
  primarySellingState: PrimaryState | "";
  dob: string;
  caHisNumber: string;
  caHisExpDate: string;
  ctHisNumber: string;
  ctHisExpDate: string;
}

export function buildBpsFormFields(job: OnboardingJob): BpsFormFields {
  const parsed = parseSequifiFields(job.raw_sequifi_payload ?? {});
  const states = resolveBpsMarketStates(job);
  return {
    salesOrganization: env.bpsSalesOrganization?.trim() || SOP_SALES_ORG,
    firstName: trim(job.first_name),
    lastName: trim(job.last_name),
    phone: trim(job.phone),
    email: workEmailForJob(job),
    sellInCalifornia: states.includes("CA") ? "Yes" : "No",
    sellInConnecticut: states.includes("CT") ? "Yes" : "No",
    primarySellingState: resolveBpsPrimaryState(states),
    dob: resolveDobIso(job),
    caHisNumber: parsed.caHis.replace(/\D/g, ""),
    caHisExpDate: parsed.hisExpDate,
    // No Sequifi source for CT HIS today — left blank; submit fails cleanly if CT=Yes.
    ctHisNumber: "",
    ctHisExpDate: "",
  };
}

/** Normalize HIS exp dates to YYYY-MM-DD when possible (Smartsheet Date fields). */
function toIsoDate(raw: string): string {
  const s = trim(raw);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const mdy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (mdy) {
    const [, m, d, y] = mdy;
    return `${y}-${m!.padStart(2, "0")}-${d!.padStart(2, "0")}`;
  }
  return s;
}

export function buildBpsSubmitData(fields: BpsFormFields): Record<string, { type: string; value: unknown }> {
  const data: Record<string, { type: string; value: unknown }> = {
    [FIELD.salesOrganization]: { type: "STRING", value: fields.salesOrganization },
    [FIELD.firstName]: { type: "STRING", value: fields.firstName },
    [FIELD.lastName]: { type: "STRING", value: fields.lastName },
    [FIELD.phone]: { type: "STRING", value: fields.phone },
    [FIELD.email]: {
      type: "CONTACT",
      value: { email: fields.email, name: `${fields.firstName} ${fields.lastName}`.trim() },
    },
    [FIELD.sellInCalifornia]: { type: "STRING", value: fields.sellInCalifornia },
    [FIELD.sellInConnecticut]: { type: "STRING", value: fields.sellInConnecticut },
    [FIELD.primarySellingState]: { type: "STRING", value: fields.primarySellingState },
    [FIELD.dob]: { type: "STRING", value: fields.dob },
    // Hidden defaults on the live form.
    [FIELD.title]: { type: "STRING", value: "Sales Rep" },
    [FIELD.submissionStatus]: { type: "STRING", value: "Needed" },
  };

  if (fields.sellInCalifornia === "Yes") {
    data[FIELD.caHisNumber] = { type: "STRING", value: fields.caHisNumber };
    data[FIELD.caHisExpDate] = { type: "STRING", value: toIsoDate(fields.caHisExpDate) };
  }
  if (fields.sellInConnecticut === "Yes") {
    data[FIELD.ctHisNumber] = { type: "STRING", value: fields.ctHisNumber };
    if (fields.ctHisExpDate) {
      data[FIELD.ctHisExpDate] = { type: "STRING", value: toIsoDate(fields.ctHisExpDate) };
    }
  }

  return data;
}

async function fetchFormSession(formUrl: string): Promise<{
  token: string;
  version: string;
  publishKey: string;
}> {
  const res = await fetch(formUrl, {
    headers: { "user-agent": "Mozilla/5.0", accept: "text/html" },
  });
  const html = await res.text();
  if (!res.ok) throw new Error(`Smartsheet form page ${res.status}: ${html.slice(0, 200)}`);
  const token = html.match(/window\.formToken\s*=\s*"([^"]+)"/)?.[1];
  const version = html.match(/window\.formAppVersion\s*=\s*"([^"]+)"/)?.[1];
  const publishKey =
    html.match(/window\.publishKey\s*=\s*"([^"]+)"/)?.[1] ||
    env.bpsFormPublishKey?.trim() ||
    DEFAULT_PUBLISH_KEY;
  if (!token || !version) {
    throw new Error("Smartsheet form page missing formToken/formAppVersion");
  }
  return { token, version, publishKey };
}

/**
 * Submit rep details to the BPS Financier Portal Login Request form when
 * Sequifi Other Installers? indicates BPS / Bright Planet Solar.
 */
export async function submitBpsForm(
  job: OnboardingJob,
  options?: { ignoreDryRun?: boolean },
): Promise<"sent" | "skipped" | "failed"> {
  if (!options?.ignoreDryRun && env.onboardingDryRun) return "skipped";
  if (job.status !== "completed") return "skipped";
  if (!jobHasBpsInstallerTab(job)) return "skipped";
  if (!isBpsFormConfigured()) return "skipped";
  if (bpsFormAlreadySent(job)) return "skipped";

  const fields = buildBpsFormFields(job);
  const missing = [
    !fields.salesOrganization && "sales organization",
    !fields.firstName && "first name",
    !fields.lastName && "last name",
    !fields.phone && "phone",
    !fields.email && "email",
    !fields.dob && "date of birth",
    !fields.primarySellingState &&
      "primary selling state (none of Sequifi's markets match BPS picklist: CA, CT, IL, MA, NH, NJ, PR, RI, UT)",
  ].filter(Boolean);

  if (fields.sellInCalifornia === "Yes") {
    if (!fields.caHisNumber) missing.push("CA HIS license number (required when selling in California)");
    if (!fields.caHisExpDate) missing.push("CA HIS expiration date (required when selling in California)");
  }
  if (fields.sellInConnecticut === "Yes") {
    if (!fields.ctHisNumber) {
      missing.push(
        "CT HIS license number (required when selling in Connecticut — no source in Sequifi today)",
      );
    }
  }

  if (missing.length) {
    await updateJobStep(job.id, {
      step_errors: { ...job.step_errors, bps_form: `Missing required field(s): ${missing.join(", ")}` },
    });
    return "failed";
  }

  try {
    const session = await fetchFormSession(FORM_URL);
    const payload = buildBpsSubmitData(fields);
    const body = new FormData();
    body.append("data", new Blob([JSON.stringify(payload)], { type: "application/json" }));

    const res = await fetch(`${SUBMIT_BASE}/api/submit/${session.publishKey}`, {
      method: "POST",
      headers: {
        "x-smar-submission-token": session.token,
        "x-smar-forms-version": session.version,
        "x-smar-is-user": "false",
        origin: "https://app.smartsheet.com",
        referer: FORM_URL,
      },
      body,
    });
    const text = await res.text();
    if (!res.ok) {
      await updateJobStep(job.id, {
        step_errors: {
          ...job.step_errors,
          bps_form: `Smartsheet submit ${res.status}: ${text.slice(0, 500)}`,
        },
      });
      return "failed";
    }

    let submissionId = "";
    try {
      const parsed = JSON.parse(text) as { submissionId?: string };
      submissionId = parsed.submissionId ?? "";
    } catch {
      /* ignore — success is HTTP 200 with thank-you body */
    }

    await updateJobStep(job.id, {
      step_errors: {
        ...job.step_errors,
        bps_form: SENT_FLAG,
        ...(submissionId ? { bps_form_submission_id: submissionId } : {}),
      },
    });
    return "sent";
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await updateJobStep(job.id, {
      step_errors: { ...job.step_errors, bps_form: msg },
    });
    return "failed";
  }
}
