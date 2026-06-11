import { env } from "@/lib/env";
import {
  getSheetsClient,
  isGoogleServiceAccountConfigured,
} from "@/lib/google-sheets/client";
import {
  INSTALL_SHEET_HEADERS,
  type InstallSheetHeader,
} from "@/lib/install-sheet/headers";

function escapeSheetTab(tabName: string): string {
  return `'${tabName.replace(/'/g, "''")}'`;
}

export function columnLetter(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function isInstallSheetsConfigured(): boolean {
  return Boolean(
    isGoogleServiceAccountConfigured() &&
      env.installSheetsSpreadsheetId?.trim() &&
      env.installSheetsTabName?.trim(),
  );
}

export function getInstallSpreadsheetId(): string {
  const id = env.installSheetsSpreadsheetId?.trim();
  if (!id) throw new Error("INSTALL_SHEETS_SPREADSHEET_ID is not set.");
  return id;
}

export function getInstallTabName(): string {
  const tab = env.installSheetsTabName?.trim();
  if (!tab) throw new Error("INSTALL_SHEETS_TAB_NAME is not set.");
  return tab;
}

export function getInstallSheetUrl(): string | null {
  const spreadsheetId = env.installSheetsSpreadsheetId?.trim();
  if (!spreadsheetId) return null;
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
}

export type HeaderIndexMap = Map<string, number>;

export function buildHeaderIndexMap(headerRow: string[]): HeaderIndexMap {
  const map = new Map<string, number>();
  headerRow.forEach((cell, index) => {
    const key = String(cell ?? "").trim();
    if (key) map.set(key, index);
  });
  return map;
}

export function getCell(
  row: string[],
  headerMap: HeaderIndexMap,
  header: InstallSheetHeader,
): string {
  const index = headerMap.get(header);
  if (index == null) return "";
  return String(row[index] ?? "").trim();
}

export interface InstallSheetDataRow {
  sheetRowNumber: number;
  values: Record<InstallSheetHeader, string>;
}

function rowHasData(values: Record<InstallSheetHeader, string>): boolean {
  return INSTALL_SHEET_HEADERS.some(header => values[header]?.trim());
}

export async function readInstallSheetRows(): Promise<{
  headerMap: HeaderIndexMap;
  rows: InstallSheetDataRow[];
}> {
  const sheets = await getSheetsClient();
  const spreadsheetId = getInstallSpreadsheetId();
  const tabName = getInstallTabName();
  const lastCol = columnLetter(INSTALL_SHEET_HEADERS.length - 1);

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${escapeSheetTab(tabName)}!A:${lastCol}`,
  });

  const allRows = res.data.values ?? [];
  if (allRows.length === 0) {
    return { headerMap: buildHeaderIndexMap([]), rows: [] };
  }

  const headerRow = (allRows[0] ?? []).map(cell => String(cell ?? "").trim());
  const headerMap = buildHeaderIndexMap(headerRow);
  const rows: InstallSheetDataRow[] = [];

  for (let i = 1; i < allRows.length; i++) {
    const raw = allRows[i] ?? [];
    const values = {} as Record<InstallSheetHeader, string>;
    for (const header of INSTALL_SHEET_HEADERS) {
      values[header] = getCell(raw, headerMap, header);
    }
    if (!rowHasData(values)) continue;
    rows.push({ sheetRowNumber: i + 1, values });
  }

  return { headerMap, rows };
}

export async function writeInstallSheetRowBack(
  sheetRowNumber: number,
  headerMap: HeaderIndexMap,
  fields: Partial<
    Record<
      | "Install_ID"
      | "Customer_ID"
      | "Sync_Status"
      | "Last_Synced_At"
      | "Sync_Error",
      string
    >
  >,
): Promise<void> {
  const sheets = await getSheetsClient();
  const spreadsheetId = getInstallSpreadsheetId();
  const tabName = getInstallTabName();
  const data: { range: string; values: string[][] }[] = [];

  for (const [header, value] of Object.entries(fields)) {
    const index = headerMap.get(header);
    if (index == null) continue;
    const col = columnLetter(index);
    data.push({
      range: `${escapeSheetTab(tabName)}!${col}${sheetRowNumber}`,
      values: [[value ?? ""]],
    });
  }

  if (data.length === 0) return;

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "RAW",
      data,
    },
  });
}

export async function appendInstallSheetTestRow(
  rowValues: string[],
): Promise<{ sheetRowNumber: number }> {
  const sheets = await getSheetsClient();
  const spreadsheetId = getInstallSpreadsheetId();
  const tabName = getInstallTabName();
  const lastCol = columnLetter(INSTALL_SHEET_HEADERS.length - 1);

  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${escapeSheetTab(tabName)}!A:A`,
  });
  const sheetRowNumber = Math.max(1, (existing.data.values ?? []).length) + 1;

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${escapeSheetTab(tabName)}!A${sheetRowNumber}:${lastCol}${sheetRowNumber}`,
    valueInputOption: "RAW",
    requestBody: { values: [rowValues] },
  });

  return { sheetRowNumber };
}
