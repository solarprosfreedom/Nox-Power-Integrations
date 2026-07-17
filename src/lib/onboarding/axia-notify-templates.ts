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
  const ctx = sequifiPositionContextFromJob(job);
  // Sequifi's own UI shows sub_position_name as the "Position" label (e.g. "Appt
  // Setter"), with position_name ("Closer") only surfacing as a separate "May act
  // as both Setter and Closer" flag — match that convention here.
  const position = ctx.subPositionName || ctx.positionName || "—";
  const { enerfloRoles } = resolveRoleMappingFromSequifi(ctx);
  const raw = job.raw_sequifi_payload ?? {};
  // Sequifi's GET /v1/users response has never included a team field for any rep
  // we've onboarded so far — this checks the plausible field names defensively so
  // it starts populating automatically if/when Sequifi starts returning one.
  const teamName =
    String(raw.team_name ?? raw.team ?? raw.department_name ?? raw.department ?? "").trim() || "—";

  return {
    subject: `Nox Power — Axia rep onboarded: ${repName}`,
    body: `Dealer Name: ${DEALER_NAME}
First Name: ${firstName}
Last Name: ${lastName}
Mobile Number: ${mobile}
Email: ${email}
Position: ${position}
Team Name: ${teamName}
Manager: ${enerfloRolesIncludeManager(enerfloRoles) ? "Yes" : "No"}
`,
  };
}
