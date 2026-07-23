import { env } from "@/lib/env";

/** Generic SMS sender — currently backed by Twilio. Kept as a thin, swappable
 * wrapper (isSmsConfigured / sendSms) so callers don't need to know the provider. */

export interface SmsSendResult {
  status: "sent" | "failed";
  reason?: string;
}

export function isSmsConfigured(): boolean {
  return Boolean(
    env.twilioAccountSid?.trim() && env.twilioAuthToken?.trim() && env.twilioFromNumber?.trim(),
  );
}

/** Normalizes a US phone number to E.164 (+1XXXXXXXXXX). Returns null if it can't. */
export function toE164UsPhone(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

export async function sendSms(to: string, body: string): Promise<SmsSendResult> {
  if (!isSmsConfigured()) {
    return { status: "failed", reason: "SMS not configured (missing Twilio credentials)" };
  }
  const toE164 = toE164UsPhone(to);
  if (!toE164) {
    return { status: "failed", reason: `Could not normalize phone number to E.164: "${to}"` };
  }

  const accountSid = env.twilioAccountSid!.trim();
  const authToken = env.twilioAuthToken!.trim();
  const from = env.twilioFromNumber!.trim();
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");

  const params = new URLSearchParams();
  params.append("To", toE164);
  params.append("From", from);
  params.append("Body", body);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });
    const text = await res.text();
    if (!res.ok) {
      return { status: "failed", reason: `Twilio ${res.status}: ${text.slice(0, 500)}` };
    }
    return { status: "sent" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { status: "failed", reason: `Twilio request error: ${msg}` };
  }
}
