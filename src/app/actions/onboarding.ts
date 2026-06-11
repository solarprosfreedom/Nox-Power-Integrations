"use server";

import {
  checkUserExistence,
  previewOnboardingFromSequifi,
  provisionSequifiUserById,
  provisionSequifiUsersBulk,
  runOnboardingCycle,
  runOnboardingJob,
} from "@/lib/onboarding/orchestrator";
import {
  buildEmpwrHubSpotPayload,
  isEmpwrHubSpotConfigured,
  jobHasEmpwrInstallerTab,
  submitEmpwrHubSpotForm,
  validateEmpwrHubSpotPayload,
} from "@/lib/onboarding/empwr-hubspot";
import { listOnboardingJobsSafe, loadJobById } from "@/lib/onboarding/repository";
import { scanSequifiMicrosoftGaps } from "@/lib/onboarding/microsoft-gap-scan";
import { env } from "@/lib/env";

export async function getOnboardingPreview() {
  return previewOnboardingFromSequifi();
}

export async function getOnboardingJobs() {
  return listOnboardingJobsSafe(100);
}

/** Gap-driven hired onboarding cycle (same as daily cron). */
export async function runHiredOnboardingNow() {
  return runOnboardingCycle({ limit: 20 });
}

/** @deprecated Use runHiredOnboardingNow */
export async function runOnboardingNow() {
  return runHiredOnboardingNow();
}

export async function provisionSequifiUser(sequifiUserId: number) {
  return provisionSequifiUserById(sequifiUserId);
}

export async function provisionSequifiUsersBulkAction(sequifiUserIds: number[]) {
  return provisionSequifiUsersBulk(sequifiUserIds);
}

export async function retryOnboardingJob(jobId: string) {
  const job = await runOnboardingJob(jobId);
  return { job };
}

export async function checkOnboardingUserExists(email: string) {
  return checkUserExistence(email.trim());
}

export async function scanSequifiMicrosoftGapList() {
  return scanSequifiMicrosoftGaps();
}

export async function getOnboardingConfig() {
  return {
    dryRun: env.onboardingDryRun,
    goLiveAt: env.onboardingGoLiveAt ?? null,
    assignMsLicense: env.onboardingAssignMsLicense,
    msLicenseSkuId: env.msLicenseSkuId ?? null,
    sequifiConfigured: Boolean(
      env.sequifiAccessToken?.trim() || env.sequifiApiKey?.trim(),
    ),
    supabaseConfigured: Boolean(
      env.supabaseUrl?.trim() && env.supabaseServiceRoleKey?.trim(),
    ),
    graphConfigured: Boolean(
      env.azureTenantId && env.azureClientId && env.azureClientSecret,
    ),
    enerfloConfigured: Boolean(env.enerfloV1ApiKey?.trim()),
    terrosConfigured: Boolean(env.terrosApiKey?.trim()),
    empwrHubSpotConfigured: isEmpwrHubSpotConfigured(),
  };
}

/** Manual test: POST one completed EMPWR job to HubSpot (ignores ONBOARDING_DRY_RUN). */
export async function submitEmpwrHubSpotForJob(jobId: string) {
  const job = await loadJobById(jobId);
  if (!job) {
    return { ok: false as const, result: "failed" as const, error: "Job not found" };
  }
  if (!jobHasEmpwrInstallerTab(job)) {
    return {
      ok: false as const,
      result: "skipped" as const,
      error: "Job does not have EMPWR installer tab",
    };
  }
  if (!isEmpwrHubSpotConfigured()) {
    return {
      ok: false as const,
      result: "skipped" as const,
      error: "EMPWR HubSpot not configured",
    };
  }

  const payload = buildEmpwrHubSpotPayload(job);
  const validationError = validateEmpwrHubSpotPayload(payload);
  if (validationError) {
    return { ok: false as const, result: "failed" as const, error: validationError, payload };
  }

  const result = await submitEmpwrHubSpotForm(job, { ignoreDryRun: true });
  const updated = await loadJobById(jobId);
  return {
    ok: result === "sent",
    result,
    stepError: updated?.step_errors.empwr_hubspot ?? null,
    payload,
  };
}
