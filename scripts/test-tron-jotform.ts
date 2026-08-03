/**
 * One-off: submit Tron JotForm for Test Onboarding with a valid phone override.
 *
 *   npx tsx scripts/test-tron-jotform.ts [jobId] [phoneDigits]
 */
import { config } from "dotenv";
import path from "path";

config({ path: path.join(process.cwd(), ".env.local") });

const JOB_ID = process.argv[2] || "3e3b20d1-13c8-4100-81d8-9dae6960f548";
const PHONE = process.argv[3] || "4805550199";

async function main() {
  const { env } = await import("../src/lib/env");
  const { loadJobById, updateJobStep } = await import("../src/lib/onboarding/repository");
  const {
    buildTronJotFormFields,
    isTronJotFormConfigured,
    jobHasTronInstallerTab,
  } = await import("../src/lib/onboarding/tron-jotform");
  const { submitTronJotFormViaBrowser } = await import("../src/lib/onboarding/tron-jotform-browser");
  const { formatPhoneForMaskedInput, phoneDigitsForMaskedInput } = await import(
    "../src/lib/onboarding/phone"
  );

  const job = await loadJobById(JOB_ID);
  if (!job) throw new Error(`Job not found: ${JOB_ID}`);
  if (!jobHasTronInstallerTab(job)) throw new Error("Job has no Tron installer tab");
  if (!isTronJotFormConfigured()) throw new Error("Tron JotForm not configured (JOTFORM_TRON_*)");

  const formId = env.jotformTronFormId?.trim() || "";
  const fields = buildTronJotFormFields({ ...job, phone: PHONE });
  // Ensure display + digits paths both use the override.
  fields.phone = formatPhoneForMaskedInput(PHONE);

  console.log(
    JSON.stringify(
      {
        jobId: job.id,
        name: `${fields.firstName} ${fields.lastName}`,
        email: fields.email,
        phoneRaw: PHONE,
        phoneFormatted: fields.phone,
        phoneDigits: phoneDigitsForMaskedInput(PHONE),
        dob: fields.dob,
        platforms: fields.platforms,
        formId,
      },
      null,
      2,
    ),
  );

  console.log("Submitting Tron JotForm via headless browser…");
  const result = await submitTronJotFormViaBrowser(fields, formId);
  console.log("result:", result);

  await updateJobStep(job.id, {
    step_errors: {
      ...job.step_errors,
      tron_jotform: result.status === "sent" ? "sent" : (result.reason ?? "failed"),
    },
  });
  console.log(`Updated job step_errors.tron_jotform = ${result.status === "sent" ? "sent" : result.reason}`);
  process.exit(result.status === "sent" ? 0 : 1);
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
