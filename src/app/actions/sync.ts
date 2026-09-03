"use server";

import {
  buildUsersPreview,
} from "@/lib/sync/preview";
import { buildCoperniqToEnerfloPreview, executeCoperniqToEnerflo } from "@/lib/sync/coperniq-enerflo";
import type { E2TRow, InstallsRow, UsersPreviewResult } from "@/lib/sync/preview";
import type { CoperniqToEnerfloRow } from "@/lib/sync/coperniq-enerflo";
import type { ExecuteResult } from "@/lib/sync/execute";

type PreviewResult<T> = { rows: T[]; errors: string[]; fetchError?: string };
const CROSS_SYSTEM_SYNC_DISABLED = "Enerflo ↔ Terros synchronization is disabled";

export async function previewSyncInstalls(): Promise<PreviewResult<InstallsRow>> {
  return { rows: [], errors: [CROSS_SYSTEM_SYNC_DISABLED] };
}

export async function previewSyncInstallsWithFields(): Promise<
  PreviewResult<InstallsRow> & { unconfiguredFields?: string[] }
> {
  return { rows: [], errors: [CROSS_SYSTEM_SYNC_DISABLED], unconfiguredFields: [] };
}

export async function previewSyncCoperniqToEnerflo(): Promise<
  PreviewResult<CoperniqToEnerfloRow> & { missingConfig?: string[] }
> {
  try {
    const result = await buildCoperniqToEnerfloPreview();
    return {
      rows: result.rows,
      errors: result.errors,
      missingConfig: result.missingConfig,
    };
  } catch (e) {
    return { rows: [], errors: [], fetchError: e instanceof Error ? e.message : String(e) };
  }
}

export async function executeSyncCoperniqToEnerflo(
  rows: CoperniqToEnerfloRow[],
): Promise<ExecuteResult & { fetchError?: string }> {
  try {
    const results = await executeCoperniqToEnerflo(rows);
    return {
      created: results.filter(r => r.status === "created").length,
      errors: results.filter(r => r.status === "error").length,
      results: results.map(r => ({
        id: r.id,
        status: r.status === "created" ? "created" : r.status === "skipped" ? "created" : "error",
        targetId: r.targetId,
        error: r.error,
      })),
    };
  } catch (e) {
    return { created: 0, errors: 1, results: [], fetchError: e instanceof Error ? e.message : String(e) };
  }
}

export async function previewSyncE2T(): Promise<PreviewResult<E2TRow>> {
  return { rows: [], errors: [CROSS_SYSTEM_SYNC_DISABLED] };
}

export async function executeSyncE2T(rows: E2TRow[]): Promise<ExecuteResult & { fetchError?: string }> {
  return {
    created: 0,
    errors: rows.length,
    results: rows.map(row => ({
      id: row.enerfloId,
      status: "error",
      error: CROSS_SYSTEM_SYNC_DISABLED,
    })),
  };
}

export async function executeSyncInstalls(rows: InstallsRow[]): Promise<ExecuteResult & { fetchError?: string }> {
  return {
    created: 0,
    errors: rows.length,
    results: rows.map(row => ({
      id: row.enerfloId,
      status: "error",
      error: CROSS_SYSTEM_SYNC_DISABLED,
    })),
  };
}

export async function previewUsers(): Promise<UsersPreviewResult & { fetchError?: string }> {
  try {
    return await buildUsersPreview();
  } catch (e) {
    return { enerfloToTerros: [], terrosToEnerflo: [], errors: [], fetchError: e instanceof Error ? e.message : String(e) };
  }
}
