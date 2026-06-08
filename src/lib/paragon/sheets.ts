import { env } from "@/lib/env";
import { getSheetsClient, isGoogleSheetsConfigured, spreadsheetTabUrl } from "@/lib/google-sheets/client";
import { PARAGON_SHEET_HEADERS } from "@/lib/paragon/map-install";

function escapeSheetTab(tabName: string): string {
  return `'${tabName.replace(/'/g, "''")}'`;
}

export function isParagonSheetsConfigured(): boolean {
  return Boolean(
    isGoogleSheetsConfigured() &&
      env.paragonSheetsSpreadsheetId?.trim() &&
      env.paragonSheetsTabName?.trim(),
  );
}

export function getParagonSpreadsheetId(): string {
  const id = env.paragonSheetsSpreadsheetId?.trim();
  if (!id) throw new Error("PARAGON_SHEETS_SPREADSHEET_ID is not set.");
  return id;
}

export function getParagonTabName(): string {
  const tab = env.paragonSheetsTabName?.trim();
  if (!tab) throw new Error("PARAGON_SHEETS_TAB_NAME is not set.");
  return tab;
}

export function getParagonSheetUrl(): string | null {
  const spreadsheetId = env.paragonSheetsSpreadsheetId?.trim();
  if (!spreadsheetId) return null;
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
}

const EXTERNAL_ID_HEADER_ALIASES = new Set([
  "external_id",
  "external id",
  "client_id",
  "customer_id",
  "id",
  "ref",
  "account_id",
]);

export async function readExistingParagonExternalIds(): Promise<Set<string>> {
  const sheets = await getSheetsClient();
  const spreadsheetId = getParagonSpreadsheetId();
  const tabName = getParagonTabName();

  const headerRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${escapeSheetTab(tabName)}!1:1`,
  });
  const headerRow = headerRes.data.values?.[0] ?? [];
  let externalIdColIndex = headerRow.findIndex(cell => {
    const label = String(cell ?? "").trim().toLowerCase();
    return EXTERNAL_ID_HEADER_ALIASES.has(label) || label === "external_id";
  });
  if (externalIdColIndex < 0) {
    externalIdColIndex = 1;
  }

  const colLetter = String.fromCharCode("A".charCodeAt(0) + externalIdColIndex);
  const colRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${escapeSheetTab(tabName)}!${colLetter}:${colLetter}`,
  });

  const seen = new Set<string>();
  for (const row of colRes.data.values ?? []) {
    const value = String(row[0] ?? "").trim();
    if (!value) continue;
    if (EXTERNAL_ID_HEADER_ALIASES.has(value.toLowerCase())) continue;
    seen.add(value);
  }
  return seen;
}

export async function appendParagonRows(rows: string[][]): Promise<void> {
  if (rows.length === 0) return;

  const sheets = await getSheetsClient();
  const spreadsheetId = getParagonSpreadsheetId();
  const tabName = getParagonTabName();

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${escapeSheetTab(tabName)}!A:H`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: rows },
  });
}

export async function ensureParagonHeaders(): Promise<void> {
  const sheets = await getSheetsClient();
  const spreadsheetId = getParagonSpreadsheetId();
  const tabName = getParagonTabName();
  const range = `${escapeSheetTab(tabName)}!A1:H1`;

  const existing = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  const firstRow = existing.data.values?.[0];
  if (firstRow?.length && firstRow.some(cell => String(cell ?? "").trim())) {
    return;
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: "RAW",
    requestBody: { values: [Array.from(PARAGON_SHEET_HEADERS)] },
  });
}

export { spreadsheetTabUrl };
