/**
 * POST /api/webhooks/enerflo-v1
 *
 * Enerflo **1.0** webhooks (Company Settings → Webhooks) use different event names than v2,
 * e.g. `update_customer`, `new_customer`. Point a **separate** subscription URL here:
 *   https://<your-domain>/api/webhooks/enerflo-v1
 *
 * Events with real handlers (update_customer, new_customer, new_appointment, update_appointment)
 * are forwarded internally to the enerflo-v2 POST handler which has the full logic.
 * Unknown events are logged and acknowledged.
 *
 * Payload shape: https://docs.enerflo.io/docs/update-customer
 */

import { NextRequest, NextResponse } from "next/server";
import { writeApiLog } from "@/lib/logger";
import { POST as enerfloV2Post } from "@/app/api/webhooks/enerflo-v2/route";

const MAX_PREVIEW = 4000;

function preview(json: unknown): string {
  try {
    const s = JSON.stringify(json);
    if (s.length <= MAX_PREVIEW) return s;
    return `${s.slice(0, MAX_PREVIEW)}…`;
  } catch {
    return String(json);
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    description:
      "Enerflo **v1** webhook receiver. Subscribe in Company Settings (see Enerflo v1 events docs); use this URL separately from /api/webhooks/enerflo-v2.",
    path: "/api/webhooks/enerflo-v1",
    subscribe: "https://enerflo.io/company/settings → Webhooks (Sales Org)",
    docs: [
      "https://docs.enerflo.io/docs/enerflo-v1-events",
      "https://docs.enerflo.io/docs/enerflo-v1-event-definitions",
      "https://docs.enerflo.io/docs/update-customer",
    ],
    commonEventsForLeads: ["update_customer", "new_customer"],
    note:
      'v1 bodies often include root key "webhook_event". v2 bodies use JSON "event" + "payload"; keep both URLs if you need both generations.',
  });
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const fromHeader =
    req.headers.get("x-enerflo-event") ??
    req.headers.get("webhook-event") ??
    "";

  const webhookEvent =
    (typeof body.webhook_event === "string" ? body.webhook_event : "") ||
    (typeof body.event === "string" ? body.event : "") ||
    req.nextUrl.searchParams.get("event") ||
    fromHeader ||
    "(unknown)";

  // Events with real handlers — forward to v2 route which reads webhook_event too
  const handledEvents = new Set(["update_customer", "new_customer", "new_appointment", "update_appointment"]);
  if (handledEvents.has(webhookEvent)) {
    return enerfloV2Post(req);
  }

  const url = `${req.nextUrl.pathname}${req.nextUrl.search}`;
  await writeApiLog({
    operation: `webhook:enerflo-v1:${webhookEvent}`,
    vendor: "enerflo",
    method: "POST",
    url,
    hadApiKey: false,
    status: 200,
    ok: true,
    responsePreview: preview(body),
  });

  return NextResponse.json({
    received: true,
    webhook_event: webhookEvent,
    id: body.id ?? null,
    topLevelKeys: Object.keys(body),
    message:
      webhookEvent === "(unknown)"
        ? "Parsed body but could not resolve event name — check webhook_event / event header and compare to Enerflo v1 docs."
        : "Logged payload; inspect Activity Logs or Supabase api_logs.",
  });
}
