import { NextResponse } from "next/server";
import {
  inactiveRepAuthIsConfigured,
  isInactiveRepAllowedEmail,
} from "@/lib/auth/inactive-reps";
import {
  cancelInactiveRepOtpChallenge,
  createInactiveRepOtpChallenge,
  generateInactiveRepOtpCode,
  inactiveRepOtpStoreIsConfigured,
  INACTIVE_REPS_OTP_COOKIE,
  INACTIVE_REPS_OTP_TTL_SECONDS,
} from "@/lib/auth/inactive-reps-otp";
import { sendInactiveRepOtpEmail } from "@/lib/auth/inactive-reps-otp-mail";
import { requestIsSameOrigin } from "@/lib/auth/request-origin";
import { isGraphMailConfigured } from "@/lib/microsoft/graph-mail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GENERIC_MESSAGE = "If this email is approved, a sign-in code has been sent.";

export async function POST(request: Request) {
  if (!requestIsSameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }
  if (
    !inactiveRepAuthIsConfigured() ||
    !inactiveRepOtpStoreIsConfigured() ||
    !isGraphMailConfigured()
  ) {
    return NextResponse.json(
      { error: "Inactive-rep email sign-in is not configured. Contact an administrator." },
      { status: 503 },
    );
  }

  let body: { email?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase() ?? "";
  if (!isInactiveRepAllowedEmail(email)) {
    return NextResponse.json({ ok: true, message: GENERIC_MESSAGE });
  }

  const code = generateInactiveRepOtpCode();
  try {
    const challenge = await createInactiveRepOtpChallenge({ email, code });
    if (challenge.created) {
      try {
        await sendInactiveRepOtpEmail({ email, code });
      } catch (error) {
        await cancelInactiveRepOtpChallenge(challenge.challengeId).catch(() => undefined);
        throw error;
      }
    }

    const response = NextResponse.json({ ok: true, message: GENERIC_MESSAGE });
    response.headers.set("Cache-Control", "no-store");
    response.cookies.set(INACTIVE_REPS_OTP_COOKIE, challenge.challengeId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: INACTIVE_REPS_OTP_TTL_SECONDS,
    });
    return response;
  } catch (error) {
    console.error("Inactive-rep OTP email failed", error);
    return NextResponse.json(
      { error: "Unable to send the sign-in code. Please try again." },
      { status: 503 },
    );
  }
}
