import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import {
  INACTIVE_REPS_SESSION_COOKIE,
  verifyInactiveRepSessionToken,
} from "@/lib/auth/inactive-reps";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === "/inactive-reps" || pathname.startsWith("/inactive-reps/")) {
    const inactiveRepToken = request.cookies.get(INACTIVE_REPS_SESSION_COOKIE)?.value;
    const inactiveRepSession = inactiveRepToken
      ? await verifyInactiveRepSessionToken(inactiveRepToken)
      : null;

    if (pathname === "/inactive-reps/login") {
      return inactiveRepSession
        ? NextResponse.redirect(new URL("/inactive-reps", request.url))
        : NextResponse.next();
    }

    if (!inactiveRepSession) {
      const loginUrl = new URL("/inactive-reps/login", request.url);
      loginUrl.searchParams.set("from", pathname);
      return NextResponse.redirect(loginUrl);
    }
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const authed = token ? await verifySessionToken(token) : false;

  if (pathname === "/login") {
    if (authed) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }

  if (!authed) {
    const loginUrl = new URL("/login", request.url);
    if (pathname !== "/") {
      loginUrl.searchParams.set("from", pathname);
    }
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!api/webhooks|api/cron|api/auth|api/inactive-reps|api/terros|api/migration/enerflo-setter-backfill|_next/static|_next/image|favicon.ico).*)",
  ],
};
