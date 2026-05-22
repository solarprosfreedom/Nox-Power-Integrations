/** Built-in dashboard login (internal tool). */
export const AUTH_EMAIL = "jonaslim@solarpros.io";
export const AUTH_PASSWORD = "jonas123";

export const SESSION_COOKIE = "im_session";
export const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 7; // 7 days

function getSecret(): string {
  return process.env.AUTH_SECRET ?? "integration-middleware-dev-secret";
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export function verifyCredentials(email: string, password: string): boolean {
  return (
    safeEqual(email.trim().toLowerCase(), AUTH_EMAIL.toLowerCase()) &&
    safeEqual(password, AUTH_PASSWORD)
  );
}

async function hmacSha256Hex(message: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function createSessionToken(): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SEC;
  const payload = JSON.stringify({ email: AUTH_EMAIL, exp });
  const payloadB64 = Buffer.from(payload).toString("base64url");
  const sig = await hmacSha256Hex(payloadB64, getSecret());
  return `${payloadB64}.${sig}`;
}

export async function verifySessionToken(token: string): Promise<boolean> {
  const dot = token.lastIndexOf(".");
  if (dot === -1) return false;

  const payloadB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = await hmacSha256Hex(payloadB64, getSecret());
  if (!safeEqual(sig, expected)) return false;

  try {
    const payload = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf8")
    ) as { email?: string; exp?: number };
    if (payload.email !== AUTH_EMAIL) return false;
    if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
