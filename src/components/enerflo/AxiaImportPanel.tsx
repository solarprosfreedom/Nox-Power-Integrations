"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fillAxiaImportTestRow,
  getAxiaImportConfig,
  previewAxiaImport,
  runAxiaImport,
  type AxiaImportConfig,
} from "@/app/actions/axia-import";
import { INSTALL_SHEET_HEADERS } from "@/lib/install-sheet/headers";
import type { InstallSheetSyncResult } from "@/lib/install-sheet/sync";

function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} fill="none" viewBox="0 0 24 24" aria-hidden>
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

export default function AxiaImportPanel() {
  const [config, setConfig] = useState<AxiaImportConfig | null>(null);
  const [result, setResult] = useState<InstallSheetSyncResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [fillingTest, setFillingTest] = useState(false);
  const [limit, setLimit] = useState<number | "">("");
  const [message, setMessage] = useState<string | null>(null);
  const [messageKind, setMessageKind] = useState<"success" | "error" | "info">("info");

  const refreshConfig = useCallback(async () => {
    setConfig(await getAxiaImportConfig());
  }, []);

  useEffect(() => {
    refreshConfig();
  }, [refreshConfig]);

  const ready =
    config?.configured &&
    config?.enerfloConfigured &&
    config?.surveyTypeConfigured;
  const busy = previewing || importing || fillingTest;

  async function handlePreview() {
    setPreviewing(true);
    setMessage(null);
    setResult(null);
    try {
      const preview = await previewAxiaImport({
        limit: limit === "" ? undefined : limit,
      });
      setResult(preview);
      if (preview.errors.length > 0) {
        setMessageKind("error");
        setMessage(preview.errors.join(" · "));
      } else {
        setMessageKind("success");
        const wouldCreate = preview.rows.filter(r => r.status === "would_create").length;
        setMessage(
          `Preview: ${wouldCreate} row(s) would create · ${preview.pending} pending · ${preview.scanned} scanned`,
        );
      }
    } catch (e) {
      setMessageKind("error");
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setPreviewing(false);
    }
  }

  async function handleRunImport() {
    setImporting(true);
    setMessage(null);
    setResult(null);
    try {
      const syncResult = await runAxiaImport({
        limit: limit === "" ? undefined : limit,
      });
      setResult(syncResult);
      if (syncResult.errors.length > 0) {
        setMessageKind("error");
        setMessage(syncResult.errors.join(" · "));
      } else {
        setMessageKind("success");
        setMessage(
          `Created ${syncResult.created} install(s) in Enerflo · ${syncResult.skipped} skipped · ${syncResult.pending} were pending`,
        );
      }
    } catch (e) {
      setMessageKind("error");
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  }

  async function handleFillTestRow() {
    setFillingTest(true);
    setMessage(null);
    try {
      const fillResult = await fillAxiaImportTestRow();
      if (!fillResult.ok) {
        setMessageKind("error");
        setMessage(fillResult.error);
        return;
      }
      setMessageKind("success");
      setMessage(
        `Test row appended at sheet row ${fillResult.sheetRowNumber}. Columns U–Y left blank for import.`,
      );
    } catch (e) {
      setMessageKind("error");
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setFillingTest(false);
    }
  }

  return (
    <div className="px-8 py-8 space-y-6 max-w-4xl">
      <div>
        <h2 className="text-xl font-semibold text-white">Axia import</h2>
        <p className="text-sm text-gray-500 mt-1">
          Read the Axia install backlog Google Sheet and create new installs in Enerflo via{" "}
          <code className="text-orange-300/90">POST /api/v1/lead-installs</code>. Rows with{" "}
          <code className="text-orange-300/90">Install_ID</code> are skipped. Deal type{" "}
          <code className="text-orange-300/90">7770</code> (Axia) comes from{" "}
          <code className="text-orange-300/90">ENERFLO_SURVEY_TYPE_ID</code>. Every create assigns
          to{" "}
          <code className="text-orange-300/90">
            {config?.assignToEmail ?? "jonaslim@noxpwr.com"}
          </code>{" "}
          (sheet <code className="text-orange-300/90">Assign_To_Email</code> is ignored).
        </p>
      </div>

      <div className="rounded-lg border border-orange-800/60 bg-orange-950/30 px-4 py-3 text-sm text-orange-200">
        <strong>Google Sheet → Enerflo.</strong> Writes go to tab{" "}
        <strong>{config?.tabName ?? "INSTALL_SHEETS_TAB_NAME"}</strong>. Cron runs every 15
        minutes when <code className="text-orange-300">INSTALL_SHEET_SYNC_ENABLED=true</code>.
        Dashboard import always writes when you click Run import.
      </div>

      {config && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          <div
            className={`rounded-lg border px-3 py-2 ${config.configured ? "border-emerald-800 text-emerald-300" : "border-red-800 text-red-300"}`}
          >
            Google Sheet: {config.configured ? "ready" : "missing config"}
          </div>
          <div
            className={`rounded-lg border px-3 py-2 ${config.enerfloConfigured ? "border-emerald-800 text-emerald-300" : "border-red-800 text-red-300"}`}
          >
            Enerflo API: {config.enerfloConfigured ? "ready" : "missing key"}
          </div>
          <div
            className={`rounded-lg border px-3 py-2 ${config.surveyTypeConfigured ? "border-emerald-800 text-emerald-300" : "border-red-800 text-red-300"}`}
          >
            Deal type: {config.surveyTypeId ?? "missing"}
          </div>
          <div
            className={`rounded-lg border px-3 py-2 ${config.syncEnabled ? "border-emerald-800 text-emerald-300" : "border-amber-800 text-amber-300"}`}
          >
            Cron creates: {config.syncEnabled ? "enabled" : "preview only"}
          </div>
        </div>
      )}

      {config && (
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-4 text-sm text-gray-300 space-y-1">
          {config.spreadsheetId && (
            <p>
              <span className="text-gray-500">Spreadsheet ID:</span>{" "}
              <code className="text-gray-400">{config.spreadsheetId}</code>
            </p>
          )}
          {config.serviceAccountEmail && (
            <p>
              <span className="text-gray-500">Service account:</span>{" "}
              <code className="text-gray-400">{config.serviceAccountEmail}</code>
            </p>
          )}
          {config.assignToEmail && (
            <p>
              <span className="text-gray-500">Assign to (all imports):</span>{" "}
              <code className="text-orange-300">{config.assignToEmail}</code>
            </p>
          )}
          {config.sheetUrl && (
            <p>
              <span className="text-gray-500">Open sheet:</span>{" "}
              <a
                href={config.sheetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-orange-400 hover:text-orange-300 break-all font-medium"
              >
                Open Axia backlog spreadsheet
              </a>
            </p>
          )}
          <div className="pt-2 border-t border-gray-800 mt-2">
            <p className="text-gray-500 text-xs mb-2">Sheet columns (A–Y):</p>
            <div className="flex flex-wrap gap-2 text-xs font-mono">
              {INSTALL_SHEET_HEADERS.map(header => (
                <span key={header} className="rounded bg-gray-800 px-2 py-0.5 text-orange-300/90">
                  {header}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800">
          <h3 className="text-sm font-semibold text-white">Test row</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Appends one sample row to the sheet (A–T filled, U–Y blank). Assign_To_Email is set to{" "}
            {config?.assignToEmail ?? "jonaslim@noxpwr.com"} automatically.
          </p>
        </div>
        <div className="p-4 flex flex-wrap gap-3 items-end">
          <button
            type="button"
            onClick={handleFillTestRow}
            disabled={busy || !config?.configured}
            className="rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 text-sm text-white hover:bg-gray-700 disabled:opacity-50 inline-flex items-center gap-2"
          >
            {fillingTest && <Spinner />}
            {fillingTest ? "Appending…" : "Fill test row"}
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800">
          <h3 className="text-sm font-semibold text-white">Import controls</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Preview shows rows without Install_ID that would POST to Enerflo. Run import creates
            installs and writes Install_ID / Customer_ID back to the sheet.
          </p>
        </div>
        <div className="p-4 flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">Max rows per run (optional)</label>
            <input
              type="number"
              min={1}
              max={100}
              value={limit}
              onChange={e => {
                const v = e.target.value;
                setLimit(v === "" ? "" : Math.max(1, Number(v) || 1));
              }}
              placeholder="All"
              className="w-28 rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white"
            />
          </div>

          <button
            type="button"
            onClick={handlePreview}
            disabled={busy || !ready}
            className="rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 text-sm text-white hover:bg-gray-700 disabled:opacity-50 inline-flex items-center gap-2"
          >
            {previewing && <Spinner />}
            {previewing ? "Previewing…" : "Preview import"}
          </button>

          <button
            type="button"
            onClick={handleRunImport}
            disabled={busy || !ready}
            className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-500 disabled:opacity-50 inline-flex items-center gap-2"
          >
            {importing && <Spinner />}
            {importing ? "Importing…" : "Run import"}
          </button>
        </div>
      </div>

      {message && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            messageKind === "success"
              ? "border-emerald-800 bg-emerald-950/50 text-emerald-200"
              : messageKind === "error"
                ? "border-red-800 bg-red-950/40 text-red-200"
                : "border-gray-700 bg-gray-900 text-gray-300"
          }`}
        >
          {messageKind === "success" && <p className="font-semibold mb-1">✓ Success</p>}
          {message}
          {messageKind === "success" && config?.sheetUrl && (
            <p className="mt-2">
              <a
                href={config.sheetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-emerald-300 underline hover:text-emerald-200"
              >
                Open spreadsheet → check columns U–Y
              </a>
            </p>
          )}
        </div>
      )}

      {result && (
        <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-800">
            <h3 className="text-sm font-semibold text-white">
              {result.dryRun ? "Preview result" : "Last import result"}
            </h3>
          </div>
          <div className="px-4 py-3 text-sm text-gray-300 space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div className="rounded-lg border border-gray-800 px-3 py-2">
                <span className="text-gray-500">Scanned</span>
                <p className="text-white font-medium">{result.scanned}</p>
              </div>
              <div className="rounded-lg border border-gray-800 px-3 py-2">
                <span className="text-gray-500">Pending</span>
                <p className="text-gray-200 font-medium">{result.pending}</p>
              </div>
              <div className="rounded-lg border border-gray-800 px-3 py-2">
                <span className="text-gray-500">
                  {result.dryRun ? "Would create" : "Created"}
                </span>
                <p className="text-orange-300 font-medium">
                  {result.dryRun
                    ? result.rows.filter(r => r.status === "would_create").length
                    : result.created}
                </p>
              </div>
              <div className="rounded-lg border border-gray-800 px-3 py-2">
                <span className="text-gray-500">Skipped / errors</span>
                <p className="text-gray-200 font-medium">{result.skipped}</p>
              </div>
            </div>

            {result.errors.length > 0 && (
              <div className="rounded-lg border border-red-800 bg-red-950/30 px-3 py-2 text-xs text-red-200">
                {result.errors.map(err => (
                  <p key={err}>{err}</p>
                ))}
              </div>
            )}

            {result.rows.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-gray-500 border-b border-gray-800">
                      <th className="py-1 pr-3">Row</th>
                      <th className="py-1 pr-3">Customer</th>
                      <th className="py-1 pr-3">Rep</th>
                      <th className="py-1 pr-3">Status</th>
                      <th className="py-1">Install ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.slice(0, 20).map(row => (
                      <tr key={row.sheetRowNumber} className="border-b border-gray-800/50">
                        <td className="py-1 pr-3 text-gray-400">{row.sheetRowNumber}</td>
                        <td className="py-1 pr-3 text-gray-200">{row.customerName || "—"}</td>
                        <td className="py-1 pr-3 text-gray-400">{row.assignToEmail || "—"}</td>
                        <td className="py-1 pr-3 text-gray-300">{row.status}</td>
                        <td className="py-1 text-gray-400">
                          {row.installId ?? row.error ?? row.skipReason ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
