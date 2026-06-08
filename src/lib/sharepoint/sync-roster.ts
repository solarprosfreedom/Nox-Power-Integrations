import { normalizeEmail } from "@/lib/onboarding/normalize";
import type { SequifiUserRecord } from "@/lib/onboarding/types";
import { fetchAllSequifiUsers, filterUsersByGoLive } from "@/lib/sequifi/client";
import type { ManualRosterRow, RosterBuildContext } from "@/lib/google-sheets/roster-map";
import {
  appendRowsToWorksheet,
  getSharePointTestWorksheetName,
  isSharePointRosterConfigured,
  listWorkbookWorksheets,
  readWorksheetColumn,
  resolveWorkbook,
} from "@/lib/sharepoint/client";
import { sharePointLayoutFromWorksheet } from "@/lib/sharepoint/tab-layout";
import {
  manualRosterRowToSharePointRow,
  sequifiUserToSharePointRow,
} from "@/lib/sharepoint/roster-map";
import { destinationsForInstallerTabs } from "@/lib/onboarding/installer-registry";
import type { RosterTabLayout } from "@/lib/google-sheets/tab-layout";

export type { ManualRosterRow, RosterBuildContext };

export interface SharePointRosterSyncResult {
  worksheetName: string;
  fileName: string;
  webUrl: string | null;
  polled: number;
  goLiveFiltered: number;
  alreadyInSheet: number;
  appended: number;
  skippedEmpty: number;
  sampleRows: Array<{ sequifiUserId: number; repName: string; personalEmail: string }>;
  error?: string;
}

export interface SharePointSingleAppendResult {
  worksheetName: string;
  appended: boolean;
  reason?: string;
  dedupKey?: string;
}

async function readExistingDedupValues(
  worksheetName: string,
  layout: RosterTabLayout,
): Promise<Set<string>> {
  const values = await readWorksheetColumn(worksheetName, layout.dedupColumn);
  const seen = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    const lower = value.toLowerCase();
    if (lower === "personal email" || lower === "rep email") continue;
    seen.add(normalizeEmail(value));
  }
  return seen;
}

function dedupKeyFromRow(row: string[], layout: RosterTabLayout): string {
  const index = layout.dedupColumn.charCodeAt(0) - 65;
  return normalizeEmail(String(row[index] ?? "").trim());
}

export async function syncSequifiUsersToSharePointRoster(options: {
  worksheetName?: string;
  applyGoLiveFilter?: boolean;
  limit?: number;
}): Promise<SharePointRosterSyncResult> {
  const worksheetName = options.worksheetName ?? getSharePointTestWorksheetName();
  const { applyGoLiveFilter = true, limit } = options;
  const { fileName, webUrl } = await resolveWorkbook();

  const worksheets = await listWorkbookWorksheets();
  if (!worksheets.includes(worksheetName)) {
    throw new Error(
      `Worksheet "${worksheetName}" not found in "${fileName}". Available: ${worksheets.slice(0, 12).join(", ")}${worksheets.length > 12 ? "…" : ""}`,
    );
  }

  const layout = sharePointLayoutFromWorksheet(worksheetName);
  const allUsers = await fetchAllSequifiUsers();
  const goLiveFiltered = applyGoLiveFilter
    ? allUsers.length - filterUsersByGoLive(allUsers).length
    : 0;
  const users = applyGoLiveFilter ? filterUsersByGoLive(allUsers) : allUsers;

  const existingEmails = await readExistingDedupValues(worksheetName, layout);
  const rowsToAppend: string[][] = [];
  const sampleRows: SharePointRosterSyncResult["sampleRows"] = [];
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

    const row = sequifiUserToSharePointRow(user, worksheetName);
    rowsToAppend.push(row);
    existingEmails.add(dedupKeyFromRow(row, layout));

    if (sampleRows.length < 5) {
      sampleRows.push({
        sequifiUserId: user.id,
        repName: row[0] ?? "",
        personalEmail,
      });
    }
  }

  const appended = await appendRowsToWorksheet(worksheetName, rowsToAppend, layout.appendRange, {
    headerRow: layout.headerRow,
  });

  return {
    worksheetName,
    fileName,
    webUrl,
    polled: allUsers.length,
    goLiveFiltered,
    alreadyInSheet,
    appended,
    skippedEmpty,
    sampleRows,
  };
}

