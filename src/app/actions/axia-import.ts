"use server";

import { env } from "@/lib/env";
import {
  appendInstallSheetTestRow,
  getInstallSheetUrl,
  isInstallSheetsConfigured,
} from "@/lib/install-sheet/sheets";
import {
  buildTestRowValues,
  resolveInstallSheetAssignToEmail,
} from "@/lib/install-sheet/map-row";
import {
  previewInstallSheetSync,
  syncInstallSheet,
  type InstallSheetSyncResult,
} from "@/lib/install-sheet/sync";

export type AxiaImportConfig = {
  configured: boolean;
  enerfloConfigured: boolean;
  surveyTypeConfigured: boolean;
  spreadsheetId: string | null;
  tabName: string | null;
  sheetUrl: string | null;
  syncEnabled: boolean;
  surveyTypeId: string | null;
  serviceAccountEmail: string | null;
  assignToEmail: string;
};

export async function getAxiaImportConfig(): Promise<AxiaImportConfig> {
  return {
    configured: isInstallSheetsConfigured(),
    enerfloConfigured: Boolean(env.enerfloV1ApiKey?.trim()),
    surveyTypeConfigured: Boolean(env.enerfloSurveyTypeId?.trim()),
    spreadsheetId: env.installSheetsSpreadsheetId?.trim() ?? null,
    tabName: env.installSheetsTabName?.trim() ?? null,
    sheetUrl: getInstallSheetUrl(),
    syncEnabled: env.installSheetSyncEnabled,
    surveyTypeId: env.enerfloSurveyTypeId?.trim() ?? null,
    serviceAccountEmail: env.googleServiceAccountEmail?.trim() ?? null,
    assignToEmail: resolveInstallSheetAssignToEmail(),
  };
}

export async function previewAxiaImport(options?: {
  limit?: number;
}): Promise<InstallSheetSyncResult> {
  return previewInstallSheetSync(options);
}

export async function runAxiaImport(options?: {
  limit?: number;
}): Promise<InstallSheetSyncResult> {
  return syncInstallSheet({ dryRun: false, limit: options?.limit });
}

export async function fillAxiaImportTestRow(): Promise<
  { ok: true; sheetRowNumber: number } | { ok: false; error: string }
> {
  try {
    if (!isInstallSheetsConfigured()) {
      return { ok: false, error: "Install sheet is not configured." };
    }
    const rowValues = buildTestRowValues();
    const { sheetRowNumber } = await appendInstallSheetTestRow(rowValues);
    return { ok: true, sheetRowNumber };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
