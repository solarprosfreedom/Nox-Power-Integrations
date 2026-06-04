import { repDisplayName } from "@/lib/onboarding/admin-notify-templates";
import { enerfloEmailForInstaller } from "@/lib/onboarding/installer-registry";
import { resolveRoleMapping } from "@/lib/onboarding/role-map";
import type { OnboardingJob } from "@/lib/onboarding/types";

const DEALER_NAME = "Nox Power";

function managerYes(roleLabel: string | null | undefined): string {
  const { enerfloRoles } = resolveRoleMapping(roleLabel);
  return enerfloRoles.includes("Manager") ? "YES" : "";
}

export function renderAxiaOnboardingNotification(
  job: Pick<OnboardingJob, "first_name" | "last_name" | "phone" | "role_label">,
): { subject: string; body: string } {
  const firstName = job.first_name?.trim() || "—";
  const lastName = job.last_name?.trim() || "—";
  const repName = repDisplayName(job);
  const mobile = job.phone?.trim() || "—";
  const email = enerfloEmailForInstaller(job.first_name ?? "", job.last_name ?? "", "Axia");

  return {
    subject: `Nox Power — Axia rep onboarded: ${repName}`,
    body: `Dealer Name: ${DEALER_NAME}
First Name: ${firstName}
Last Name: ${lastName}
Mobile Number: ${mobile}
Email: ${email}
Manager (Input YES): ${managerYes(job.role_label)}
`,
  };
}
