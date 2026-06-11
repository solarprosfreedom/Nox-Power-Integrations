import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { syncInstallSheet } from "@/lib/install-sheet/sync";

export const maxDuration = 300;

function authorizeCron(request: Request): boolean {
  const secret = env.cronSecret?.trim();
  if (!secret) {
    return process.env.NODE_ENV === "development";
  }
  const auth = request.headers.get("authorization") ?? "";
  return auth === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!env.installSheetSyncEnabled) {
    const preview = await syncInstallSheet({ dryRun: true });
    return NextResponse.json({
      ...preview,
      message: "INSTALL_SHEET_SYNC_ENABLED is false — preview only, no Enerflo creates.",
    });
  }

  try {
    const summary = await syncInstallSheet({ dryRun: false });
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
