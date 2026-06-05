import { NextResponse } from "next/server";
import { listCalendarEventsForProxy } from "@/lib/terros/proxy-calendar";
import {
  isTerrosProxyConfigured,
  resolveProxyAccess,
} from "@/lib/terros/proxy-config";

export const maxDuration = 60;

function bearerFromRequest(request: Request): string {
  const auth = request.headers.get("authorization") ?? "";
  if (auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  return "";
}

function parseCalendarQuery(request: Request): {
  page: number;
  pageSize: number;
  from?: string;
  to?: string;
} {
  const url = new URL(request.url);
  const pageRaw = Number(url.searchParams.get("page") ?? "1");
  const pageSizeRaw = Number(url.searchParams.get("pageSize") ?? "100");
  const from = url.searchParams.get("from")?.trim() || undefined;
  const to = url.searchParams.get("to")?.trim() || undefined;
  return {
    page: Number.isFinite(pageRaw) ? pageRaw : 1,
    pageSize: Number.isFinite(pageSizeRaw) ? pageSizeRaw : 100,
    from,
    to,
  };
}

export async function GET(request: Request) {
  if (!isTerrosProxyConfigured()) {
    return NextResponse.json(
      { error: "Terros proxy is not configured" },
      { status: 503 },
    );
  }

  const access = resolveProxyAccess(bearerFromRequest(request));
  if (!access) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await listCalendarEventsForProxy(access, parseCalendarQuery(request));

  if (!result.ok) {
    switch (result.error.code) {
      case "terros_not_configured":
        return NextResponse.json(
          { error: "Terros API is not configured on the server" },
          { status: 503 },
        );
      case "owner_not_found":
        return NextResponse.json(
          { error: "Owner not found in Terros", ownerEmail: result.error.ownerEmail },
          { status: 404 },
        );
      case "team_not_found":
        return NextResponse.json(
          {
            error: "Team not found in Terros",
            teamName: result.error.teamName,
            teamId: result.error.teamId,
          },
          { status: 404 },
        );
      default:
        return NextResponse.json({ error: "Request failed" }, { status: 500 });
    }
  }

  return NextResponse.json(result.data, {
    headers: {
      "Cache-Control": "private, max-age=60",
      "X-Cache": result.data.cached ? "HIT" : "MISS",
    },
  });
}
