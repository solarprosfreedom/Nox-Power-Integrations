import { NextResponse } from "next/server";
import { getInactiveRepSession } from "@/lib/auth/require-inactive-reps";
import { requestIsSameOrigin } from "@/lib/auth/request-origin";
import {
  protectInactiveRep,
  revokeInactiveRepExemption,
} from "@/lib/inactive-reps/repository";
import type { InactiveRepExemptionScope } from "@/lib/inactive-reps/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function POST(request: Request) {
  const session = await getInactiveRepSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!requestIsSameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    if (body.action === "revoke") {
      const exemptionId = typeof body.exemptionId === "string" ? body.exemptionId.trim() : "";
      if (!isUuid(exemptionId)) {
        return NextResponse.json({ error: "A valid exemptionId is required" }, { status: 400 });
      }
      const revoked = await revokeInactiveRepExemption({ exemptionId, revokedBy: session.email });
      if (!revoked) {
        return NextResponse.json({ error: "Active persistent protection was not found" }, { status: 404 });
      }
      return NextResponse.json({ ok: true, revoked: true });
    }

    const batchId = typeof body.batchId === "string" ? body.batchId.trim() : "";
    const identityKey = typeof body.identityKey === "string"
      ? body.identityKey.trim().toLowerCase()
      : "";
    const scope: InactiveRepExemptionScope | null = body.scope === "batch" || body.scope === "persistent"
      ? body.scope
      : null;
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!isUuid(batchId)) {
      return NextResponse.json({ error: "A valid batchId is required" }, { status: 400 });
    }
    if (identityKey.length < 3 || identityKey.length > 320) {
      return NextResponse.json({ error: "A valid representative identity is required" }, { status: 400 });
    }
    if (!scope) {
      return NextResponse.json({ error: "Protection scope must be batch or persistent" }, { status: 400 });
    }
    if (reason.length < 3 || reason.length > 500) {
      return NextResponse.json({ error: "Reason must be between 3 and 500 characters" }, { status: 400 });
    }

    const result = await protectInactiveRep({
      batchId,
      identityKey,
      scope,
      reason,
      createdBy: session.email,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const conflict = /already (processing|completed)|remaining scheduled|not part of this emailed batch/i.test(message);
    return NextResponse.json({ error: message }, { status: conflict ? 409 : 500 });
  }
}
