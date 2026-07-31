import { getSequifiFieldValue, parseSequifiFields } from "@/lib/onboarding/sequifi-fields";
import type { OnboardingJob } from "@/lib/onboarding/types";

export type PartnerStepUiStatus = "completed" | "failed" | "pending";

export interface PartnerStepStatusRow {
  key: string;
  label: string;
  status: PartnerStepUiStatus;
  /** Raw step_errors value when present. */
  detail: string | null;
  /** Cleared and re-run by "Retry sheets/forms". */
  willRetry: boolean;
}

type PartnerStepDef = {
  key: string;
  label: string;
  eligible: (job: OnboardingJob) => boolean;
};

function tabsOf(job: OnboardingJob): string[] {
  return parseSequifiFields(job.raw_sequifi_payload ?? {}).installerTabs;
}

function otherInstallers(job: OnboardingJob): string {
  return getSequifiFieldValue(job.raw_sequifi_payload ?? {}, "Other Installers?") ?? "";
}

function tabMatches(job: OnboardingJob, pred: (tab: string) => boolean): boolean {
  if (tabsOf(job).some(pred)) return true;
  const other = otherInstallers(job);
  if (!other) return false;
  if (pred(other)) return true;
  return other.split(/[,;/]+/).some(part => pred(part.trim()));
}

const PARTNER_STEP_DEFS: PartnerStepDef[] = [
  {
    key: "google_sheets",
    label: "Installer roster sheet(s)",
    eligible: job => tabsOf(job).length > 0,
  },
  {
    key: "empwr_hubspot",
    label: "EMPWR HubSpot",
    eligible: job => tabsOf(job).some(t => t.trim().toLowerCase() === "empwr"),
  },
  {
    key: "empower_typeform",
    label: "Empower Typeform",
    eligible: job => tabMatches(job, t => /\bempower\b/i.test(t.trim())),
  },
  {
    key: "empower_text",
    label: "Empower SMS",
    eligible: job => tabMatches(job, t => /\bempower\b/i.test(t.trim())),
  },
  {
    key: "tron_jotform",
    label: "Tron Jotform",
    eligible: job => tabsOf(job).some(t => t.trim().toLowerCase() === "tron"),
  },
  {
    key: "goodpwr_form",
    label: "GoodPWR form",
    eligible: job => tabsOf(job).some(t => t.trim().toLowerCase() === "goodpwr"),
  },
  {
    key: "goodpwr_text",
    label: "GoodPWR SMS",
    eligible: job => tabsOf(job).some(t => t.trim().toLowerCase() === "goodpwr"),
  },
  {
    key: "better_earth_form",
    label: "Better Earth form",
    eligible: job => tabsOf(job).some(t => t.trim().toLowerCase() === "better earth"),
  },
  {
    key: "bps_form",
    label: "BPS form",
    eligible: job =>
      tabMatches(job, t => {
        const n = t.trim().toLowerCase();
        return /\bbps\b/.test(n) || n.includes("bright planet");
      }),
  },
  {
    key: "green_brilliance_roster",
    label: "Green Brilliance roster",
    eligible: job =>
      tabMatches(job, t => {
        const n = t.trim().toLowerCase();
        return n.includes("green brilliance") || /\bgb\b/.test(n);
      }),
  },
  {
    key: "icon_power_form",
    label: "Icon Power form",
    eligible: job =>
      tabMatches(job, t => {
        const n = t.trim().toLowerCase();
        return n.includes("icon power") || /\bicon\b/.test(n);
      }),
  },
  {
    key: "solq_form",
    label: "SolQ form",
    eligible: job => tabMatches(job, t => /^solq$/i.test(t.trim())),
  },
  {
    key: "solq_text",
    label: "SolQ SMS",
    eligible: job => tabMatches(job, t => /^solq$/i.test(t.trim())),
  },
];

/** True when a partner step should not be cleared/retried. */
export function isPartnerStepSuccess(value: string | undefined): boolean {
  if (!value) return false;
  return value === "sent" || value.startsWith("appended:") || value === "already in sheet";
}

function classifyPartnerStep(value: string | undefined): {
  status: PartnerStepUiStatus;
  detail: string | null;
} {
  if (!value) return { status: "pending", detail: null };
  if (isPartnerStepSuccess(value)) {
    return {
      status: "completed",
      detail: value === "sent" ? null : value,
    };
  }
  return { status: "failed", detail: value };
}

/** Eligible partner sheets/forms for this job, with completed / failed / pending. */
export function getEligiblePartnerSteps(job: OnboardingJob): PartnerStepStatusRow[] {
  const rows: PartnerStepStatusRow[] = [];
  for (const def of PARTNER_STEP_DEFS) {
    if (!def.eligible(job)) continue;
    const raw = job.step_errors?.[def.key];
    const { status, detail } = classifyPartnerStep(raw);
    rows.push({
      key: def.key,
      label: def.label,
      status,
      detail,
      willRetry: status !== "completed",
    });
  }
  return rows;
}
