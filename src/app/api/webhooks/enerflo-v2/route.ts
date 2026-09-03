/**
 * Disabled Enerflo v2 webhook endpoint.
 *
 * Requests are acknowledged so stale Enerflo subscriptions do not retry, but
 * no payload is parsed and no Terros API is called.
 */

import { NextResponse } from "next/server";

const DISABLED_REASON = "Enerflo → Terros synchronization is disabled";

export async function GET() {
  return NextResponse.json({
    ok: true,
    enabled: false,
    description: `${DISABLED_REASON}. POST requests are acknowledged without processing.`,
    path: "/api/webhooks/enerflo-v2",
  });
}

export async function POST() {
  return NextResponse.json({
    received: true,
    skipped: true,
    reason: DISABLED_REASON,
  });
}
