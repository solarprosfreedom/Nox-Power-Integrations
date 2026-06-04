import { env } from "@/lib/env";
import {
  getGraphAccessToken,
  GRAPH_BASE,
  requireAzureConfig,
} from "@/lib/microsoft/graph-auth";

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
  to: string | string[];
  subject: string;
  body: string;
  contentType?: "text" | "html";
}): Promise<{ from: string; to: string[] }> {
  const { from } = requireAzureConfig();
  const to = (Array.isArray(options.to) ? options.to : [options.to])
    .map(address => address.trim())
    .filter(Boolean);
  if (!to.length) throw new Error("Recipient email is required");

  const token = await getGraphAccessToken();
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
        toRecipients: to.map(address => ({ emailAddress: { address } })),
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
