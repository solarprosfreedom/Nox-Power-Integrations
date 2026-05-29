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
} from "@/lib/google-sheets/roster-map";
import { detectRosterTabLayout } from "@/lib/google-sheets/client";

export type { ManualRosterRow };

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

async function readExistingPersonalEmails(tabName: string): Promise<Set<string>> {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: getSpreadsheetId(),
    range: `${escapeSheetTab(tabName)}!D:D`,
  });

  const seen = new Set<string>();
  for (const row of res.data.values ?? []) {
    const email = String(row[0] ?? "").trim();
    if (email && email.toLowerCase() !== "personal email") {
      seen.add(normalizeEmail(email));
    }
  }
  return seen;
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
  await ensureRosterHeaders(tabName);
  const layout = await detectRosterTabLayout(tabName);

  const existingEmails = await readExistingPersonalEmails(tabName);
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
    existingEmails.add(normalized);

    if (sampleRows.length < 5) {
      sampleRows.push({
        sequifiUserId: user.id,
        repName: layout.hasRepIdColumn ? (row[1] ?? "") : (row[0] ?? ""),
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
  personalEmail?: string;
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

/** Append one Sequifi user to roster tab if Personal Email not already present. */
export async function appendSequifiUserToRosterSheet(options: {
  tabName: string;
  user: SequifiUserRecord;
}): Promise<SingleRosterAppendResult> {
  const { tabName, user } = options;
  const spreadsheetId = getSpreadsheetId();
  const personalEmail = user.email.trim();

  if (!personalEmail) {
    return { tabName, spreadsheetId, appended: false, reason: "empty personal email" };
  }

  await ensureTabExists(tabName);
  await ensureRosterHeaders(tabName);
  const layout = await detectRosterTabLayout(tabName);

  const existingEmails = await readExistingPersonalEmails(tabName);
  const normalized = normalizeEmail(personalEmail);
  if (existingEmails.has(normalized)) {
    return {
      tabName,
      spreadsheetId,
      appended: false,
      reason: "already in sheet",
      personalEmail,
    };
  }

  const sheetRow = sequifiUserToRosterRow(user, layout);
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${escapeSheetTab(tabName)}!${layout.appendRange}`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [sheetRow] },
  });

  return { tabName, spreadsheetId, appended: true, personalEmail };
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
  await ensureRosterHeaders(tabName);
  const layout = await detectRosterTabLayout(tabName);

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
