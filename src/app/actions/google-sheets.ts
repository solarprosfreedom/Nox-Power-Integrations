"use server";

import { env } from "@/lib/env";
import {
  getProductionTabName,
  getTabSheetGid,
  getTestTabName,
  isGoogleSheetsConfigured,
  spreadsheetTabUrl,
} from "@/lib/google-sheets/client";
import type { ManualRosterRow } from "@/lib/google-sheets/roster-map";
import {
  appendManualRosterRow,
  syncSequifiUsersToRosterSheet,
  testGoogleSheetsAccess,
  type RosterSyncResult,
} from "@/lib/google-sheets/sync-roster";

export async function getGoogleSheetsConfig() {
  const spreadsheetId = env.googleSheetsSpreadsheetId?.trim() ?? null;
  const testTabName = getTestTabName();
  let testTabUrl: string | null = null;
  if (spreadsheetId && isGoogleSheetsConfigured()) {
    try {
      const gid = await getTabSheetGid(testTabName);
      if (gid != null) {
        testTabUrl = spreadsheetTabUrl(spreadsheetId, gid);
      }
    } catch {
      // ignore — tab may not exist until first sync
    }
  }

  return {
    configured: isGoogleSheetsConfigured(),
    spreadsheetId,
    testTabName,
    testTabUrl,
    productionTabName: getProductionTabName(),
    sequifiConfigured: Boolean(
      env.sequifiAccessToken?.trim() || env.sequifiApiKey?.trim(),
    ),
  };
}

export async function testGoogleSheetsConnection(): Promise<
  Awaited<ReturnType<typeof testGoogleSheetsAccess>> | { ok: false; error: string }
> {
  try {
    return await testGoogleSheetsAccess(getTestTabName());
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function appendManualRowToTestSheet(row: ManualRosterRow) {
  try {
    return await appendManualRosterRow({ tabName: getTestTabName(), row });
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function syncSequifiRosterToTestSheet(options?: {
  limit?: number;
  applyGoLiveFilter?: boolean;
}): Promise<RosterSyncResult | { error: string }> {
  try {
    return await syncSequifiUsersToRosterSheet({
      tabName: getTestTabName(),
      limit: options?.limit,
      applyGoLiveFilter: options?.applyGoLiveFilter ?? true,
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
