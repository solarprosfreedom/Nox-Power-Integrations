import { env } from "@/lib/env";
import { renderAdminOnboardingNotification } from "@/lib/onboarding/admin-notify-templates";
import { updateJobStep } from "@/lib/onboarding/repository";
import type { OnboardingJob } from "@/lib/onboarding/types";
import { isGraphMailConfigured, sendMailAsUser } from "@/lib/microsoft/graph-mail";

const ADMIN_NOTIFY_TO = "admin@noxpwr.com";
const SENT_FLAG = "sent";

export function adminNotifyAlreadySent(job: OnboardingJob): boolean {
  return job.step_errors.admin_notify === SENT_FLAG;
}

/** Notify admin when onboarding job reaches completed (non-blocking). */
export async function sendOnboardingAdminNotification(
  job: OnboardingJob,
): Promise<"sent" | "skipped" | "failed"> {
  if (env.onboardingDryRun) return "skipped";
  if (job.status !== "completed") return "skipped";
  if (adminNotifyAlreadySent(job)) return "skipped";

  if (!isGraphMailConfigured()) return "skipped";

  const { subject, body } = renderAdminOnboardingNotification(job);

  try {
    await sendMailAsUser({ to: ADMIN_NOTIFY_TO, subject, body, contentType: "text" });
    await updateJobStep(job.id, {
      step_errors: { ...job.step_errors, admin_notify: SENT_FLAG },
    });
    return "sent";
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await updateJobStep(job.id, {
      step_errors: { ...job.step_errors, admin_notify: msg },
    });
    return "failed";
  }
}
