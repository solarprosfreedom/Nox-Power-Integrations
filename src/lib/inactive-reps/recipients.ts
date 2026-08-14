import { env } from "@/lib/env";
import { normalizeEmail } from "@/lib/inactive-reps/identity";

export function inactiveRepReportRecipients(
  primaryRecipient: string,
  additionalRecipients = env.inactiveRepEmailAdditionalRecipients,
): string[] {
  const recipients = [
    primaryRecipient,
    ...(additionalRecipients ?? "").split(/[;,\s]+/),
  ]
    .map(normalizeEmail)
    .filter(Boolean);
  return [...new Set(recipients)];
}
