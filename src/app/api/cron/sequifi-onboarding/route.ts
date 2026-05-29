import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { runOnboardingCycle } from "@/lib/onboarding/orchestrator";

export const maxDuration = 300;

function authorizeCron(request: Request): boolean {
  const secret = env.cronSecret?.trim();
  if (!secret) {
    // Local dev: allow without secret when CRON_SECRET unset
    return process.env.NODE_ENV === "development";
  }
  const auth = request.headers.get("authorization") ?? "";
  return auth === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const summary = await runOnboardingCycle({ limit: 20 });
    return NextResponse.json(summary);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  return GET(request);
}
