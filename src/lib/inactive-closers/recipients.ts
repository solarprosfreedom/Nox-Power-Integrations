import { normalizeEmail } from "@/lib/inactive-reps/identity";

export const INACTIVE_CLOSER_REPORT_RECIPIENTS = [
  "samjensen@noxpwr.com",
  "noxpwr@gmail.com",
] as const;

export function inactiveCloserReportRecipients(): string[] {
  return [...new Set(INACTIVE_CLOSER_REPORT_RECIPIENTS.map(normalizeEmail).filter(Boolean))];
}
