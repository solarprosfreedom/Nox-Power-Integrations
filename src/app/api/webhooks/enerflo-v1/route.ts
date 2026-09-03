/**
 * POST /api/webhooks/enerflo-v1
 *
 * Disabled Enerflo v1 webhook endpoint. Requests are acknowledged so stale
 * vendor subscriptions do not retry, but no payload is parsed or processed.
 */

import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    ok: true,
    enabled: false,
    description: "Enerflo → Terros synchronization is disabled. POST requests are acknowledged without processing.",
    path: "/api/webhooks/enerflo-v1",
  });
}

export async function POST() {
  return NextResponse.json({
    received: true,
    skipped: true,
    reason: "Enerflo → Terros synchronization is disabled",
  });
}
