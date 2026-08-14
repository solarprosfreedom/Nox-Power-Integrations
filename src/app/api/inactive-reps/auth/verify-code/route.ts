import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  createInactiveRepSessionToken,
  INACTIVE_REPS_SESSION_COOKIE,
  INACTIVE_REPS_SESSION_MAX_AGE_SEC,
  isInactiveRepAllowedEmail,
} from "@/lib/auth/inactive-reps";
import {
  consumeInactiveRepOtpChallenge,
  INACTIVE_REPS_OTP_COOKIE,
} from "@/lib/auth/inactive-reps-otp";
import { requestIsSameOrigin } from "@/lib/auth/request-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clearChallengeCookie(response: NextResponse): void {
  response.cookies.set(INACTIVE_REPS_OTP_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function POST(request: NextRequest) {
  if (!requestIsSameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  let body: { code?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const code = body.code?.trim() ?? "";
  if (!/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "Enter the six-digit code." }, { status: 400 });
  }

  const challengeId = request.cookies.get(INACTIVE_REPS_OTP_COOKIE)?.value;
  if (!challengeId || !isUuid(challengeId)) {
    const response = NextResponse.json(
      { error: "Request a new sign-in code." },
      { status: 400 },
    );
    clearChallengeCookie(response);
    return response;
  }

  try {
    const verification = await consumeInactiveRepOtpChallenge({ challengeId, code });
    if (verification.result !== "verified" || !verification.email) {
      const terminal = ["expired", "locked", "used"].includes(verification.result);
      const response = NextResponse.json(
        {
          error: terminal
            ? "This code is no longer valid. Request a new code."
            : "The code is incorrect.",
        },
        { status: 401 },
      );
      if (terminal) clearChallengeCookie(response);
      return response;
    }
    if (!isInactiveRepAllowedEmail(verification.email)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const token = await createInactiveRepSessionToken(verification.email);
    const response = NextResponse.json({ ok: true });
    response.headers.set("Cache-Control", "no-store");
    response.cookies.set(INACTIVE_REPS_SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: INACTIVE_REPS_SESSION_MAX_AGE_SEC,
    });
    clearChallengeCookie(response);
    return response;
  } catch (error) {
    console.error("Inactive-rep OTP verification failed", error);
    return NextResponse.json(
      { error: "Unable to verify the sign-in code. Please try again." },
      { status: 503 },
    );
  }
}
