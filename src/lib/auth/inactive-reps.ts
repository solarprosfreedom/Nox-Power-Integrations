export const INACTIVE_REPS_SESSION_COOKIE = "inactive_reps_session";
export const INACTIVE_REPS_SESSION_MAX_AGE_SEC = 60 * 60 * 12; // 12 hours
export const INACTIVE_REPS_ALLOWED_EMAILS = [
  "jorgesalazar@noxpwr.com",
  "jonaslim@noxpwr.com",
] as const;

interface InactiveRepAuthConfig {
  secret: string;
}

export interface InactiveRepSession {
  email: string;
}

interface InactiveRepSessionPayload {
  email: string;
  exp: number;
  scope: "inactive-reps";
}

function configuredValue(name: string): string {
  return process.env[name]?.trim() ?? "";
}

function getConfig(): InactiveRepAuthConfig | null {
  const secret = configuredValue("INACTIVE_REPS_AUTH_SECRET");
  if (secret.length < 32) return null;
  return { secret };
}

export function inactiveRepAuthIsConfigured(): boolean {
  return getConfig() !== null;
}

function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

async function hmacSha256Hex(message: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(signature))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function isInactiveRepAllowedEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  return INACTIVE_REPS_ALLOWED_EMAILS.some(allowed => safeEqual(normalized, allowed));
}

export async function inactiveRepHmacHex(message: string): Promise<string> {
  const config = getConfig();
  if (!config) throw new Error("Inactive-rep authentication is not configured");
  return hmacSha256Hex(message, config.secret);
}

export async function createInactiveRepSessionToken(email: string): Promise<string> {
  const config = getConfig();
  if (!config) throw new Error("Inactive-rep authentication is not configured");
  const normalizedEmail = email.trim().toLowerCase();
  if (!isInactiveRepAllowedEmail(normalizedEmail)) {
    throw new Error("Email is not authorized for inactive-rep review");
  }

  const payload: InactiveRepSessionPayload = {
    email: normalizedEmail,
    exp: Math.floor(Date.now() / 1000) + INACTIVE_REPS_SESSION_MAX_AGE_SEC,
    scope: "inactive-reps",
  };
  const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = await hmacSha256Hex(payloadBase64, config.secret);
  return `${payloadBase64}.${signature}`;
}

export async function verifyInactiveRepSessionToken(token: string): Promise<InactiveRepSession | null> {
  const config = getConfig();
  if (!config) return null;

  const separator = token.lastIndexOf(".");
  if (separator === -1) return null;

  const payloadBase64 = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  const expectedSignature = await hmacSha256Hex(payloadBase64, config.secret);
  if (!safeEqual(signature, expectedSignature)) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(payloadBase64, "base64url").toString("utf8"),
    ) as Partial<InactiveRepSessionPayload>;
    if (payload.scope !== "inactive-reps") return null;
    if (typeof payload.email !== "string" || !isInactiveRepAllowedEmail(payload.email)) return null;
    if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return { email: payload.email };
  } catch {
    return null;
  }
}
