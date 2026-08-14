import { NextResponse } from "next/server";
import { isDashboardAuthed } from "@/lib/auth/require-dashboard";
import { listInactiveRepAutomationLogs } from "@/lib/inactive-reps/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isDashboardAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await listInactiveRepAutomationLogs());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
