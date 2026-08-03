"use server";

/** Partner form retries launch several headless Chromium submits — needs cron-like budget. */
export const maxDuration = 300;

import {
  checkUserExistence,
  previewOnboardingFromSequifi,
  provisionSequifiUserById,
  provisionSequifiUsersBulk,
  retryPartnerOnboardingSteps,
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
import {
  buildEmpowerTypeformFields,
  isEmpowerTypeformConfigured,
  jobHasEmpowerInstallerTab,
  shouldSkipEmpowerTypeformForSetter,
  submitEmpowerTypeform,
  validateEmpowerTypeformFields,
} from "@/lib/onboarding/empower-typeform";
import {
  buildSolqFormFields,
  isSolqFormConfigured,
  jobHasSolqInstallerTab,
  submitSolqForm,
  validateSolqFormFields,
} from "@/lib/onboarding/solq-form";
import { listOnboardingJobsSafe, loadJobById, updateJobStep } from "@/lib/onboarding/repository";
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
  const existing = await loadJobById(jobId);
  if (!existing) return { job: null };
  // Manual retry: clear exhausted attempt budget so a failed job can run again.
  if (existing.attempt_count >= existing.max_attempts || existing.status === "failed") {
    await updateJobStep(jobId, {
      attempt_count: 0,
      next_retry_at: null,
      status: "pending",
      last_error: null,
    });
  }
  const job = await runOnboardingJob(jobId);
  return { job };
}

/** Re-run failed roster sheet / partner form steps on a completed job. */
export async function retryPartnerStepsForJob(jobId: string) {
  const job = await retryPartnerOnboardingSteps(jobId);
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
    requireSequifiComplete: env.onboardingRequireSequifiComplete,
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
    empowerTypeformConfigured: isEmpowerTypeformConfigured(),
    solqFormConfigured: isSolqFormConfigured(),
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

/** Manual test: submit one completed Empower job to Typeform (ignores ONBOARDING_DRY_RUN). */
export async function submitEmpowerTypeformForJob(jobId: string) {
  const job = await loadJobById(jobId);
  if (!job) {
    return { ok: false as const, result: "failed" as const, error: "Job not found" };
  }
  if (!jobHasEmpowerInstallerTab(job)) {
    return {
      ok: false as const,
      result: "skipped" as const,
      error: "Job does not have Empower installer tab / Other Installers",
    };
  }
  if (shouldSkipEmpowerTypeformForSetter(job)) {
    return {
      ok: false as const,
      result: "skipped" as const,
      error: "Appt Setter / Setter — Empower Typeform skipped per SOP",
    };
  }
  if (!isEmpowerTypeformConfigured()) {
    return {
      ok: false as const,
      result: "skipped" as const,
      error: "Empower Typeform not configured (set EMPOWER_TYPEFORM_ENABLED=true)",
    };
  }

  const fields = buildEmpowerTypeformFields(job);
  const validationError = validateEmpowerTypeformFields(fields);
  if (validationError) {
    return { ok: false as const, result: "failed" as const, error: validationError, fields };
  }

  const result = await submitEmpowerTypeform(job, { ignoreDryRun: true });
  const updated = await loadJobById(jobId);
  return {
    ok: result === "sent",
    result,
    stepError: updated?.step_errors.empower_typeform ?? null,
    fields,
  };
}

/** Manual test: submit one completed SolQ job to LeadConnector form (ignores ONBOARDING_DRY_RUN). */
export async function submitSolqFormForJob(jobId: string) {
  const job = await loadJobById(jobId);
  if (!job) {
    return { ok: false as const, result: "failed" as const, error: "Job not found" };
  }
  if (!jobHasSolqInstallerTab(job)) {
    return {
      ok: false as const,
      result: "skipped" as const,
      error: "Job does not have SolQ installer tab / Other Installers",
    };
  }
  if (!isSolqFormConfigured()) {
    return {
      ok: false as const,
      result: "skipped" as const,
      error: "SolQ form not configured (set SOLQ_FORM_ENABLED=true)",
    };
  }

  const fields = buildSolqFormFields(job);
  const validationError = validateSolqFormFields(fields);
  if (validationError) {
    return { ok: false as const, result: "failed" as const, error: validationError, fields };
  }

  const result = await submitSolqForm(job, { ignoreDryRun: true });
  const updated = await loadJobById(jobId);
  return {
    ok: result === "sent",
    result,
    stepError: updated?.step_errors.solq_form ?? null,
    fields,
  };
}
