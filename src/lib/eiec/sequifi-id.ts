import { env } from "@/lib/env";
import { sequifiFetch } from "@/lib/sequifi/fetch";

const ID_TYPE_ID = 2;
const ID_TYPE_NAME = /driver|passport|license/i;

function sequifiBase(): string {
  return (env.sequifiApiBaseUrl ?? "https://marketplace-api.sequifi.com").replace(/\/$/, "");
}

function sequifiBearer(): string {
  const token = env.sequifiAccessToken?.trim() || env.sequifiApiKey?.trim();
  if (!token) {
    throw new Error("Sequifi not configured. Set SEQUIFI_ACCESS_TOKEN.");
  }
  return token;
}

async function sequifiJson(path: string): Promise<Record<string, unknown>> {
  const res = await sequifiFetch(`${sequifiBase()}${path}`, {
    headers: { Authorization: `Bearer ${sequifiBearer()}`, Accept: "application/json" },
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(`Sequifi ${path} failed (${res.status})`);
  }
  return json;
}

export type SequifiIdFile = {
  documentId: string;
  fileName: string;
  bytes: Buffer;
  mimeType: string;
};

export async function downloadSequifiIdPhoto(userId: number): Promise<SequifiIdFile | null> {
  const listed = await sequifiJson(
    `/v1/documents?user_id=${userId}&user_id_from=users&per_page=50`,
  );
  const data = listed.data as { documents?: unknown[] } | undefined;
  const docs = (data?.documents ?? listed.documents ?? listed.data) as unknown;
  const arr = Array.isArray(docs) ? docs : [];
  const match = arr.find((item) => {
    if (!item || typeof item !== "object") return false;
    const doc = item as {
      id?: string;
      document_type_id?: number;
      document_type?: { id?: number; name?: string };
    };
    const typeId = doc.document_type?.id ?? doc.document_type_id;
    const typeName = String(doc.document_type?.name ?? "");
    return Number(typeId) === ID_TYPE_ID || ID_TYPE_NAME.test(typeName);
  }) as { id?: string; file_name?: string } | undefined;
  if (!match?.id) return null;

  const downloaded = await sequifiJson(`/v1/documents/${match.id}/download`);
  const payload = (downloaded.data ?? downloaded) as {
    download_url?: string;
    file_name?: string;
  };
  if (!payload.download_url) return null;

  const fileRes = await fetch(payload.download_url);
  if (!fileRes.ok) throw new Error(`ID download failed (${fileRes.status})`);
  const bytes = Buffer.from(await fileRes.arrayBuffer());
  const fileName = payload.file_name || String(match.file_name || "id");
  return {
    documentId: String(match.id),
    fileName,
    bytes,
    mimeType: guessMime(fileName, bytes, fileRes.headers.get("content-type")),
  };
}

function guessMime(fileName: string, bytes: Buffer, header: string | null): string {
  if (header && header.startsWith("image/")) return header.split(";")[0]!;
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  return "image/jpeg";
}
