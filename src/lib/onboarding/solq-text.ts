/**
 * SolQ partner onboarding — Step 3 of the SOP: text the rep the SolQ link tree.
 */
import { env } from "@/lib/env";
import { jobHasSolqInstallerTab } from "@/lib/onboarding/solq-form";
import { updateJobStep } from "@/lib/onboarding/repository";
import { sendSms } from "@/lib/onboarding/sms";
import type { OnboardingJob } from "@/lib/onboarding/types";

const SENT_FLAG = "sent";
const DEFAULT_LINKS_URL = "https://solarquotespv.com/sq/tools/lt-freedompros.php";

export function isSolqTextConfigured(): boolean {
  return env.solqSmsEnabled;
}

export function solqTextAlreadySent(job: OnboardingJob): boolean {
  return job.step_errors.solq_text === SENT_FLAG;
}

/** Exact wording from the SolQ SOP, with the link-tree URL filled in. */
export function buildSolqTextMessage(): string {
  const linksUrl = env.solqLinksUrl?.trim() || DEFAULT_LINKS_URL;
  return (
    `Hello! You have been onboarded for SolQ. You should receive your invite ` +
    `emails soon for the different platforms and financiers. You can access their ` +
    `link tree using this link:\n${linksUrl}\n\n` +
    `Please feel free to reach out to me or your manager if you have any further questions.\n\n` +
    `Thanks!`
  );
}

/** Text the SolQ rep when Other Installers / SolQ tab is set (non-blocking). */
export async function sendSolqText(
  job: OnboardingJob,
  options?: { ignoreDryRun?: boolean },
): Promise<"sent" | "skipped" | "failed"> {
  if (!options?.ignoreDryRun && env.onboardingDryRun) return "skipped";
  if (job.status !== "completed") return "skipped";
  if (!jobHasSolqInstallerTab(job)) return "skipped";
  if (!isSolqTextConfigured()) return "skipped";
  if (solqTextAlreadySent(job)) return "skipped";

  const phone = (job.phone ?? "").trim();
  if (!phone) {
    await updateJobStep(job.id, {
      step_errors: { ...job.step_errors, solq_text: "Missing phone number" },
    });
    return "failed";
  }

  const result = await sendSms(phone, buildSolqTextMessage());
  await updateJobStep(job.id, {
    step_errors: {
      ...job.step_errors,
      solq_text: result.status === "sent" ? SENT_FLAG : (result.reason ?? "failed"),
    },
  });
  return result.status;
}
