/**
 * Empower partner onboarding — Step 6 of the SOP: text the rep the Jobflo
 * crash-course video after onboarding (setters and closers).
 */
import { env } from "@/lib/env";
import { jobHasEmpowerInstallerTab } from "@/lib/onboarding/empower-typeform";
import { updateJobStep } from "@/lib/onboarding/repository";
import { sendSms } from "@/lib/onboarding/sms";
import type { OnboardingJob } from "@/lib/onboarding/types";

const SENT_FLAG = "sent";
const DEFAULT_JOBFLO_VIDEO_URL =
  "https://www.loom.com/share/8e99f6aa14ae47e8ac30f32ff42801ba";

export function isEmpowerTextConfigured(): boolean {
  return env.empowerSmsEnabled;
}

export function empowerTextAlreadySent(job: OnboardingJob): boolean {
  return job.step_errors.empower_text === SENT_FLAG;
}

/** Exact wording from the Empower SOP, with the Jobflo video URL filled in. */
export function buildEmpowerTextMessage(): string {
  const videoUrl = env.empowerJobfloVideoUrl?.trim() || DEFAULT_JOBFLO_VIDEO_URL;
  return (
    `Hello! You have been onboarded for Empower. You should receive your invite ` +
    `emails soon for the different platforms and financiers. You can start with ` +
    `watching this Video\n\n` +
    `10 Min Crash Course on Jobflo\n${videoUrl}\n\n` +
    `Please feel free to reach out to me or your manager if you have any further questions.\n\n` +
    `Thanks!`
  );
}

/** Text the Empower rep when Other Installers / Empower tab is set (non-blocking). */
export async function sendEmpowerText(
  job: OnboardingJob,
  options?: { ignoreDryRun?: boolean },
): Promise<"sent" | "skipped" | "failed"> {
  if (!options?.ignoreDryRun && env.onboardingDryRun) return "skipped";
  if (job.status !== "completed") return "skipped";
  if (!jobHasEmpowerInstallerTab(job)) return "skipped";
  if (!isEmpowerTextConfigured()) return "skipped";
  if (empowerTextAlreadySent(job)) return "skipped";

  const phone = (job.phone ?? "").trim();
  if (!phone) {
    await updateJobStep(job.id, {
      step_errors: { ...job.step_errors, empower_text: "Missing phone number" },
    });
    return "failed";
  }

  const result = await sendSms(phone, buildEmpowerTextMessage());
  await updateJobStep(job.id, {
    step_errors: {
      ...job.step_errors,
      empower_text: result.status === "sent" ? SENT_FLAG : (result.reason ?? "failed"),
    },
  });
  return result.status;
}
