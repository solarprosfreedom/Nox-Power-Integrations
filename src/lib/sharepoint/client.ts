import { env } from "@/lib/env";
import { isAzureConfigured, GRAPH_BASE, getGraphAccessToken } from "@/lib/microsoft/graph-auth";

export function getSharePointSiteUrl(): string {
  const url = env.sharepointSiteUrl?.trim();
  if (!url) throw new Error("SHAREPOINT_SITE_URL is not set.");
  return url.replace(/\/$/, "");
}

export function getSharePointExcelPath(): string {
  const path = env.sharepointExcelPath?.trim();
  if (!path) throw new Error("SHAREPOINT_EXCEL_PATH is not set.");
  return path.replace(/^\/+/, "");
}

/** Graph paths to try — library root is drive root, not "Shared Documents/". */
function excelPathCandidates(configuredPath: string): string[] {
  const trimmed = configuredPath.trim().replace(/^\/+/, "");
  const candidates = new Set<string>();

  candidates.add(trimmed);

  const withoutSharedDocs = trimmed.replace(/^Shared Documents\//i, "");
  if (withoutSharedDocs !== trimmed) candidates.add(withoutSharedDocs);

  const fileName = trimmed.split("/").pop();
  if (fileName && fileName !== trimmed) candidates.add(fileName);

  return [...candidates];
}

async function resolveWorkbookItem(
  siteId: string,
  configuredPath: string,
): Promise<{ id: string; name: string; webUrl?: string; resolvedPath: string }> {
  const attempts: string[] = [];

  for (const path of excelPathCandidates(configuredPath)) {
    attempts.push(path);
    try {
      const item = await graphRequest<{ id: string; name: string; webUrl?: string }>(
        `/sites/${siteId}/drive/root:/${path}`,
      );
      return { ...item, resolvedPath: path };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (!message.includes("404") && !message.includes("itemNotFound")) {
        throw e;
      }
    }
  }

  throw new Error(
    `SharePoint workbook not found. Tried: ${attempts.join(", ")}. ` +
      `List files at the site drive root (Graph path is usually just the filename, not "Shared Documents/...").`,
  );
}

export function getSharePointTestWorksheetName(): string {
  return env.sharepointTestWorksheetName?.trim() || "LAZARUS";
}

export function isSharePointRosterConfigured(): boolean {
  return Boolean(
    isAzureConfigured() &&
      env.sharepointSiteUrl?.trim() &&
      env.sharepointExcelPath?.trim(),
  );
}

function parseSharePointSiteUrl(url: string): { hostname: string; sitePath: string } {
  const parsed = new URL(url);
  return {
    hostname: parsed.hostname,
    sitePath: parsed.pathname.replace(/\/$/, ""),
  };
}

function escapeWorksheetName(name: string): string {
  return name.replace(/'/g, "''");
}

async function graphRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getGraphAccessToken();
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph API ${init?.method ?? "GET"} ${path}: ${res.status} ${text}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export interface ResolvedWorkbook {
  siteId: string;
  itemId: string;
  fileName: string;
  webUrl: string | null;
}

let cachedWorkbook: ResolvedWorkbook | null = null;

export async function resolveWorkbook(): Promise<ResolvedWorkbook> {
  if (cachedWorkbook) return cachedWorkbook;

  const siteUrl = getSharePointSiteUrl();
  const excelPath = getSharePointExcelPath();
  const { hostname, sitePath } = parseSharePointSiteUrl(siteUrl);

  const site = await graphRequest<{ id: string }>(`/sites/${hostname}:${sitePath}`);
  const item = await resolveWorkbookItem(site.id, excelPath);

  cachedWorkbook = {
    siteId: site.id,
    itemId: item.id,
    fileName: item.name,
    webUrl: item.webUrl ?? null,
  };
  return cachedWorkbook;
}

function workbookPath(siteId: string, itemId: string, suffix: string): string {
  return `/sites/${siteId}/drive/items/${itemId}/workbook${suffix}`;
}

export async function listWorkbookWorksheets(): Promise<string[]> {
  const { siteId, itemId } = await resolveWorkbook();
  const data = await graphRequest<{ value?: Array<{ name?: string }> }>(
    workbookPath(siteId, itemId, "/worksheets"),
  );
  return data.value?.map(w => w.name ?? "").filter(Boolean) ?? [];
}

export async function readWorksheetColumn(
  worksheetName: string,
  column: string,
): Promise<string[]> {
  const { siteId, itemId } = await resolveWorkbook();
  const escaped = escapeWorksheetName(worksheetName);
  const data = await graphRequest<{ values?: string[][] }>(
    workbookPath(
      siteId,
      itemId,
      `/worksheets('${escaped}')/range(address='${column}:${column}')`,
    ),
  );
  return (data.values ?? []).map(row => String(row[0] ?? "").trim());
}

export async function getNextAppendRow(worksheetName: string): Promise<number> {
  const { siteId, itemId } = await resolveWorkbook();
  const escaped = escapeWorksheetName(worksheetName);

  try {
    const used = await graphRequest<{ rowIndex: number; rowCount: number }>(
      workbookPath(siteId, itemId, `/worksheets('${escaped}')/usedRange`),
    );
    return used.rowIndex + used.rowCount + 1;
  } catch {
    return 2;
  }
}

export async function appendRowsToWorksheet(
  worksheetName: string,
  rows: string[][],
  appendRange?: string,
): Promise<number> {
  if (rows.length === 0) return 0;

  const { siteId, itemId } = await resolveWorkbook();
  const escaped = escapeWorksheetName(worksheetName);
  const startRow = await getNextAppendRow(worksheetName);
  const endRow = startRow + rows.length - 1;
  const range = appendRange ?? "A:S";
  const [startCol, endCol] = range.includes(":") ? range.split(":") : ["A", "S"];
  const address = `${startCol}${startRow}:${endCol}${endRow}`;

  await graphRequest(
    workbookPath(siteId, itemId, `/worksheets('${escaped}')/range(address='${address}')`),
    {
      method: "PATCH",
      body: JSON.stringify({ values: rows }),
    },
  );

  return rows.length;
}
