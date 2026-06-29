import { config } from "dotenv";
import path from "path";

config({ path: path.join(process.cwd(), ".env.local") });

const jobId = process.argv[2];
if (!jobId) {
  console.error("Usage: npx tsx scripts/retry-onboarding-job.ts <jobId>");
  process.exit(1);
}

async function main() {
  const { runOnboardingJob } = await import("../src/lib/onboarding/orchestrator");
  console.log(`Retrying onboarding job ${jobId}...`);
  const result = await runOnboardingJob(jobId);
  console.log(
    JSON.stringify(
      {
        status: result?.status,
        microsoft_status: result?.microsoft_status,
        enerflo_status: result?.enerflo_status,
        terros_status: result?.terros_status,
        welcome_email_status: result?.welcome_email_status,
        terros_user_id: result?.terros_user_id,
        step_errors: result?.step_errors,
        last_error: result?.last_error,
        completed_at: result?.completed_at,
      },
      null,
      2,
    ),
  );
  if (result?.status !== "completed") process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
