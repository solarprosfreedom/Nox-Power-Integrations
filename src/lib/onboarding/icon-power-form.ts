/**
 * Icon Power partner onboarding — "Sales Rep Onboarding - Freedom Pros"
 * Smartsheet form submit.
 *
 * Form: https://app.smartsheet.com/b/form/019adb83223c7b2180542e382343d5f1
 *
 * Same Smartsheet public submit API as BPS (GET form HTML → formToken →
 * POST /api/submit/{publishKey}). CAPTCHA not required for main submit.
 *
 * Trigger: Sequifi "Other Installers?" contains "Icon Power" or whole-word "Icon".
 */
import { env } from "@/lib/env";
import { buildWorkUpn } from "@/lib/onboarding/normalize";
import { updateJobStep } from "@/lib/onboarding/repository";
import { resolveSalesManagerName } from "@/lib/onboarding/tron-jotform";
import { getSequifiFieldValue, parseSequifiFields } from "@/lib/onboarding/sequifi-fields";
import type { OnboardingJob } from "@/lib/onboarding/types";

const SENT_FLAG = "sent";
const FORM_URL = "https://app.smartsheet.com/b/form/019adb83223c7b2180542e382343d5f1";
const SUBMIT_BASE = "https://forms.smartsheet.com";
const DEFAULT_PUBLISH_KEY = "019adb83223c7b2180542e382343d5f1";
const NA = "N/A";

/** Field keys from the live Smartsheet formDefinition. */
const FIELD = {
  employeeName: "Ya3M6Yq3D",
  jobTitle: "wNK1350nb",
  manager: "zA0QopXnq",
  payRate: "2waJbzkL3",
  startDate: "Z5aE3wRDP",
  phone: "J9Qgy3nXm",
  email: "1z36lw19J",
} as const;

function trim(s: string | null | undefined): string {
  return (s ?? "").trim();
}

function orNa(value: string | null | undefined): string {
  const v = trim(value);
  return v || NA;
}

export function isIconPowerFormConfigured(): boolean {
  return Boolean(env.iconPowerFormEnabled && (env.iconPowerFormPublishKey?.trim() || DEFAULT_PUBLISH_KEY));
}

export function isIconPowerTabName(name: string | null | undefined): boolean {
  const n = trim(name).toLowerCase();
  if (!n) return false;
  if (n.includes("icon power")) return true;
  return /\bicon\b/.test(n);
}

export function jobHasIconPowerInstallerTab(job: OnboardingJob): boolean {
  const tabs = parseSequifiFields(job.raw_sequifi_payload ?? {}).installerTabs;
  if (tabs.some(isIconPowerTabName)) return true;
  const other = getSequifiFieldValue(job.raw_sequifi_payload ?? {}, "Other Installers?");
  return isIconPowerTabName(other);
}

export function iconPowerFormAlreadySent(job: OnboardingJob): boolean {
  return job.step_errors.icon_power_form === SENT_FLAG;
}

function workEmailForJob(job: OnboardingJob): string {
  const upn = trim(job.microsoft_upn);
  if (upn) return upn;
  const domain = env.msDefaultDomain?.trim() || "noxpwr.com";
  return buildWorkUpn(job.first_name ?? "", job.last_name ?? "", domain);
}

function resolveJobTitle(job: OnboardingJob): string {
  const raw = job.raw_sequifi_payload ?? {};
  return (
    getSequifiFieldValue(raw, "Job Title") ||
    trim(String(raw.sub_position_name ?? "")) ||
    trim(job.role_label) ||
    trim(String(raw.position_name ?? ""))
  );
}

function resolvePayRate(job: OnboardingJob): string {
  const raw = job.raw_sequifi_payload ?? {};
  return (
    getSequifiFieldValue(raw, "Pay Rate") ||
    getSequifiFieldValue(raw, "Hourly Rate") ||
    getSequifiFieldValue(raw, "Wage") ||
    ""
  );
}

/** Prefer Sequifi start/hire/created date; fall back to today (YYYY-MM-DD). */
export function resolveIconPowerStartDate(
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
  const t = Date.parse(s);
  if (!Number.isNaN(t)) return new Date(t).toISOString().slice(0, 10);
  return "";
}

export interface IconPowerFormFields {
  employeeName: string;
  jobTitle: string;
  manager: string;
  payRate: string;
  startDate: string;
  phone: string;
  email: string;
}

export function buildIconPowerFormFields(job: OnboardingJob, now: Date = new Date()): IconPowerFormFields {
  const first = trim(job.first_name);
  const last = trim(job.last_name);
  return {
    employeeName: orNa([first, last].filter(Boolean).join(" ")),
    jobTitle: orNa(resolveJobTitle(job)),
    manager: orNa(resolveSalesManagerName(job)),
    payRate: orNa(resolvePayRate(job)),
    startDate: resolveIconPowerStartDate(job, now),
    phone: orNa(job.phone),
    email: orNa(workEmailForJob(job)),
  };
}

export function buildIconPowerSubmitData(
  fields: IconPowerFormFields,
): Record<string, { type: string; value: unknown }> {
  return {
    [FIELD.employeeName]: { type: "STRING", value: fields.employeeName },
    [FIELD.jobTitle]: { type: "STRING", value: fields.jobTitle },
    [FIELD.manager]: { type: "STRING", value: fields.manager },
    [FIELD.payRate]: { type: "STRING", value: fields.payRate },
    [FIELD.startDate]: { type: "STRING", value: fields.startDate },
    [FIELD.phone]: { type: "STRING", value: fields.phone },
    [FIELD.email]: { type: "STRING", value: fields.email },
  };
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
    env.iconPowerFormPublishKey?.trim() ||
    DEFAULT_PUBLISH_KEY;
  if (!token || !version) {
    throw new Error("Smartsheet form page missing formToken/formAppVersion");
  }
  return { token, version, publishKey };
}

export async function submitIconPowerForm(
  job: OnboardingJob,
  options?: { ignoreDryRun?: boolean },
): Promise<"sent" | "skipped" | "failed"> {
  if (!options?.ignoreDryRun && env.onboardingDryRun) return "skipped";
  if (job.status !== "completed") return "skipped";
  if (!jobHasIconPowerInstallerTab(job)) return "skipped";
  if (!isIconPowerFormConfigured()) return "skipped";
  if (iconPowerFormAlreadySent(job)) return "skipped";

  const fields = buildIconPowerFormFields(job);
  // Email/name must be real enough to onboard — N/A for those is a hard fail.
  if (!fields.email || fields.email === NA || !fields.employeeName || fields.employeeName === NA) {
    await updateJobStep(job.id, {
      step_errors: {
        ...job.step_errors,
        icon_power_form: "Missing required field(s): employee name or email",
      },
    });
    return "failed";
  }

  try {
    const session = await fetchFormSession(FORM_URL);
    const payload = buildIconPowerSubmitData(fields);
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
          icon_power_form: `Smartsheet submit ${res.status}: ${text.slice(0, 500)}`,
        },
      });
      return "failed";
    }

    let submissionId = "";
    try {
      const parsed = JSON.parse(text) as { submissionId?: string };
      submissionId = parsed.submissionId ?? "";
    } catch {
      /* ignore */
    }

    await updateJobStep(job.id, {
      step_errors: {
        ...job.step_errors,
        icon_power_form: SENT_FLAG,
        ...(submissionId ? { icon_power_form_submission_id: submissionId } : {}),
      },
    });
    return "sent";
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await updateJobStep(job.id, {
      step_errors: { ...job.step_errors, icon_power_form: msg },
    });
    return "failed";
  }
}
