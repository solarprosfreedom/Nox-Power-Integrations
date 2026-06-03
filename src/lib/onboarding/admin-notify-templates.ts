import { parseSequifiFields } from "@/lib/onboarding/sequifi-fields";
import type { OnboardingJob } from "@/lib/onboarding/types";

export function repDisplayName(job: Pick<OnboardingJob, "first_name" | "last_name">): string {
  return [job.first_name, job.last_name].filter(Boolean).join(" ").trim() || "New rep";
}

export function renderAdminOnboardingNotification(
  job: Pick<
    OnboardingJob,
    "first_name" | "last_name" | "role_label" | "microsoft_upn" | "phone" | "raw_sequifi_payload"
  >,
): { subject: string; body: string } {
  const repName = repDisplayName(job);
  const repRole = job.role_label?.trim() || "Sales Rep";
  const repEmail = job.microsoft_upn?.trim() || "—";
  const repPhone = job.phone?.trim() || "—";
  const installerTabs = parseSequifiFields(job.raw_sequifi_payload ?? {}).installerTabs;
  const installersBlock =
    installerTabs.length ?
      `\n\nThey were onboarded to the following installer(s): ${installerTabs.join(", ")}.`
    : "";

  return {
    subject: `New Rep Onboarded: ${repName}`,
    body: `Please welcome ${repName}, who has completed onboarding and joined us as ${repRole}.${installersBlock}

Rep details:

Name: ${repName}

Email: ${repEmail}

Phone: ${repPhone}
`,
  };
}
