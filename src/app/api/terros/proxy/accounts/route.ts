import { NextResponse } from "next/server";
import { listAccountsForOwner } from "@/lib/terros/proxy-accounts";
import {
  isTerrosProxyConfigured,
  resolveProxyAccess,
} from "@/lib/terros/proxy-config";

function bearerFromRequest(request: Request): string {
  const auth = request.headers.get("authorization") ?? "";
  if (auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  return "";
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

  const result = await listAccountsForOwner(access.installerId, access.ownerEmail);

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
      default:
        return NextResponse.json({ error: "Request failed" }, { status: 500 });
    }
  }

  return NextResponse.json(result.data, {
    headers: { "Cache-Control": "private, max-age=60" },
  });
}
