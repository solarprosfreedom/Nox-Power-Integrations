/**
 * GoodPWR partner onboarding — Step 4 of the SOP: text the rep once they're
 * onboarded, pointing them to the GoodPWR link tree.
 */
import { env } from "@/lib/env";
import { updateJobStep } from "@/lib/onboarding/repository";
import { jobHasGoodPwrInstallerTab } from "@/lib/onboarding/goodpwr-form";
import { sendSms } from "@/lib/onboarding/sms";
import type { OnboardingJob } from "@/lib/onboarding/types";

const SENT_FLAG = "sent";

export function isGoodPwrTextConfigured(): boolean {
  return env.goodPwrSmsEnabled;
}

export function goodPwrTextAlreadySent(job: OnboardingJob): boolean {
  return job.step_errors.goodpwr_text === SENT_FLAG;
}

/** Exact wording from the SOP, with the GoodPWR Links URL filled in. */
export function buildGoodPwrTextMessage(): string {
  const linksUrl = env.goodPwrLinksUrl?.trim() || "https://sites.google.com/goodpwr.com/goodpwr/sales-partners";
  return (
    `Hello! You have been onboarded for GoodPWR. You should receive your invite ` +
    `emails soon for the different platforms and financiers. You can access their ` +
    `link tree using this link:\n\n${linksUrl}\n\n` +
    `Please feel free to reach out to me or your manager if you have any further questions.\n\n` +
    `Thanks!`
  );
}

/** Text the rep when the Sequifi "Onboard to Good Pwr?" tab is set (non-blocking). */
export async function sendGoodPwrText(
  job: OnboardingJob,
  options?: { ignoreDryRun?: boolean },
): Promise<"sent" | "skipped" | "failed"> {
  if (!options?.ignoreDryRun && env.onboardingDryRun) return "skipped";
  if (job.status !== "completed") return "skipped";
  if (!jobHasGoodPwrInstallerTab(job)) return "skipped";
  if (!isGoodPwrTextConfigured()) return "skipped";
  if (goodPwrTextAlreadySent(job)) return "skipped";

  const phone = (job.phone ?? "").trim();
  if (!phone) {
    await updateJobStep(job.id, {
      step_errors: { ...job.step_errors, goodpwr_text: "Missing phone number" },
    });
    return "failed";
  }

  const result = await sendSms(phone, buildGoodPwrTextMessage());
  await updateJobStep(job.id, {
    step_errors: {
      ...job.step_errors,
      goodpwr_text: result.status === "sent" ? SENT_FLAG : (result.reason ?? "failed"),
    },
  });
  return result.status;
}
