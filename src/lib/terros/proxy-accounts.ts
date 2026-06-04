import { env } from "@/lib/env";
import {
  fetchTerrosAccountListPage,
  parseTerrosAccountRow,
  type TerrosSummary,
} from "@/lib/sync/terros-accounts";
import { resolveTerrosUserIdByEmail } from "@/lib/sync/terros-users";

export interface TerrosProxyAccountsResult {
  installerId: string;
  ownerEmail: string;
  ownerId: string;
  count: number;
  accounts: TerrosSummary[];
}

export type TerrosProxyAccountsError =
  | { code: "terros_not_configured" }
  | { code: "owner_not_found"; ownerEmail: string };

/** Account is in scope when the configured rep is owner or closer (setter). */
function accountMatchesTerrosUser(
  acc: Record<string, unknown>,
  userId: string,
): boolean {
  const owner = String(acc.ownerId ?? "").trim();
  const closer = String(acc.closerId ?? "").trim();
  return owner === userId || closer === userId;
}

function terrosBaseAndKey(): { base: string; key: string } | null {
  const key = env.terrosApiKey?.trim();
  if (!key) return null;
  const base = (env.terrosApiBaseUrl ?? "https://api.terros.com").replace(/\/$/, "");
  return { base, key };
}

export async function listAccountsForOwner(
  installerId: string,
  ownerEmail: string,
): Promise<
  | { ok: true; data: TerrosProxyAccountsResult }
  | { ok: false; error: TerrosProxyAccountsError }
> {
  const creds = terrosBaseAndKey();
  if (!creds) return { ok: false, error: { code: "terros_not_configured" } };

  const { base, key } = creds;
  const email = ownerEmail.trim().toLowerCase();

  const resolved = await resolveTerrosUserIdByEmail(base, key, email);
  const ownerId = resolved.userId?.trim() ?? "";
  if (!ownerId) {
    return { ok: false, error: { code: "owner_not_found", ownerEmail: email } };
  }

  const { raw } = await fetchTerrosAccountListPage(base, key, 1000, {
    userId: ownerId,
  });
  const filtered = raw.filter(acc => accountMatchesTerrosUser(acc, ownerId));

  const accounts = filtered
    .map(parseTerrosAccountRow)
    .filter((a): a is TerrosSummary => a !== null);

  return {
    ok: true,
    data: {
      installerId,
      ownerEmail: email,
      ownerId,
      count: accounts.length,
      accounts,
    },
  };
}
