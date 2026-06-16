import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { isDashboardAuthed } from "@/lib/auth/require-dashboard";
import { ensureAllUserRoles } from "@/lib/enerflo/ensure-user-roles";

export const maxDuration = 300;

export async function POST(request: Request) {
  if (!(await isDashboardAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!env.enerfloV1ApiKey?.trim()) {
    return NextResponse.json(
      { error: "ENERFLO_V1_API_KEY is not configured" },
      { status: 503 },
    );
  }

  let body: { dryRun?: boolean; filterEmail?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    /* no body — defaults apply */
  }

  const dryRun = body.dryRun !== false; // default: dry run for safety
  const filterEmail = typeof body.filterEmail === "string" ? body.filterEmail.trim() : undefined;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
      };

      try {
        send({
          type: "phase",
          message: filterEmail
            ? `Looking up user ${filterEmail}…`
            : "Fetching all Enerflo users…",
        });

        const result = await ensureAllUserRoles({
          dryRun,
          filterEmail,
          onProgress: (done, total, userName) => {
            send({ type: "progress", done, total, userName });
          },
        });

        send({ type: "complete", result });
      } catch (e) {
        send({ type: "error", message: e instanceof Error ? e.message : String(e) });
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
