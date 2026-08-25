import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { runEiecEligibilityCycle } from "@/lib/eiec/run";

export const maxDuration = 180;

function authorizeCron(request: Request): boolean {
  const secret = env.cronSecret?.trim();
  if (!secret) return process.env.NODE_ENV === "development";
  const auth = request.headers.get("authorization") ?? "";
  return auth === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? "1") || 1;
  const forceUserId = Number(url.searchParams.get("userId") ?? "") || undefined;

  try {
    const summary = await runEiecEligibilityCycle({ limit, forceUserId });
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
