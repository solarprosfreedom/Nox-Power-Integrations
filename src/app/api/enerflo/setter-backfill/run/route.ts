import { env } from "@/lib/env";
import { isDashboardAuthed } from "@/lib/auth/require-dashboard";
import { backfillEnerfloSetterFromOwner } from "@/lib/enerflo/backfill-setter-from-owner";

export const maxDuration = 300;

export async function POST(request: Request) {
  if (!(await isDashboardAuthed())) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  if (!env.enerfloV1ApiKey?.trim()) {
    return new Response(JSON.stringify({ error: "ENERFLO_V1_API_KEY is not configured" }), {
      status: 503,
    });
  }

  let body: {
    ownerUserId?: number;
    dryRun?: boolean;
    customerIds?: string[];
    ownerTotalLeads?: number;
    limit?: number;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400 });
  }

  const ownerUserId = Number(body.ownerUserId);
  if (!Number.isFinite(ownerUserId) || ownerUserId <= 0) {
    return new Response(JSON.stringify({ error: "ownerUserId is required" }), { status: 400 });
  }

  const dryRun = body.dryRun === true;
  const customerIds = (body.customerIds ?? []).map(id => String(id).trim()).filter(Boolean);
  const ownerTotalLeads =
    body.ownerTotalLeads != null && Number.isFinite(body.ownerTotalLeads)
      ? Math.max(0, Math.floor(body.ownerTotalLeads))
      : undefined;
  // Optional cap — when set, the owner-scoped scan stops after collecting this
  // many eligible leads. Used by the single-user test runner for a fast preview.
  const limit =
    body.limit != null && Number.isFinite(body.limit) && body.limit > 0
      ? Math.floor(body.limit)
      : undefined;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
      };

      try {
        send({
          type: "phase",
          message:
            customerIds.length > 0
              ? `Updating ${customerIds.length} lead(s) from scan cache…`
              : "Finding this rep's leads in Enerflo…",
        });

        const result = await backfillEnerfloSetterFromOwner({
          ownerUserId,
          dryRun,
          customerIds: customerIds.length ? customerIds : undefined,
          ownerTotalLeads,
          limit,
          onScanPage: (page, pagesFetched) => {
            send({ type: "scan_progress", page, pagesFetched, ownerUserId });
          },
        });

        send({ type: "complete", result });
      } catch (e) {
        send({
          type: "error",
          message: e instanceof Error ? e.message : String(e),
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-store",
    },
  });
}
