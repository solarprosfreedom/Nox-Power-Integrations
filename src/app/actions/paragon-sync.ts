"use server";

import { env } from "@/lib/env";
import { isParagonSheetsConfigured, getParagonSheetUrl } from "@/lib/paragon/sheets";
import {
  previewParagonDeals,
  syncParagonDeals,
  type ParagonSyncResult,
} from "@/lib/paragon/sync-deals";

export type ParagonSyncConfig = {
  configured: boolean;
  enerfloConfigured: boolean;
  spreadsheetId: string | null;
  tabName: string | null;
  sheetUrl: string | null;
  syncEnabled: boolean;
  serviceAccountEmail: string | null;
};

export async function getParagonSyncConfig(): Promise<ParagonSyncConfig> {
  return {
    configured: isParagonSheetsConfigured(),
    enerfloConfigured: Boolean(env.enerfloV1ApiKey?.trim()),
    spreadsheetId: env.paragonSheetsSpreadsheetId?.trim() ?? null,
    tabName: env.paragonSheetsTabName?.trim() ?? null,
    sheetUrl: getParagonSheetUrl(),
    syncEnabled: env.paragonSyncEnabled,
    serviceAccountEmail: env.googleServiceAccountEmail?.trim() ?? null,
  };
}

export async function previewParagonSync(): Promise<ParagonSyncResult> {
  return previewParagonDeals();
}

export async function runParagonSync(options?: {
  limit?: number;
}): Promise<ParagonSyncResult> {
  return syncParagonDeals({ dryRun: false, limit: options?.limit });
}
