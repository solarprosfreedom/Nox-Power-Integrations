import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { getWelcomeEmailFrom, isGraphMailConfigured } from "@/lib/microsoft/graph-mail";

export async function GET() {
  return NextResponse.json({
    configured: isGraphMailConfigured(),
    from: getWelcomeEmailFrom() ?? null,
    defaultTestTo: env.welcomeEmailTestTo?.trim() || null,
  });
}
