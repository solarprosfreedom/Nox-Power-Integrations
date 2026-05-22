"use server";

import {
  buildSyncPreview,
  buildInstallsPreview,
  buildE2TPreview,
  buildT2EPreview,
  buildUsersPreview,
} from "@/lib/sync/preview";
import { executeE2T, executeT2E, executeInstallsResync } from "@/lib/sync/execute";
import type { SyncPreviewResult, E2TRow, T2ERow, InstallsRow, UsersPreviewResult } from "@/lib/sync/preview";
import type { ExecuteResult } from "@/lib/sync/execute";

type PreviewResult<T> = { rows: T[]; errors: string[]; fetchError?: string };

export async function previewSync(): Promise<SyncPreviewResult & { fetchError?: string }> {
  try {
    return await buildSyncPreview();
  } catch (e) {
    return {
      enerfloToTerros: [],
      terrosToEnerflo: [],
      installsResync: [],
      errors: [],
      fetchError: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function previewSyncInstalls(): Promise<PreviewResult<InstallsRow>> {
  try {
    return await buildInstallsPreview();
  } catch (e) {
    return { rows: [], errors: [], fetchError: e instanceof Error ? e.message : String(e) };
  }
}

export async function previewSyncE2T(): Promise<PreviewResult<E2TRow>> {
  try {
    return await buildE2TPreview();
  } catch (e) {
    return { rows: [], errors: [], fetchError: e instanceof Error ? e.message : String(e) };
  }
}

export async function previewSyncT2E(): Promise<PreviewResult<T2ERow>> {
  try {
    return await buildT2EPreview();
  } catch (e) {
    return { rows: [], errors: [], fetchError: e instanceof Error ? e.message : String(e) };
  }
}

export async function executeSyncE2T(rows: E2TRow[]): Promise<ExecuteResult & { fetchError?: string }> {
  try {
    const results = await executeE2T(rows);
    return {
      created: results.filter(r => r.status === "created").length,
      errors:  results.filter(r => r.status === "error").length,
      results,
    };
  } catch (e) {
    return { created: 0, errors: 1, results: [], fetchError: e instanceof Error ? e.message : String(e) };
  }
}

export async function executeSyncT2E(rows: T2ERow[]): Promise<ExecuteResult & { fetchError?: string }> {
  try {
    const results = await executeT2E(rows);
    return {
      created: results.filter(r => r.status === "created").length,
      errors:  results.filter(r => r.status === "error").length,
      results,
    };
  } catch (e) {
    return { created: 0, errors: 1, results: [], fetchError: e instanceof Error ? e.message : String(e) };
  }
}

export async function executeSyncInstalls(rows: InstallsRow[]): Promise<ExecuteResult & { fetchError?: string }> {
  try {
    const results = await executeInstallsResync(rows);
    return {
      created: results.filter(r => r.status === "created").length,
      errors:  results.filter(r => r.status === "error").length,
      results,
    };
  } catch (e) {
    return { created: 0, errors: 1, results: [], fetchError: e instanceof Error ? e.message : String(e) };
  }
}

export async function previewUsers(): Promise<UsersPreviewResult & { fetchError?: string }> {
  try {
    return await buildUsersPreview();
  } catch (e) {
    return { enerfloToTerros: [], terrosToEnerflo: [], errors: [], fetchError: e instanceof Error ? e.message : String(e) };
  }
}
