import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { isDashboardAuthed } from "@/lib/auth/require-dashboard";
import { fetchAllEnerfloUsersForBackfill } from "@/lib/enerflo/backfill-setter-from-owner";

export async function POST() {
  if (!(await isDashboardAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!env.enerfloV1ApiKey?.trim()) {
    return NextResponse.json({ error: "ENERFLO_V1_API_KEY is not configured" }, { status: 503 });
  }

  try {
    const summaries = await fetchAllEnerfloUsersForBackfill();
    return NextResponse.json({ summaries });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
