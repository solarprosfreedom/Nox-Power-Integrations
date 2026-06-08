import { repDisplayName } from "@/lib/onboarding/admin-notify-templates";
import { buildWorkUpn } from "@/lib/onboarding/normalize";
import {
  enerfloRolesIncludeManager,
  resolveRoleMappingFromSequifi,
  sequifiPositionContextFromJob,
} from "@/lib/onboarding/role-map";
import type { OnboardingJob } from "@/lib/onboarding/types";
import { env } from "@/lib/env";

const DEALER_NAME = "Nox Power";

export function renderAxiaOnboardingNotification(
  job: Pick<
    OnboardingJob,
    "first_name" | "last_name" | "phone" | "role_label" | "raw_sequifi_payload" | "microsoft_upn"
  >,
): { subject: string; body: string } {
  const firstName = job.first_name?.trim() || "—";
  const lastName = job.last_name?.trim() || "—";
  const repName = repDisplayName(job);
  const mobile = job.phone?.trim() || "—";
  const domain = env.msDefaultDomain?.trim() || "noxpwr.com";
  const email =
    job.microsoft_upn?.trim() ||
    buildWorkUpn(job.first_name ?? "", job.last_name ?? "", domain);
  const { enerfloRoles } = resolveRoleMappingFromSequifi(sequifiPositionContextFromJob(job));

  return {
    subject: `Nox Power — Axia rep onboarded: ${repName}`,
    body: `Dealer Name: ${DEALER_NAME}
First Name: ${firstName}
Last Name: ${lastName}
Mobile Number: ${mobile}
Email: ${email}
Manager (Input YES): ${enerfloRolesIncludeManager(enerfloRoles) ? "YES" : ""}
`,
  };
}
