import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { backfillEnerfloSetterFromOwner } from "@/lib/enerflo/backfill-setter-from-owner";

export const maxDuration = 300;

function authorize(request: Request): boolean {
  const secret = env.cronSecret?.trim();
  if (!secret) {
    return process.env.NODE_ENV === "development";
  }
  const auth = request.headers.get("authorization") ?? "";
  return auth === `Bearer ${secret}`;
}

function parseQuery(request: Request): {
  dryRun: boolean;
  customerId?: string;
  ownerUserId?: number;
  ownerEmail?: string;
  limit?: number;
  page: number;
  concurrency: number;
} {
  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun") === "true";
  const customerId = url.searchParams.get("customerId")?.trim() || undefined;
  const ownerUserIdRaw = url.searchParams.get("ownerUserId");
  const ownerUserIdParsed = ownerUserIdRaw != null ? Number(ownerUserIdRaw) : NaN;
  const ownerUserId = Number.isFinite(ownerUserIdParsed) ? ownerUserIdParsed : undefined;
  const ownerEmail = url.searchParams.get("ownerEmail")?.trim() || undefined;
  const limitRaw = url.searchParams.get("limit");
  const limitParsed = limitRaw != null ? Number(limitRaw) : NaN;
  const limit = Number.isFinite(limitParsed) ? limitParsed : undefined;
  const pageRaw = Number(url.searchParams.get("page") ?? "1");
  const concurrencyRaw = Number(url.searchParams.get("concurrency") ?? "3");
  return {
    dryRun,
    customerId,
    ownerUserId,
    ownerEmail,
    limit,
    page: Number.isFinite(pageRaw) ? pageRaw : 1,
    concurrency: Number.isFinite(concurrencyRaw) ? concurrencyRaw : 3,
  };
}

export async function POST(request: Request) {
  if (!authorize(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!env.enerfloV1ApiKey?.trim()) {
    return NextResponse.json({ error: "ENERFLO_V1_API_KEY is not configured" }, { status: 503 });
  }

  const query = parseQuery(request);

  try {
    const result = await backfillEnerfloSetterFromOwner({
      dryRun: query.dryRun,
      customerId: query.customerId,
      ownerUserId: query.ownerUserId,
      ownerEmail: query.ownerEmail,
      limit: query.limit,
      startPage: query.page,
      concurrency: query.concurrency,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  return POST(request);
}
