"use server";

import { env } from "@/lib/env";
import {
  getSharePointSiteUrl,
  getSharePointTestWorksheetName,
  isSharePointRosterConfigured,
} from "@/lib/sharepoint/client";
import type { ManualRosterRow } from "@/lib/google-sheets/roster-map";
import {
  appendManualRosterRowToSharePoint,
  syncSequifiUsersToSharePointRoster,
  testSharePointRosterAccess,
  type SharePointRosterSyncResult,
} from "@/lib/sharepoint/sync-roster";

export async function getSharePointRosterConfig() {
  let fileUrl: string | null = null;
  if (isSharePointRosterConfigured()) {
    try {
      const test = await testSharePointRosterAccess();
      fileUrl = test.webUrl;
    } catch {
      try {
        const siteUrl = getSharePointSiteUrl();
        const path = env.sharepointExcelPath?.trim() ?? "";
        fileUrl = `${siteUrl}/${path.split("/").map(encodeURIComponent).join("/")}`;
      } catch {
        // ignore
      }
    }
  }

  return {
    configured: isSharePointRosterConfigured(),
    siteUrl: env.sharepointSiteUrl?.trim() ?? null,
    excelPath: env.sharepointExcelPath?.trim() ?? null,
    testWorksheetName: getSharePointTestWorksheetName(),
    fileUrl,
    sequifiConfigured: Boolean(
      env.sequifiAccessToken?.trim() || env.sequifiApiKey?.trim(),
    ),
  };
}

export async function testSharePointRosterConnection(): Promise<
  Awaited<ReturnType<typeof testSharePointRosterAccess>> | { ok: false; error: string }
> {
  try {
    return await testSharePointRosterAccess();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function appendManualRowToSharePointTestSheet(row: ManualRosterRow) {
  try {
    return await appendManualRosterRowToSharePoint({ row });
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function syncSequifiRosterToSharePointTestSheet(options?: {
  limit?: number;
  applyGoLiveFilter?: boolean;
}): Promise<SharePointRosterSyncResult | { error: string }> {
  try {
    return await syncSequifiUsersToSharePointRoster({
      limit: options?.limit,
      applyGoLiveFilter: options?.applyGoLiveFilter ?? true,
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
