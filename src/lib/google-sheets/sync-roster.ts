import { normalizeEmail } from "@/lib/onboarding/normalize";
import type { OnboardingJob, SequifiUserRecord } from "@/lib/onboarding/types";
import { fetchAllSequifiUsers, filterUsersByGoLive } from "@/lib/sequifi/client";
import {
  ensureRosterHeaders,
  ensureTabExists,
  getSheetsClient,
  getSpreadsheetId,
} from "@/lib/google-sheets/client";
import {
  manualRosterRowToSheetRow,
  sequifiUserToRosterRow,
  type ManualRosterRow,
  type RosterBuildContext,
} from "@/lib/google-sheets/roster-map";
import type { RosterTabLayout } from "@/lib/google-sheets/tab-layout";
import { destinationsForInstallerTabs } from "@/lib/onboarding/installer-registry";

export type { ManualRosterRow, RosterBuildContext };

export interface RosterSyncResult {
  tabName: string;
  spreadsheetId: string;
  polled: number;
  goLiveFiltered: number;
  alreadyInSheet: number;
  appended: number;
  skippedEmpty: number;
  sampleRows: Array<{ sequifiUserId: number; repName: string; personalEmail: string }>;
  error?: string;
}

function escapeSheetTab(tabName: string): string {
  return `'${tabName.replace(/'/g, "''")}'`;
}

async function readExistingDedupValues(tabName: string, layout: RosterTabLayout): Promise<Set<string>> {
  const sheets = await getSheetsClient();
  const col = layout.dedupColumn;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: getSpreadsheetId(),
    range: `${escapeSheetTab(tabName)}!${col}:${col}`,
  });

  const seen = new Set<string>();
  const headerLabels = new Set(
    ["personal email", "rep email", layout.headers[layout.dedupColumn.charCodeAt(0) - 65]?.toLowerCase()].filter(
      Boolean,
    ),
  );

  for (const row of res.data.values ?? []) {
    const value = String(row[0] ?? "").trim();
    if (!value || headerLabels.has(value.toLowerCase())) continue;
    seen.add(normalizeEmail(value));
  }
  return seen;
}

function dedupKeyForRow(row: string[], layout: RosterTabLayout): string {
  const index = layout.dedupColumn.charCodeAt(0) - 65;
  return normalizeEmail(String(row[index] ?? "").trim());
}

