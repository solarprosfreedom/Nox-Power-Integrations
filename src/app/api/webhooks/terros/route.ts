/**
 * Disabled Terros webhook endpoint.
 *
 * Requests are acknowledged so stale Terros subscriptions do not retry, but
 * no payload is parsed and no Enerflo API is called.
 */

import { NextResponse } from "next/server";

const DISABLED_REASON = "Terros → Enerflo synchronization is disabled";

export async function GET() {
  return NextResponse.json({
    ok: true,
    enabled: false,
    description: `${DISABLED_REASON}. POST requests are acknowledged without processing.`,
    path: "/api/webhooks/terros",
  });
}

export async function POST() {
  return NextResponse.json({
    received: true,
    skipped: true,
    reason: DISABLED_REASON,
  });
}
