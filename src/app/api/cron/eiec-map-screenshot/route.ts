import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import {
  screenshotEiecInstantApp,
  uploadJaneDoeScreenshot,
} from "@/lib/eiec/instant-app-screenshot";

export const maxDuration = 120;

const DEFAULT_ADDRESS = "1124 Jefferson St, Hillsboro, IL 62049";

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
  const address = url.searchParams.get("address")?.trim() || DEFAULT_ADDRESS;
  const upload = url.searchParams.get("upload") !== "0";

  try {
    const shot = await screenshotEiecInstantApp(address);
    const fileName = `EIEC map screenshot - vercel trial - ${Date.now()}.png`;
    const uploaded = upload
      ? await uploadJaneDoeScreenshot(fileName, shot.png)
      : null;

    return NextResponse.json({
      ok: shot.eligibleBanner && !shot.webglFailed,
      vercel: Boolean(process.env.VERCEL),
      address: shot.address,
      eligibleBanner: shot.eligibleBanner,
      notEligibleBanner: shot.notEligibleBanner,
      webglFailed: shot.webglFailed,
      snippet: shot.snippet,
      elapsedMs: shot.elapsedMs,
      pngBytes: shot.png.length,
      sharePoint: uploaded,
    });
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
