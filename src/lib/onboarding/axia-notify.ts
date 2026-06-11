import { env } from "@/lib/env";
import { renderAxiaOnboardingNotification } from "@/lib/onboarding/axia-notify-templates";
import { updateJobStep } from "@/lib/onboarding/repository";
import { parseSequifiFields } from "@/lib/onboarding/sequifi-fields";
import type { OnboardingJob } from "@/lib/onboarding/types";
import { isGraphMailConfigured, sendMailAsUser } from "@/lib/microsoft/graph-mail";

const AXIA_NOTIFY_TO = [
  "onboardingspecialist2@us.q-cells.com",
  "stan.fletcher@qcells.com",
  "carldeveloper01@gmail.com",
];
const SENT_FLAG = "sent";

export function axiaNotifyAlreadySent(job: OnboardingJob): boolean {
  return job.step_errors.axia_notify === SENT_FLAG;
}

/** Notify Q-Cells when an Axia rep completes onboarding (non-blocking). */
export async function sendAxiaOnboardingNotification(
  job: OnboardingJob,
): Promise<"sent" | "skipped" | "failed"> {
  if (env.onboardingDryRun) return "skipped";
  if (job.status !== "completed") return "skipped";
  if (!parseSequifiFields(job.raw_sequifi_payload ?? {}).onboardAxia) return "skipped";
  if (axiaNotifyAlreadySent(job)) return "skipped";

  if (!isGraphMailConfigured()) return "skipped";

  const { subject, body } = renderAxiaOnboardingNotification(job);

  try {
    await sendMailAsUser({ to: AXIA_NOTIFY_TO, subject, body, contentType: "text" });
    await updateJobStep(job.id, {
      step_errors: { ...job.step_errors, axia_notify: SENT_FLAG },
    });
    return "sent";
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await updateJobStep(job.id, {
      step_errors: { ...job.step_errors, axia_notify: msg },
    });
    return "failed";
  }
}
