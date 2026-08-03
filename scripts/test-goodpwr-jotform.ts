/**
 * One-off: submit GoodPWR JotForm for Test Onboarding with a valid phone override.
 *
 *   npx tsx scripts/test-goodpwr-jotform.ts [jobId] [phoneDigits]
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
    buildGoodPwrFormFields,
    isGoodPwrFormConfigured,
    jobHasGoodPwrInstallerTab,
  } = await import("../src/lib/onboarding/goodpwr-form");
  const { submitGoodPwrJotFormViaBrowser } = await import(
    "../src/lib/onboarding/goodpwr-jotform-browser"
  );
  const { formatPhoneForMaskedInput, phoneDigitsForMaskedInput } = await import(
    "../src/lib/onboarding/phone"
  );

  const job = await loadJobById(JOB_ID);
  if (!job) throw new Error(`Job not found: ${JOB_ID}`);
  if (!jobHasGoodPwrInstallerTab(job)) throw new Error("Job has no GoodPWR installer tab");
  if (!isGoodPwrFormConfigured()) throw new Error("GoodPWR JotForm not configured");

  const formId = env.jotformGoodPwrFormId?.trim() || "261804783661160";
  const fields = buildGoodPwrFormFields({ ...job, phone: PHONE });
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
        markets: fields.markets,
        lender: fields.preferredLender,
        tpo: fields.preferredTpo,
        formId,
      },
      null,
      2,
    ),
  );

  console.log("Submitting GoodPWR JotForm via headless browser…");
  const result = await submitGoodPwrJotFormViaBrowser(fields, formId);
  console.log("result:", result);

  await updateJobStep(job.id, {
    step_errors: {
      ...job.step_errors,
      goodpwr_form: result.status === "sent" ? "sent" : (result.reason ?? "failed"),
    },
  });
  console.log(
    `Updated job step_errors.goodpwr_form = ${result.status === "sent" ? "sent" : result.reason}`,
  );
  process.exit(result.status === "sent" ? 0 : 1);
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
