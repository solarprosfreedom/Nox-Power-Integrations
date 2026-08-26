import { getGraphAccessToken, GRAPH_BASE } from "@/lib/microsoft/graph-auth";
import { EIEC_SHAREPOINT_FOLDER, EIEC_SHAREPOINT_SITE } from "@/lib/eiec/instant-app-screenshot";

export type EiecProcessedEntry = {
  at: string;
  name: string;
  eligible: boolean;
  reason?: string;
};

export type EiecProcessedLedger = {
  users: Record<string, EiecProcessedEntry>;
};

const LEDGER_NAME = "_eiec-processed.json";

async function siteId(): Promise<string> {
  const token = await getGraphAccessToken();
  const res = await fetch(`${GRAPH_BASE}/sites/${EIEC_SHAREPOINT_SITE}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = (await res.json()) as { id?: string; error?: { message?: string } };
  if (!res.ok || !json.id) {
    throw new Error(json.error?.message ?? `Graph site lookup failed (${res.status})`);
  }
  return json.id;
}

function itemUrl(id: string, relPath: string): string {
  return `${GRAPH_BASE}/sites/${id}/drive/root:/${encodeURIComponent(`${EIEC_SHAREPOINT_FOLDER}/${relPath}`)}`;
}

export async function loadProcessedLedger(): Promise<EiecProcessedLedger> {
  const token = await getGraphAccessToken();
  const id = await siteId();
  const res = await fetch(`${itemUrl(id, LEDGER_NAME)}:/content`, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: "follow",
  });
  if (res.status === 404) return { users: {} };
  if (!res.ok) throw new Error(`Read ${LEDGER_NAME} failed (${res.status})`);
  const json = (await res.json()) as EiecProcessedLedger;
  return { users: json.users ?? {} };
}

export async function saveProcessedLedger(ledger: EiecProcessedLedger): Promise<void> {
  await uploadTestFile(LEDGER_NAME, Buffer.from(JSON.stringify(ledger, null, 2), "utf8"), "application/json");
}

export async function uploadTestFile(
  relPath: string,
  body: Buffer,
  contentType: string,
): Promise<{ name: string; webUrl: string | null }> {
  const token = await getGraphAccessToken();
  const id = await siteId();
  const res = await fetch(`${itemUrl(id, relPath)}:/content`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": contentType,
    },
    body: new Uint8Array(body),
  });
  const json = (await res.json()) as {
    name?: string;
    webUrl?: string;
    error?: { message?: string };
  };
  if (!res.ok || !json.name) {
    throw new Error(json.error?.message ?? `Upload ${relPath} failed (${res.status})`);
  }
  return { name: json.name, webUrl: json.webUrl ?? null };
}

export function safeRepFolderName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim() || "Unknown Rep";
}

/** Eligible-only folders. Suffix only when Sequifi home address does not match the ID. */
export function eiecEligibleFolderName(
  name: string,
  addressMatchesId?: boolean | null,
): string {
  const base = safeRepFolderName(name);
  if (addressMatchesId === false) return `${base} (address not match)`;
  return base;
}
