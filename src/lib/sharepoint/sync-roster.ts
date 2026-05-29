import { normalizeEmail } from "@/lib/onboarding/normalize";
import type { SequifiUserRecord } from "@/lib/onboarding/types";
import { fetchAllSequifiUsers, filterUsersByGoLive } from "@/lib/sequifi/client";
import type { ManualRosterRow } from "@/lib/google-sheets/roster-map";
import {
  appendRowsToWorksheet,
  getSharePointTestWorksheetName,
  listWorkbookWorksheets,
  readWorksheetColumn,
  resolveWorkbook,
} from "@/lib/sharepoint/client";
import { LAZARUS_LAYOUT } from "@/lib/sharepoint/tab-layout";
import {
  manualRosterRowToSharePointRow,
  sequifiUserToSharePointRow,
} from "@/lib/sharepoint/roster-map";

export type { ManualRosterRow };

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

async function readExistingPersonalEmails(worksheetName: string): Promise<Set<string>> {
  const values = await readWorksheetColumn(worksheetName, LAZARUS_LAYOUT.personalEmailColumn);
  const seen = new Set<string>();
  for (const email of values) {
    if (email && email.toLowerCase() !== "personal email") {
      seen.add(normalizeEmail(email));
    }
  }
  return seen;
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

  const allUsers = await fetchAllSequifiUsers();
  const goLiveFiltered = applyGoLiveFilter
    ? allUsers.length - filterUsersByGoLive(allUsers).length
    : 0;
  const users = applyGoLiveFilter ? filterUsersByGoLive(allUsers) : allUsers;

  const existingEmails = await readExistingPersonalEmails(worksheetName);
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

    const row = sequifiUserToSharePointRow(user);
    rowsToAppend.push(row);
    existingEmails.add(normalized);

    if (sampleRows.length < 5) {
      sampleRows.push({
        sequifiUserId: user.id,
        repName: row[2] ?? "",
        personalEmail,
      });
    }
  }

  const appended = await appendRowsToWorksheet(worksheetName, rowsToAppend);

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

  const sheetRow = manualRosterRowToSharePointRow(row);
  const { fileName, webUrl } = await resolveWorkbook();
  const appended = await appendRowsToWorksheet(worksheetName, [sheetRow]);

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
