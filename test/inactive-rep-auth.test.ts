import assert from "node:assert/strict";
import test from "node:test";
import { AUTH_EMAIL, createSessionToken } from "@/lib/auth";
import {
  createInactiveRepSessionToken,
  INACTIVE_REPS_ALLOWED_EMAILS,
  inactiveRepAuthIsConfigured,
  isInactiveRepAllowedEmail,
  verifyInactiveRepSessionToken,
} from "@/lib/auth/inactive-reps";
import {
  generateInactiveRepOtpCode,
  hashInactiveRepOtpCode,
} from "@/lib/auth/inactive-reps-otp";
import { requestIsSameOrigin } from "@/lib/auth/request-origin";

const AUTH_ENV_KEYS = [
  "INACTIVE_REPS_AUTH_SECRET",
  "AUTH_SECRET",
] as const;

function preserveAuthEnv(): () => void {
  const previous = Object.fromEntries(AUTH_ENV_KEYS.map(key => [key, process.env[key]]));
  return () => {
    for (const key of AUTH_ENV_KEYS) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

test("inactive-rep auth only creates scoped sessions for the two approved reviewers", async () => {
  const restore = preserveAuthEnv();
  try {
    process.env.INACTIVE_REPS_AUTH_SECRET = "dedicated-inactive-rep-session-secret";
    process.env.AUTH_SECRET = "dedicated-inactive-rep-session-secret";

    assert.equal(inactiveRepAuthIsConfigured(), true);
    assert.deepEqual(INACTIVE_REPS_ALLOWED_EMAILS, [
      "jorgesalazar@noxpwr.com",
      "jonaslim@noxpwr.com",
      "admin@noxpwr.com",
    ]);
    assert.equal(isInactiveRepAllowedEmail("JORGE.SALAZAR@noxpwr.com"), false);
    assert.equal(isInactiveRepAllowedEmail(" JORGESALAZAR@NOXPWR.COM "), true);
    assert.equal(isInactiveRepAllowedEmail("jonaslim@noxpwr.com"), true);
    assert.equal(isInactiveRepAllowedEmail("admin@noxpwr.com"), true);
    assert.equal(isInactiveRepAllowedEmail(AUTH_EMAIL), false);

    for (const email of INACTIVE_REPS_ALLOWED_EMAILS) {
      const token = await createInactiveRepSessionToken(email);
      assert.deepEqual(await verifyInactiveRepSessionToken(token), { email });
    }
    await assert.rejects(
      createInactiveRepSessionToken("someone@noxpwr.com"),
      /not authorized/i,
    );

    const dashboardToken = await createSessionToken();
    assert.equal(await verifyInactiveRepSessionToken(dashboardToken), null);

    const token = await createInactiveRepSessionToken("jonaslim@noxpwr.com");
    process.env.INACTIVE_REPS_AUTH_SECRET = "different-secret";
    assert.equal(await verifyInactiveRepSessionToken(token), null);
  } finally {
    restore();
  }
});

test("inactive-rep auth fails closed when any dedicated setting is missing", async () => {
  const restore = preserveAuthEnv();
  try {
    for (const key of AUTH_ENV_KEYS) delete process.env[key];
    assert.equal(inactiveRepAuthIsConfigured(), false);
    assert.equal(await verifyInactiveRepSessionToken("invalid.token"), null);
    await assert.rejects(
      createInactiveRepSessionToken("jonaslim@noxpwr.com"),
      /not configured/i,
    );
  } finally {
    restore();
  }
});

test("inactive-rep OTP codes are six digits and hashed per challenge", async () => {
  const restore = preserveAuthEnv();
  try {
    process.env.INACTIVE_REPS_AUTH_SECRET = "dedicated-inactive-rep-session-secret";
    for (let index = 0; index < 25; index += 1) {
      assert.match(generateInactiveRepOtpCode(), /^\d{6}$/);
    }
    const first = await hashInactiveRepOtpCode("challenge-a", "123456");
    assert.match(first, /^[a-f0-9]{64}$/);
    assert.equal(first, await hashInactiveRepOtpCode("challenge-a", "123456"));
    assert.notEqual(first, await hashInactiveRepOtpCode("challenge-b", "123456"));
    assert.notEqual(first, await hashInactiveRepOtpCode("challenge-a", "654321"));
  } finally {
    restore();
  }
});

test("inactive-rep auth accepts the public request host and rejects cross-origin requests", () => {
  const sameOrigin = new Request("http://localhost:3001/api/inactive-reps/auth/request-code", {
    headers: {
      host: "127.0.0.1:3001",
      origin: "http://127.0.0.1:3001",
    },
  });
  const crossOrigin = new Request("https://internal-host/api/inactive-reps/auth/request-code", {
    headers: {
      "x-forwarded-host": "portal.noxpwr.com",
      "x-forwarded-proto": "https",
      origin: "https://attacker.example",
    },
  });

  assert.equal(requestIsSameOrigin(sameOrigin), true);
  assert.equal(requestIsSameOrigin(crossOrigin), false);
});
