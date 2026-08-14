import { NextResponse } from "next/server";
import { INACTIVE_REPS_SESSION_COOKIE } from "@/lib/auth/inactive-reps";
import { INACTIVE_REPS_OTP_COOKIE } from "@/lib/auth/inactive-reps-otp";
import { requestIsSameOrigin } from "@/lib/auth/request-origin";

export async function POST(request: Request) {
  if (!requestIsSameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }
  const response = NextResponse.json({ ok: true });
  response.headers.set("Cache-Control", "no-store");
  response.cookies.set(INACTIVE_REPS_SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  response.cookies.set(INACTIVE_REPS_OTP_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
  return response;
}
