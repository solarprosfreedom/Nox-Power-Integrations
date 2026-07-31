/**
 * Re-run failed roster sheet / partner form steps for a completed onboarding job.
 *
 *   npx tsx scripts/retry-partner-steps.ts <jobId>
 */
import { config } from "dotenv";
import path from "path";

config({ path: path.join(process.cwd(), ".env.local") });

const jobId = process.argv[2];
if (!jobId) {
  console.error("Usage: npx tsx scripts/retry-partner-steps.ts <jobId>");
  process.exit(1);
}

async function main() {
  const { retryPartnerOnboardingSteps } = await import("../src/lib/onboarding/orchestrator");
  console.log(`Retrying partner sheets/forms for job ${jobId}...`);
  const result = await retryPartnerOnboardingSteps(jobId);
  const errs = result?.step_errors ?? {};
  const interesting = Object.fromEntries(
    Object.entries(errs).filter(([k]) =>
      /sheet|empwr|empower|tron|good|better|bps|green|icon|solq|admin|axia/i.test(k),
    ),
  );
  console.log(
    JSON.stringify(
      {
        status: result?.status,
        sequifi_user_id: result?.sequifi_user_id,
        name: `${result?.first_name ?? ""} ${result?.last_name ?? ""}`.trim(),
        partner_step_errors: interesting,
      },
      null,
      2,
    ),
  );
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