export async function syncSequifiUsersToRosterSheet(options: {
  tabName: string;
  applyGoLiveFilter?: boolean;
  limit?: number;
}): Promise<RosterSyncResult> {
  const { tabName, applyGoLiveFilter = true, limit } = options;
  const spreadsheetId = getSpreadsheetId();

  const allUsers = await fetchAllSequifiUsers();
  const goLiveFiltered = applyGoLiveFilter
    ? allUsers.length - filterUsersByGoLive(allUsers).length
    : 0;
  const users = applyGoLiveFilter ? filterUsersByGoLive(allUsers) : allUsers;

  await ensureTabExists(tabName);
  const layout = await ensureRosterHeaders(tabName);

  const existingEmails = await readExistingDedupValues(tabName, layout);
  const rowsToAppend: string[][] = [];
  const sampleRows: RosterSyncResult["sampleRows"] = [];
  let alreadyInSheet = 0;
  let skippedEmpty = 0;

  for (const user of users) {
    if (limit != null && rowsToAppend.length >= limit) break;

    const personalEmail = user.email.trim();
    if (!personalEmail) {
      skippedEmpty++;
      continue;
    }

    const normalized = normalizeEmail(personalEmail);
    if (existingEmails.has(normalized)) {
      alreadyInSheet++;
      continue;
    }

    const row = sequifiUserToRosterRow(user, layout);
    rowsToAppend.push(row);
    existingEmails.add(dedupKeyForRow(row, layout));

    if (sampleRows.length < 5) {
      sampleRows.push({
        sequifiUserId: user.id,
        repName: row[0] ?? "",
        personalEmail,
      });
    }
  }

  if (rowsToAppend.length > 0) {
    const sheets = await getSheetsClient();
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${escapeSheetTab(tabName)}!${layout.appendRange}`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: rowsToAppend },
    });
  }

  return {
    tabName,
    spreadsheetId,
    polled: allUsers.length,
    goLiveFiltered,
    alreadyInSheet,
    appended: rowsToAppend.length,
    skippedEmpty,
    sampleRows,
  };
}

export interface ManualAppendResult {
  tabName: string;
  spreadsheetId: string;
  appended: number;
  row: ManualRosterRow;
}

export interface SingleRosterAppendResult {
  tabName: string;
  spreadsheetId: string;
  appended: boolean;
  reason?: string;
  dedupKey?: string;
}

/** Build Sequifi user shape from a persisted onboarding job row. */
export function sequifiUserFromOnboardingJob(job: OnboardingJob): SequifiUserRecord {
  const raw = job.raw_sequifi_payload ?? {};
  return {
    id: Number(job.sequifi_user_id),
    employee_id: job.sequifi_employee_id,
    first_name: job.first_name ?? "",
    last_name: job.last_name ?? "",
    email: job.email,
    mobile_no: job.phone,
    position_name: job.role_label,
    office_name: typeof raw.office_name === "string" ? raw.office_name : null,
    raw,
  };
}

/** Append one Sequifi user to roster tab if dedup key not already present. */
export async function appendSequifiUserToRosterSheet(options: {
  tabName: string;
  user: SequifiUserRecord;
  layout?: RosterTabLayout;
  ctx?: RosterBuildContext;
}): Promise<SingleRosterAppendResult> {
  const { tabName, user, ctx } = options;
  const spreadsheetId = getSpreadsheetId();

  await ensureTabExists(tabName);
  const layout = options.layout ?? (await ensureRosterHeaders(tabName));

  const sheetRow = sequifiUserToRosterRow(user, layout, ctx);
  const dedupKey = dedupKeyForRow(sheetRow, layout);
  if (!dedupKey) {
    return { tabName, spreadsheetId, appended: false, reason: "empty dedup key" };
  }

  const existing = await readExistingDedupValues(tabName, layout);
  if (existing.has(dedupKey)) {
    return { tabName, spreadsheetId, appended: false, reason: "already in sheet", dedupKey };
  }

  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${escapeSheetTab(tabName)}!${layout.appendRange}`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [sheetRow] },
  });

  return { tabName, spreadsheetId, appended: true, dedupKey };
}

/** Append one user to multiple installer tabs (Google Sheets). */
export async function appendSequifiUserToInstallerRosterSheets(options: {
  tabNames: string[];
  user: SequifiUserRecord;
  ctx?: RosterBuildContext;
}): Promise<SingleRosterAppendResult[]> {
  const destinations = destinationsForInstallerTabs(options.tabNames);
  const results: SingleRosterAppendResult[] = [];

  for (const dest of destinations) {
    results.push(
      await appendSequifiUserToRosterSheet({
        tabName: dest.tabName,
        user: options.user,
        layout: dest.layout,
        ctx: {
          ...options.ctx,
          installerTabName: dest.tabName,
        },
      }),
    );
  }

  return results;
}

export async function appendManualRosterRow(options: {
  tabName: string;
  row: ManualRosterRow;
}): Promise<ManualAppendResult> {
  const { tabName, row } = options;
  const repName = row.repName.trim();
  if (!repName) {
    throw new Error("Rep Name is required.");
  }

  await ensureTabExists(tabName);
  const layout = await ensureRosterHeaders(tabName);

  const sheetRow = manualRosterRowToSheetRow(row, layout);
  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${escapeSheetTab(tabName)}!${layout.appendRange}`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [sheetRow] },
  });

  return {
    tabName,
    spreadsheetId,
    appended: 1,
    row,
  };
}

export async function testGoogleSheetsAccess(tabName: string): Promise<{
  ok: boolean;
  spreadsheetId: string;
  spreadsheetTitle: string;
  tabs: string[];
  tabName: string;
  tabExists: boolean;
  error?: string;
}> {
  const spreadsheetId = getSpreadsheetId();
  const sheets = await getSheetsClient();

  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "properties.title,sheets.properties.title",
  });

  const tabs =
    meta.data.sheets?.map(s => s.properties?.title).filter((t): t is string => Boolean(t)) ??
    [];

  return {
    ok: true,
    spreadsheetId,
    spreadsheetTitle: meta.data.properties?.title ?? "(untitled)",
    tabs,
    tabName,
    tabExists: tabs.includes(tabName),
  };
}
