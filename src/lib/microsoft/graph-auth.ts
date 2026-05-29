import { env } from "@/lib/env";

let cachedToken: { accessToken: string; expiresAt: number } | null = null;

/** Drop cached token (e.g. after Azure permissions change). */
export function clearGraphAccessTokenCache(): void {
  cachedToken = null;
}

export function requireAzureConfig(): {
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
      "Microsoft Graph not configured. Set AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, and WELCOME_EMAIL_FROM."
    );
  }
  return { tenantId, clientId, clientSecret, from };
}

export function isAzureConfigured(): boolean {
  return Boolean(
    env.azureTenantId?.trim() &&
      env.azureClientId?.trim() &&
      env.azureClientSecret?.trim() &&
      env.welcomeEmailFrom?.trim()
  );
}

export async function getGraphAccessToken(): Promise<string> {
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
    const desc = data.error_description ?? data.error ?? "Unknown error";
    throw new Error(`Azure token request failed: ${desc}`);
  }

  cachedToken = {
    accessToken: data.access_token,
    expiresAt: now + (data.expires_in ?? 3600) * 1000,
  };
  return cachedToken.accessToken;
}

export const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
