import { env } from "@/lib/env";
import {
  buildLeadInstallPayload,
  resolveInstallSheetAssignToEmail,
  validateInstallSheetRow,
  type LeadInstallPayload,
} from "@/lib/install-sheet/map-row";
import {
  readInstallSheetRows,
  writeInstallSheetRowBack,
  isInstallSheetsConfigured,
  type HeaderIndexMap,
} from "@/lib/install-sheet/sheets";

export interface InstallSheetRowResult {
  sheetRowNumber: number;
  customerName: string;
  assignToEmail: string;
  status: "created" | "would_create" | "skipped" | "error";
  installId?: string;
  customerId?: string;
  error?: string;
  skipReason?: string;
}

export interface InstallSheetSyncResult {
  configured: boolean;
  dryRun: boolean;
  scanned: number;
  pending: number;
  created: number;
  skipped: number;
  errors: string[];
  rows: InstallSheetRowResult[];
  missingConfig: string[];
}

function extractCreateIds(parsed: Record<string, unknown>): {
  installId?: string;
  customerId?: string;
} {
  const data = (parsed.data ?? parsed) as Record<string, unknown>;
  const customer = data.customer as Record<string, unknown> | undefined;

  const installId = data.id ?? parsed.id;
  const customerId =
    data.customer_id ??
    parsed.customer_id ??
    customer?.id;

  return {
    installId: installId != null ? String(installId) : undefined,
    customerId: customerId != null ? String(customerId) : undefined,
  };
}

async function createLeadInstall(payload: LeadInstallPayload): Promise<{
  ok: boolean;
  installId?: string;
  customerId?: string;
  error?: string;
}> {
  const enerfloKey = env.enerfloV1ApiKey?.trim();
  if (!enerfloKey) {
    return { ok: false, error: "ENERFLO_V1_API_KEY is not set." };
  }

  const enerfloBase = (env.enerfloV1BaseUrl ?? "https://enerflo.io").replace(/\/$/, "");

  try {
    const res = await fetch(`${enerfloBase}/api/v1/lead-installs`, {
      method: "POST",
      headers: { "api-key": enerfloKey, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, error: text.slice(0, 500) };
    }

    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      /* ignore */
    }

    const { installId, customerId } = extractCreateIds(parsed);
    if (!installId) {
      return { ok: false, error: `Create succeeded but no install id in response: ${text.slice(0, 300)}` };
    }

    return { ok: true, installId, customerId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function collectMissingConfig(): string[] {
  const missing: string[] = [];
  if (!isInstallSheetsConfigured()) {
    missing.push("INSTALL_SHEETS_SPREADSHEET_ID / INSTALL_SHEETS_TAB_NAME / Google service account");
  }
  if (!env.enerfloV1ApiKey?.trim()) missing.push("ENERFLO_V1_API_KEY");
  if (!env.enerfloSurveyTypeId?.trim()) missing.push("ENERFLO_SURVEY_TYPE_ID");
  return missing;
}

export async function syncInstallSheet(options?: {
  dryRun?: boolean;
  limit?: number;
}): Promise<InstallSheetSyncResult> {
  const dryRun = options?.dryRun ?? !env.installSheetSyncEnabled;
  const missingConfig = collectMissingConfig();

  const base: InstallSheetSyncResult = {
    configured: isInstallSheetsConfigured(),
    dryRun,
    scanned: 0,
    pending: 0,
    created: 0,
    skipped: 0,
    errors: [],
    rows: [],
    missingConfig,
  };

  if (missingConfig.length > 0) {
    base.errors.push(`Missing config: ${missingConfig.join(", ")}`);
    return base;
  }

  let headerMap: HeaderIndexMap;
  let sheetRows;
  try {
    const read = await readInstallSheetRows();
    headerMap = read.headerMap;
    sheetRows = read.rows;
  } catch (e) {
    base.errors.push(e instanceof Error ? e.message : String(e));
    return base;
  }

  base.scanned = sheetRows.length;

  const pendingRows = sheetRows.filter(row => !row.values.Install_ID.trim());
  base.pending = pendingRows.length;

  const toProcess =
    options?.limit != null && options.limit > 0
      ? pendingRows.slice(0, options.limit)
      : pendingRows;

  for (const row of toProcess) {
    const customerName = `${row.values.Customer_First_Name} ${row.values.Customer_Last_Name}`.trim();
    const assignToEmail = resolveInstallSheetAssignToEmail();

    if (row.values.Install_ID.trim()) {
      base.skipped++;
      base.rows.push({
        sheetRowNumber: row.sheetRowNumber,
        customerName,
        assignToEmail,
        status: "skipped",
        skipReason: "Install_ID already set",
        installId: row.values.Install_ID,
        customerId: row.values.Customer_ID || undefined,
      });
      continue;
    }

    const validationErrors = validateInstallSheetRow(row);
    if (validationErrors.length > 0) {
      base.skipped++;
      const errorMsg = validationErrors.join("; ");
      base.rows.push({
        sheetRowNumber: row.sheetRowNumber,
        customerName,
        assignToEmail,
        status: "error",
        error: errorMsg,
      });
      if (!dryRun) {
        try {
          await writeInstallSheetRowBack(row.sheetRowNumber, headerMap, {
            Sync_Status: "error",
            Last_Synced_At: new Date().toISOString(),
            Sync_Error: errorMsg,
          });
        } catch (e) {
          base.errors.push(e instanceof Error ? e.message : String(e));
        }
      }
      continue;
    }

    let payload: LeadInstallPayload;
    try {
      payload = buildLeadInstallPayload(row);
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      base.skipped++;
      base.rows.push({
        sheetRowNumber: row.sheetRowNumber,
        customerName,
        assignToEmail,
        status: "error",
        error: errorMsg,
      });
      continue;
    }

    if (dryRun) {
      base.rows.push({
        sheetRowNumber: row.sheetRowNumber,
        customerName,
        assignToEmail,
        status: "would_create",
      });
      continue;
    }

    const result = await createLeadInstall(payload);
    const syncedAt = new Date().toISOString();

    if (!result.ok || !result.installId) {
      base.skipped++;
      base.rows.push({
        sheetRowNumber: row.sheetRowNumber,
        customerName,
        assignToEmail,
        status: "error",
        error: result.error ?? "Unknown error",
      });
      try {
        await writeInstallSheetRowBack(row.sheetRowNumber, headerMap, {
          Sync_Status: "error",
          Last_Synced_At: syncedAt,
          Sync_Error: result.error ?? "Unknown error",
        });
      } catch (e) {
        base.errors.push(e instanceof Error ? e.message : String(e));
      }
      continue;
    }

    base.created++;
    base.rows.push({
      sheetRowNumber: row.sheetRowNumber,
      customerName,
      assignToEmail,
      status: "created",
      installId: result.installId,
      customerId: result.customerId,
    });

    try {
      await writeInstallSheetRowBack(row.sheetRowNumber, headerMap, {
        Install_ID: result.installId,
        Customer_ID: result.customerId ?? "",
        Sync_Status: "created",
        Last_Synced_At: syncedAt,
        Sync_Error: "",
      });
    } catch (e) {
      base.errors.push(
        `Row ${row.sheetRowNumber} created (install ${result.installId}) but sheet write-back failed: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }

  return base;
}

export async function previewInstallSheetSync(options?: {
  limit?: number;
}): Promise<InstallSheetSyncResult> {
  return syncInstallSheet({ dryRun: true, limit: options?.limit });
}
