import { cookies } from "next/headers";
import {
  INACTIVE_REPS_SESSION_COOKIE,
  type InactiveRepSession,
  verifyInactiveRepSessionToken,
} from "@/lib/auth/inactive-reps";

export async function getInactiveRepSession(): Promise<InactiveRepSession | null> {
  const token = (await cookies()).get(INACTIVE_REPS_SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifyInactiveRepSessionToken(token);
}

export async function isInactiveRepAuthed(): Promise<boolean> {
  return (await getInactiveRepSession()) !== null;
}