export async function appendSequifiUserToSharePointRoster(options: {
  worksheetName: string;
  user: SequifiUserRecord;
  ctx?: RosterBuildContext;
}): Promise<SharePointSingleAppendResult> {
  if (!isSharePointRosterConfigured()) {
    return { worksheetName: options.worksheetName, appended: false, reason: "sharepoint not configured" };
  }

  const { worksheetName, user, ctx } = options;
  const worksheets = await listWorkbookWorksheets();
  if (!worksheets.includes(worksheetName)) {
    return { worksheetName, appended: false, reason: "worksheet not found" };
  }

  const layout = sharePointLayoutFromWorksheet(worksheetName);
  const row = sequifiUserToSharePointRow(user, worksheetName, ctx);
  const dedupKey = dedupKeyFromRow(row, layout);
  if (!dedupKey) {
    return { worksheetName, appended: false, reason: "empty dedup key" };
  }

  const existing = await readExistingDedupValues(worksheetName, layout);
  if (existing.has(dedupKey)) {
    return { worksheetName, appended: false, reason: "already in sheet", dedupKey };
  }

  await appendRowsToWorksheet(worksheetName, [row], layout.appendRange, {
    headerRow: layout.headerRow,
  });
  return { worksheetName, appended: true, dedupKey };
}

export async function appendSequifiUserToInstallerSharePointRosters(options: {
  tabNames: string[];
  user: SequifiUserRecord;
  ctx?: RosterBuildContext;
}): Promise<SharePointSingleAppendResult[]> {
  const destinations = destinationsForInstallerTabs(options.tabNames);
  const results: SharePointSingleAppendResult[] = [];

  for (const dest of destinations) {
    results.push(
      await appendSequifiUserToSharePointRoster({
        worksheetName: dest.tabName,
        user: options.user,
        ctx: options.ctx,
      }),
    );
  }

  return results;
}

export interface SharePointManualAppendResult {
  worksheetName: string;
  fileName: string;
  webUrl: string | null;
  appended: number;
  row: ManualRosterRow;
}

export async function appendManualRosterRowToSharePoint(options: {
  worksheetName?: string;
  row: ManualRosterRow;
}): Promise<SharePointManualAppendResult> {
  const worksheetName = options.worksheetName ?? getSharePointTestWorksheetName();
  const { row } = options;
  const repName = row.repName.trim();
  if (!repName) {
    throw new Error("Rep Name is required.");
  }

  const worksheets = await listWorkbookWorksheets();
  if (!worksheets.includes(worksheetName)) {
    throw new Error(`Worksheet "${worksheetName}" not found.`);
  }

  const layout = sharePointLayoutFromWorksheet(worksheetName);
  const sheetRow = manualRosterRowToSharePointRow(row, layout);
  const { fileName, webUrl } = await resolveWorkbook();
  const appended = await appendRowsToWorksheet(worksheetName, [sheetRow], layout.appendRange, {
    headerRow: layout.headerRow,
  });

  return {
    worksheetName,
    fileName,
    webUrl,
    appended,
    row,
  };
}

export async function testSharePointRosterAccess(worksheetName?: string): Promise<{
  ok: boolean;
  fileName: string;
  webUrl: string | null;
  worksheets: string[];
  worksheetName: string;
  worksheetExists: boolean;
  error?: string;
}> {
  const tab = worksheetName ?? getSharePointTestWorksheetName();
  const { fileName, webUrl } = await resolveWorkbook();
  const worksheets = await listWorkbookWorksheets();

  return {
    ok: true,
    fileName,
    webUrl,
    worksheets,
    worksheetName: tab,
    worksheetExists: worksheets.includes(tab),
  };
}

export { isSharePointRosterConfigured };
