import type { OnboardingJob } from "@/lib/onboarding/types";

const ACCOUNT_ID_PREFIX = "enerflo_account:";
const ACCOUNT_EMAIL_PREFIX = "enerflo_email:";

export interface EnerfloInstallerAccount {
  tabName: string;
  email: string;
  userId: string;
}

export function enerfloAccountStepKey(tabName: string): string {
  return `${ACCOUNT_ID_PREFIX}${tabName}`;
}

export function enerfloEmailStepKey(tabName: string): string {
  return `${ACCOUNT_EMAIL_PREFIX}${tabName}`;
}

/** Read persisted Enerflo accounts from job step_errors. */
export function readEnerfloAccountsFromJob(job: OnboardingJob): EnerfloInstallerAccount[] {
  const out: EnerfloInstallerAccount[] = [];
  for (const [key, value] of Object.entries(job.step_errors)) {
    if (!key.startsWith(ACCOUNT_ID_PREFIX) || !value?.trim()) continue;
    const tabName = key.slice(ACCOUNT_ID_PREFIX.length);
    const email = job.step_errors[enerfloEmailStepKey(tabName)] ?? "";
    out.push({ tabName, email, userId: value.trim() });
  }
  return out;
}

export function enerfloAccountsToStepErrors(
  accounts: EnerfloInstallerAccount[],
): Record<string, string> {
  const patch: Record<string, string> = {};
  for (const { tabName, email, userId } of accounts) {
    patch[enerfloAccountStepKey(tabName)] = userId;
    patch[enerfloEmailStepKey(tabName)] = email;
  }
  return patch;
}

export function primaryEnerfloUserId(accounts: EnerfloInstallerAccount[]): string | null {
  return accounts[0]?.userId ?? null;
}
