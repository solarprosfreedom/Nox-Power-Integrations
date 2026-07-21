import { parseSequifiFields } from "@/lib/onboarding/sequifi-fields";
import type { OnboardingJob } from "@/lib/onboarding/types";

export function repDisplayName(job: Pick<OnboardingJob, "first_name" | "last_name">): string {
  return [job.first_name, job.last_name].filter(Boolean).join(" ").trim() || "New rep";
}

export function renderAdminOnboardingNotification(
  job: Pick<
    OnboardingJob,
    "first_name" | "last_name" | "microsoft_upn" | "phone" | "raw_sequifi_payload"
  >,
): { subject: string; body: string } {
  const repName = repDisplayName(job);
  const repEmail = job.microsoft_upn?.trim() || "—";
  const repPhone = job.phone?.trim() || "—";
  const raw = job.raw_sequifi_payload ?? {};
  // Sequifi displays sub_position_name as the employee's Position (for example,
  // "Appt Setter"). position_name is a broader capability such as "Closer".
  const repRole =
    String(raw.sub_position_name ?? "").trim() ||
    String(raw.position_name ?? "").trim() ||
    "—";
  const installerTabs = parseSequifiFields(job.raw_sequifi_payload ?? {}).installerTabs;
  const installersBlock =
    installerTabs.length ?
      `\n\nThey were onboarded to the following installer(s): ${installerTabs.join(", ")}.`
    : "";

  return {
    subject: `Onboarding completed: ${repName}`,
    body: `${repName} has completed onboarding.${installersBlock}

Rep details:

Name: ${repName}

Email: ${repEmail}

Phone: ${repPhone}

Position: ${repRole}
`,
  };
}
