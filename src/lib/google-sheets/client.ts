import { google, type sheets_v4 } from "googleapis";
import { env } from "@/lib/env";
import {
  AXIA_LAYOUT,
  headerRangeForLayout,
  rosterLayoutFromTabName,
  STANDARD_LAYOUT,
  type RosterTabLayout,
} from "@/lib/google-sheets/tab-layout";

export { AXIA_HEADERS as ROSTER_HEADERS } from "@/lib/google-sheets/tab-layout";

export function isGoogleServiceAccountConfigured(): boolean {
  return Boolean(
    env.googleServiceAccountEmail?.trim() &&
      env.googleServiceAccountPrivateKey?.trim(),
  );
}

export function isGoogleSheetsConfigured(): boolean {
  return Boolean(
    env.googleSheetsSpreadsheetId?.trim() && isGoogleServiceAccountConfigured(),
  );
}

function privateKeyPem(): string {
  const raw = env.googleServiceAccountPrivateKey?.trim();
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY is not set.");
  return raw.replace(/\\n/g, "\n");
}

export function getSpreadsheetId(): string {
  const id = env.googleSheetsSpreadsheetId?.trim();
  if (!id) throw new Error("GOOGLE_SHEETS_SPREADSHEET_ID is not set.");
  return id;
}

export function getTestTabName(): string {
  return env.googleSheetsTestTabName?.trim() || "Test Sync";
}

export function getProductionTabName(): string {
  return env.googleSheetsTabName?.trim() || "Axia";
}

export async function getSheetsClient(): Promise<sheets_v4.Sheets> {
  if (!isGoogleServiceAccountConfigured()) {
    throw new Error(
      "Google service account not configured. Set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY in .env.local.",
    );
  }

  const auth = new google.auth.JWT({
    email: env.googleServiceAccountEmail!.trim(),
    key: privateKeyPem(),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  return google.sheets({ version: "v4", auth });
}

export function spreadsheetTabUrl(spreadsheetId: string, gid: number): string {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${gid}`;
}

export async function getTabSheetGid(tabName: string): Promise<number | null> {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.get({
    spreadsheetId: getSpreadsheetId(),
    fields: "sheets.properties(title,sheetId)",
  });
  const match = res.data.sheets?.find(s => s.properties?.title === tabName);
  return match?.properties?.sheetId ?? null;
}

export async function listSpreadsheetTabs(): Promise<string[]> {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.get({
    spreadsheetId: getSpreadsheetId(),
    fields: "sheets.properties.title",
  });
  return (res.data.sheets ?? [])
    .map(s => s.properties?.title)
    .filter((t): t is string => Boolean(t));
}

export async function ensureTabExists(tabName: string): Promise<void> {
  const tabs = await listSpreadsheetTabs();
  if (tabs.includes(tabName)) return;

  const sheets = await getSheetsClient();
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: getSpreadsheetId(),
    requestBody: {
      requests: [{ addSheet: { properties: { title: tabName } } }],
    },
  });
}

export async function detectRosterTabLayout(tabName: string): Promise<RosterTabLayout> {
  return rosterLayoutFromTabName(tabName) ?? STANDARD_LAYOUT;
}

export async function ensureRosterHeaders(tabName: string, layout?: RosterTabLayout): Promise<RosterTabLayout> {
  const resolved = layout ?? (await detectRosterTabLayout(tabName));
  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const headerRange = headerRangeForLayout(tabName, resolved);

  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: headerRange,
  });

  const firstRow = existing.data.values?.[0];
  if (firstRow?.length && firstRow.some(cell => String(cell ?? "").trim())) {
    return resolved;
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: headerRange,
    valueInputOption: "RAW",
    requestBody: { values: [Array.from(resolved.headers)] },
  });

  return resolved;
}
