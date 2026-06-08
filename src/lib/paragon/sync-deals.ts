import { fetchAllEnerfloInstalls } from "@/lib/enerflo/installs";
import { env } from "@/lib/env";
import {
  isExcludedInstallStatus,
  mapInstallToParagonRow,
  paragonRowToSheetValues,
  type ParagonInstallRow,
} from "@/lib/paragon/map-install";
import {
  appendParagonRows,
  isParagonSheetsConfigured,
  readExistingParagonExternalIds,
} from "@/lib/paragon/sheets";

export interface ParagonSkippedRow {
  installId: string;
  statusName: string;
  reason: string;
}

export interface ParagonSyncResult {
  configured: boolean;
  dryRun: boolean;
  polled: number;
  excludedByStatus: number;
  skippedMissingFields: number;
  alreadyInSheet: number;
  appended: number;
  toAppend: ParagonInstallRow[];
  skipped: ParagonSkippedRow[];
  sampleAppended: ParagonInstallRow[];
  errors: string[];
}

export async function syncParagonDeals(options?: {
  dryRun?: boolean;
  limit?: number;
}): Promise<ParagonSyncResult> {
  const dryRun = options?.dryRun ?? !env.paragonSyncEnabled;
  const limit = options?.limit;

  const base: ParagonSyncResult = {
    configured: isParagonSheetsConfigured(),
    dryRun,
    polled: 0,
    excludedByStatus: 0,
    skippedMissingFields: 0,
    alreadyInSheet: 0,
    appended: 0,
    toAppend: [],
    skipped: [],
    sampleAppended: [],
    errors: [],
  };

  if (!base.configured) {
    base.errors.push(
      "Paragon Google Sheets not configured. Set PARAGON_SHEETS_SPREADSHEET_ID, PARAGON_SHEETS_TAB_NAME, and Google service account credentials.",
    );
    return base;
  }

  const { installs, error: fetchError } = await fetchAllEnerfloInstalls();
  base.polled = installs.length;
  if (fetchError) base.errors.push(fetchError);

  let existingIds: Set<string> | null = null;
  if (!dryRun) {
    try {
      existingIds = await readExistingParagonExternalIds();
    } catch (e) {
      base.errors.push(e instanceof Error ? e.message : String(e));
      return base;
    }
  } else {
    try {
      existingIds = await readExistingParagonExternalIds();
    } catch {
      existingIds = new Set<string>();
    }
  }

  const rowsToAppend: ParagonInstallRow[] = [];

  for (const install of installs) {
    const statusName = String(install.status_name ?? "").trim();
    if (isExcludedInstallStatus(statusName)) {
      base.excludedByStatus++;
      continue;
    }

    const mapped = mapInstallToParagonRow(install);
    if (!mapped.ok) {
      if (mapped.skipReason.startsWith("Excluded status:")) {
        base.excludedByStatus++;
      } else {
        base.skippedMissingFields++;
        base.skipped.push({
          installId: mapped.installId || String(install.id ?? ""),
          statusName: mapped.statusName,
          reason: mapped.skipReason,
        });
      }
      continue;
    }

    if (existingIds!.has(mapped.row.installId)) {
      base.alreadyInSheet++;
      continue;
    }

    if (limit != null && rowsToAppend.length >= limit) break;

    rowsToAppend.push(mapped.row);
    existingIds!.add(mapped.row.installId);
  }

  base.toAppend = rowsToAppend;

  if (dryRun) {
    base.sampleAppended = rowsToAppend.slice(0, 5);
    return base;
  }

  if (rowsToAppend.length === 0) {
    return base;
  }

  try {
    await appendParagonRows(rowsToAppend.map(paragonRowToSheetValues));
    base.appended = rowsToAppend.length;
    base.sampleAppended = rowsToAppend.slice(0, 5);
  } catch (e) {
    base.errors.push(e instanceof Error ? e.message : String(e));
  }

  return base;
}

export async function previewParagonDeals(limit?: number): Promise<ParagonSyncResult> {
  return syncParagonDeals({ dryRun: true, limit });
}
