import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { retryPartnerOnboardingSteps } from "@/lib/onboarding/orchestrator";

/** Headless Chromium partner forms need a long budget (same as onboarding cron). */
export const maxDuration = 300;

async function authorizeDashboard(): Promise<boolean> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return false;
  return verifySessionToken(token);
}

export async function POST(request: Request) {
  if (!(await authorizeDashboard())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let jobId = "";
  try {
    const body = (await request.json()) as { jobId?: string };
    jobId = typeof body.jobId === "string" ? body.jobId.trim() : "";
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!jobId) {
    return NextResponse.json({ error: "jobId is required" }, { status: 400 });
  }

  try {
    const job = await retryPartnerOnboardingSteps(jobId);
    return NextResponse.json({ job });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
