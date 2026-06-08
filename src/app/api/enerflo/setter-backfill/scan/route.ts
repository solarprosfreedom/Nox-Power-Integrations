import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { isDashboardAuthed } from "@/lib/auth/require-dashboard";
import {
  scanOwnerSetterSummaries,
  type OwnerSetterSummary,
} from "@/lib/enerflo/backfill-setter-from-owner";

export const maxDuration = 300;

export async function POST(request: Request) {
  if (!(await isDashboardAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!env.enerfloV1ApiKey?.trim()) {
    return NextResponse.json({ error: "ENERFLO_V1_API_KEY is not configured" }, { status: 503 });
  }

  let body: { ownerUserIds?: number[]; baseReps?: OwnerSetterSummary[] } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const ownerUserIds = (body.ownerUserIds ?? [])
    .map(id => Number(id))
    .filter(id => Number.isFinite(id) && id > 0);

  const baseReps = body.baseReps ?? [];

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
            ownerUserIds.length > 0
              ? `Scanning customers for ${ownerUserIds.length} rep(s)…`
              : "Scanning all customers once…",
        });

        const result = await scanOwnerSetterSummaries({
          ownerUserIds: ownerUserIds.length ? ownerUserIds : undefined,
          baseReps,
          onPage: (page, rowsScanned) => {
            send({ type: "progress", page, rowsScanned });
          },
          onPartial: summaries => {
            send({ type: "partial", summaries });
          },
        });

        send({
          type: "complete",
          summaries: result.summaries,
          eligibleByOwner: result.eligibleByOwner,
          pagesFetched: result.pagesFetched,
          rowsScanned: result.rowsScanned,
        });
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
