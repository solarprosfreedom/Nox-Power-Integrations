import { repDisplayName } from "@/lib/onboarding/admin-notify-templates";
import { buildWorkUpn } from "@/lib/onboarding/normalize";
import {
  enerfloRolesIncludeManager,
  isApptSetterName,
  resolveRoleMappingFromSequifi,
  sequifiPositionContextFromJob,
} from "@/lib/onboarding/role-map";
import type { OnboardingJob } from "@/lib/onboarding/types";
import { parseSequifiCaTxMarkets, parseSequifiFields } from "@/lib/onboarding/sequifi-fields";
import { env } from "@/lib/env";

const DEALER_NAME = "Nox Power";

/** Insert `+alias` before @ on a work email; no-op if already present. */
export function withInstallerPlusAlias(email: string, alias: string): string {
  const trimmed = email.trim();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0) return trimmed;
  const local = trimmed.slice(0, at);
  const host = trimmed.slice(at + 1);
  const suffix = `+${alias.toLowerCase()}`;
  if (local.toLowerCase().endsWith(suffix)) return trimmed;
  return `${local}${suffix}@${host}`;
}

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
  const workEmail =
    job.microsoft_upn?.trim() ||
    buildWorkUpn(job.first_name ?? "", job.last_name ?? "", domain);
  // Axia SOP: report the +axia alias (e.g. jane.doe+axia@noxpwr.com).
  const email = withInstallerPlusAlias(workEmail, "axia");
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
  const hisLines = axiaHisLicenseLines(job);

  return {
    subject: `Nox Power — Axia rep onboarded: ${repName}`,
    body: `Dealer Name: ${DEALER_NAME}
First Name: ${firstName}
Last Name: ${lastName}
Mobile Number: ${mobile}
Email: ${email}
Position: ${position}
Team Name: ${teamName}
Manager: ${enerfloRolesIncludeManager(enerfloRoles) ? "Yes" : "No"}${hisLines}
`,
  };
}

/**
 * Include CA/TX HIS only for sales-rep-or-higher, when Sequifi markets include
 * that state, and they entered a license during onboarding. Omit otherwise.
 */
export function axiaHisLicenseLines(
  job: Pick<OnboardingJob, "raw_sequifi_payload" | "role_label">,
): string {
  const ctx = sequifiPositionContextFromJob(job);
  const displayedPosition = ctx.subPositionName || ctx.positionName;
  if (isApptSetterName(displayedPosition)) return "";
  if (resolveRoleMappingFromSequifi(ctx).welcomeTemplate !== "sales_rep") return "";

  const raw = job.raw_sequifi_payload ?? {};
  const parsed = parseSequifiFields(raw);
  const markets = parseSequifiCaTxMarkets(parsed.markets);
  const lines: string[] = [];
  if (markets.has("CA") && parsed.caHis) {
    lines.push(`CA HIS License Number:  ${parsed.caHis}`);
  }
  if (markets.has("TX") && parsed.txHis) {
    lines.push(`TX HIS License Number:  ${parsed.txHis}`);
  }
  return lines.length ? `\n${lines.join("\n")}` : "";
}
