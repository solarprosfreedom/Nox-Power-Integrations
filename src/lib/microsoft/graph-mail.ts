import { env } from "@/lib/env";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

let cachedToken: { accessToken: string; expiresAt: number } | null = null;

function formatAzureTokenError(data: {
  error?: string;
  error_description?: string;
}): string {
  const desc = data.error_description ?? data.error ?? "Unknown error";
  if (desc.includes("AADSTS700016")) {
    return (
      "Azure app not found in your Nox Power LLC tenant. In Azure Portal (signed into Nox Power LLC): " +
      "Entra ID → App registrations → open Middleware-welcome-email → copy Application (client) ID into AZURE_CLIENT_ID. " +
      "If the app is missing, register it again in that tenant and update .env.local, then restart npm run dev."
    );
  }
  if (
    desc.includes("AADSTS7000215") ||
    desc.includes("invalid_client") ||
    desc.includes("Invalid client secret")
  ) {
    return (
      "Invalid Azure client secret. In App registrations → Certificates & secrets → New client secret, " +
      "copy the Value (not Secret ID) into AZURE_CLIENT_SECRET, then restart npm run dev."
    );
  }
  if (desc.includes("AADSTS65001") || desc.includes("insufficient privileges")) {
    return (
      "Mail.Send permission missing or not consented. App registrations → API permissions → " +
      "Microsoft Graph → Application → Mail.Send → Grant admin consent."
    );
  }
  return `Azure token request failed: ${desc}`;
}

function decodeJwtPayload(token: string): { roles?: string[] } {
  const part = token.split(".")[1];
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

function assertMailSendPermission(token: string): void {
  const roles = decodeJwtPayload(token).roles ?? [];
  // #region agent log
  fetch("http://127.0.0.1:7264/ingest/a82f0243-aefe-466b-aacd-9b45cf8eb5d9", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "7c98bc" },
    body: JSON.stringify({
      sessionId: "7c98bc",
      runId: "post-fix",
      hypothesisId: "H1",
      location: "graph-mail.ts:assertMailSendPermission",
      message: "token application roles",
      data: { roles, hasMailSend: roles.includes("Mail.Send") },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
  if (!roles.includes("Mail.Send")) {
    throw new Error(
      "Mail.Send is missing from your Azure app token. In Azure Portal → App registrations → " +
        "Middleware-welcome-email → API permissions → Add permission → Microsoft Graph → " +
        "Application permissions → Mail.Send → Add → then click Grant admin consent for Nox Power LLC. " +
        "Restart npm run dev and try again."
    );
  }
}

function formatGraphSendError(status: number, detail: string): string {
  if (status === 403) {
    return (
      `Graph sendMail denied (403): ${detail}. If Mail.Send is already added, check Exchange application ` +
      "access policies or confirm admin@noxpwr.com has an Exchange license."
    );
  }
  return `Graph sendMail failed (${status}): ${detail}`;
}

function requireAzureConfig(): {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  from: string;
} {
  const tenantId = env.azureTenantId?.trim();
  const clientId = env.azureClientId?.trim();
  const clientSecret = env.azureClientSecret?.trim();
  const from = env.welcomeEmailFrom?.trim();
  if (!tenantId || !clientId || !clientSecret || !from) {
    throw new Error(
      "Microsoft Graph not configured. Set AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, and WELCOME_EMAIL_FROM in .env.local."
    );
  }
  return { tenantId, clientId, clientSecret, from };
}

async function getAccessToken(): Promise<string> {
  const { tenantId, clientId, clientSecret } = requireAzureConfig();
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) {
    return cachedToken.accessToken;
  }

  const url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });

  // #region agent log
  fetch("http://127.0.0.1:7264/ingest/a82f0243-aefe-466b-aacd-9b45cf8eb5d9", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "7c98bc" },
    body: JSON.stringify({
      sessionId: "7c98bc",
      runId: "pre-fix",
      hypothesisId: "H1-H4",
      location: "graph-mail.ts:getAccessToken",
      message: "token request params",
      data: {
        tenantId,
        clientId,
        clientIdLen: clientId.length,
        secretLen: clientSecret.length,
        tokenUrl: url,
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const data = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (!res.ok || !data.access_token) {
    // #region agent log
    fetch("http://127.0.0.1:7264/ingest/a82f0243-aefe-466b-aacd-9b45cf8eb5d9", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "7c98bc" },
      body: JSON.stringify({
        sessionId: "7c98bc",
        runId: "pre-fix",
        hypothesisId: "H1-H5",
        location: "graph-mail.ts:getAccessToken:error",
        message: "token request failed",
        data: {
          status: res.status,
          error: data.error ?? null,
          errorCode: data.error_description?.match(/AADSTS\d+/)?.[0] ?? null,
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    throw new Error(formatAzureTokenError(data));
  }

  cachedToken = {
    accessToken: data.access_token,
    expiresAt: now + (data.expires_in ?? 3600) * 1000,
  };
  return cachedToken.accessToken;
}

export function getWelcomeEmailFrom(): string | undefined {
  return env.welcomeEmailFrom?.trim() || undefined;
}

export function isGraphMailConfigured(): boolean {
  return Boolean(
    env.azureTenantId?.trim() &&
      env.azureClientId?.trim() &&
      env.azureClientSecret?.trim() &&
      env.welcomeEmailFrom?.trim()
  );
}

export async function sendMailAsUser(options: {
  to: string;
  subject: string;
  body: string;
  contentType?: "text" | "html";
}): Promise<{ from: string; to: string }> {
  const { from } = requireAzureConfig();
  const to = options.to.trim();
  if (!to) throw new Error("Recipient email is required");

  const token = await getAccessToken();
  assertMailSendPermission(token);
  const contentType = options.contentType === "html" ? "HTML" : "Text";

  const res = await fetch(`${GRAPH_BASE}/users/${encodeURIComponent(from)}/sendMail`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: {
        subject: options.subject,
        body: {
          contentType,
          content: options.body,
        },
        toRecipients: [{ emailAddress: { address: to } }],
      },
      saveToSentItems: true,
    }),
  });

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const err = (await res.json()) as { error?: { message?: string } };
      detail = err.error?.message ?? detail;
    } catch {
      /* ignore */
    }
    throw new Error(formatGraphSendError(res.status, detail));
  }

  return { from, to };
}
