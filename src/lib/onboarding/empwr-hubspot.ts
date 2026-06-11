import { env } from "@/lib/env";
import { buildWorkUpn } from "@/lib/onboarding/normalize";
import { updateJobStep } from "@/lib/onboarding/repository";
import {
  enerfloRolesIncludeManager,
  resolveRoleMappingFromSequifi,
  sequifiPositionContextFromJob,
} from "@/lib/onboarding/role-map";
import { parseSequifiFields } from "@/lib/onboarding/sequifi-fields";
import type { OnboardingJob } from "@/lib/onboarding/types";

const SENT_FLAG = "sent";
const CONTACT_OBJECT_TYPE = "0-1";

/** HubSpot Job Title dropdown values on the EMPWR partner form. */
export type EmpwrHubSpotRole =
  | "Setter"
  | "Sales Rep"
  | "District Manager"
  | "Admin"
  | "Owner";

export interface HubSpotFormField {
  objectTypeId: string;
  name: string;
  value: string;
}

export interface EmpwrHubSpotPayload {
  fields: HubSpotFormField[];
  context: {
    pageUri: string;
    pageName: string;
  };
}

function trim(s: string | null | undefined): string {
  return (s ?? "").trim();
}

export function isEmpwrHubSpotConfigured(): boolean {
  return Boolean(
    env.hubspotEmpwrEnabled &&
      env.hubspotEmpwrPortalId?.trim() &&
      env.hubspotEmpwrFormGuid?.trim() &&
      env.hubspotEmpwrApiBase?.trim(),
  );
}

export function jobHasEmpwrInstallerTab(job: OnboardingJob): boolean {
  return parseSequifiFields(job.raw_sequifi_payload ?? {}).installerTabs.some(
    tab => tab.trim().toLowerCase() === "empwr",
  );
}

export function empwrHubSpotAlreadySent(job: OnboardingJob): boolean {
  return job.step_errors.empwr_hubspot === SENT_FLAG;
}

/** Map Sequifi / Enerflo role context to the EMPWR HubSpot Job Title dropdown. */
export function mapEmpwrHubSpotRole(job: OnboardingJob): EmpwrHubSpotRole {
  const ctx = sequifiPositionContextFromJob(job);
  const { enerfloRoles } = resolveRoleMappingFromSequifi(ctx);
  const position = `${ctx.positionName} ${ctx.subPositionName}`.toLowerCase();

  if (enerfloRolesIncludeManager(enerfloRoles) || /\bmanager\b/.test(position)) {
    return "District Manager";
  }
  if (/\bsetter\b/.test(position) || enerfloRoles.some(r => /setter/i.test(r))) {
    return "Setter";
  }
  if (/\badmin\b/.test(position)) {
    return "Admin";
  }
  if (/\bowner\b/.test(position)) {
    return "Owner";
  }
  return "Sales Rep";
}

function workEmailForJob(job: OnboardingJob): string {
  const upn = trim(job.microsoft_upn);
  if (upn) return upn;
  const domain = env.msDefaultDomain?.trim() || "noxpwr.com";
  return buildWorkUpn(job.first_name ?? "", job.last_name ?? "", domain);
}

function field(name: string, value: string): HubSpotFormField {
  return { objectTypeId: CONTACT_OBJECT_TYPE, name, value };
}

export function buildEmpwrHubSpotPayload(job: OnboardingJob): EmpwrHubSpotPayload {
  const company = env.hubspotEmpwrCompany?.trim() || "Nox Power";
  const fields: HubSpotFormField[] = [
    field("firstname", trim(job.first_name)),
    field("lastname", trim(job.last_name)),
    field("email", workEmailForJob(job)),
    field("phone", trim(job.phone)),
    field("role", mapEmpwrHubSpotRole(job)),
    field("company", company),
  ];

  return {
    fields,
    context: {
      pageUri: "https://integration-middleware/onboarding/empwr",
      pageName: "Nox Power EMPWR Onboarding Automation",
    },
  };
}

export function validateEmpwrHubSpotPayload(payload: EmpwrHubSpotPayload): string | null {
  const required = ["firstname", "lastname", "email", "phone", "role"] as const;
  for (const name of required) {
    const entry = payload.fields.find(f => f.name === name);
    if (!entry?.value) return `Missing required field: ${name}`;
  }
  return null;
}

function submitUrl(): string {
  const base = (env.hubspotEmpwrApiBase ?? "").replace(/\/$/, "");
  const portalId = env.hubspotEmpwrPortalId?.trim() ?? "";
  const formGuid = env.hubspotEmpwrFormGuid?.trim() ?? "";
  return `${base}/submissions/v3/integration/submit/${portalId}/${formGuid}`;
}

/** POST rep details to EMPWR HubSpot form when Sequifi EMPWR tab is set (non-blocking). */
export async function submitEmpwrHubSpotForm(
  job: OnboardingJob,
  options?: { ignoreDryRun?: boolean },
): Promise<"sent" | "skipped" | "failed"> {
  if (!options?.ignoreDryRun && env.onboardingDryRun) return "skipped";
  if (job.status !== "completed") return "skipped";
  if (!jobHasEmpwrInstallerTab(job)) return "skipped";
  if (!isEmpwrHubSpotConfigured()) return "skipped";
  if (empwrHubSpotAlreadySent(job)) return "skipped";

  const payload = buildEmpwrHubSpotPayload(job);
  const validationError = validateEmpwrHubSpotPayload(payload);
  if (validationError) {
    await updateJobStep(job.id, {
      step_errors: { ...job.step_errors, empwr_hubspot: validationError },
    });
    return "failed";
  }

  try {
    const res = await fetch(submitUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    if (!res.ok) {
      const msg = `HubSpot ${res.status}: ${text.slice(0, 500)}`;
      await updateJobStep(job.id, {
        step_errors: { ...job.step_errors, empwr_hubspot: msg },
      });
      return "failed";
    }

    await updateJobStep(job.id, {
      step_errors: { ...job.step_errors, empwr_hubspot: SENT_FLAG },
    });
    return "sent";
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await updateJobStep(job.id, {
      step_errors: { ...job.step_errors, empwr_hubspot: msg },
    });
    return "failed";
  }
}
