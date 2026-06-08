"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getParagonSyncConfig,
  previewParagonSync,
  runParagonSync,
  type ParagonSyncConfig,
} from "@/app/actions/paragon-sync";
import { PARAGON_SHEET_HEADERS } from "@/lib/paragon/map-install";
import type { ParagonSyncResult } from "@/lib/paragon/sync-deals";

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

export default function ParagonSyncTab() {
  const [config, setConfig] = useState<ParagonSyncConfig | null>(null);
  const [result, setResult] = useState<ParagonSyncResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [limit, setLimit] = useState<number | "">("");
  const [message, setMessage] = useState<string | null>(null);
  const [messageKind, setMessageKind] = useState<"success" | "error" | "info">("info");

  const refreshConfig = useCallback(async () => {
    setConfig(await getParagonSyncConfig());
  }, []);

  useEffect(() => {
    refreshConfig();
  }, [refreshConfig]);

  const configured = config?.configured ?? false;
  const enerfloConfigured = config?.enerfloConfigured ?? false;
  const ready = configured && enerfloConfigured;
  const busy = previewing || syncing;

  async function handlePreview() {
    setPreviewing(true);
    setMessage(null);
    setResult(null);
    try {
      const preview = await previewParagonSync();
      setResult(preview);
      if (preview.errors.length > 0) {
        setMessageKind("error");
        setMessage(preview.errors.join(" · "));
      } else {
        setMessageKind("success");
        setMessage(
          `Preview: ${preview.toAppend.length} row(s) would append · ${preview.alreadyInSheet} already in sheet · ${preview.excludedByStatus} excluded by status · ${preview.skippedMissingFields} skipped (missing fields)`,
        );
      }
    } catch (e) {
      setMessageKind("error");
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setPreviewing(false);
    }
  }

  async function handleRunSync() {
    setSyncing(true);
    setMessage(null);
    setResult(null);
    try {
      const syncResult = await runParagonSync({
        limit: limit === "" ? undefined : limit,
      });
      setResult(syncResult);
      if (syncResult.errors.length > 0) {
        setMessageKind("error");
        setMessage(syncResult.errors.join(" · "));
      } else {
        setMessageKind("success");
        setMessage(
          `Appended ${syncResult.appended} row(s) to "${config?.tabName ?? "sheet"}" · ${syncResult.alreadyInSheet} already in sheet`,
        );
      }
    } catch (e) {
      setMessageKind("error");
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h2 className="text-lg font-semibold text-white">Paragon deal sync</h2>
        <p className="text-sm text-gray-400 mt-1">
          Pull Enerflo installs and append new deals to the Paragon Google Sheet. Skips
          Cancelled/Voided statuses and duplicates by External_id.
        </p>
      </div>

      <div className="rounded-lg border border-teal-800 bg-teal-950/40 px-4 py-3 text-sm text-teal-200">
        <strong>Paragon sheet sync.</strong> Writes go to tab{" "}
        <strong>{config?.tabName ?? "PARAGON_SHEETS_TAB_NAME"}</strong>. Daily cron runs at 6:00
        UTC when <code className="text-teal-300">PARAGON_SYNC_ENABLED=true</code>.
      </div>

      {config && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
          <div
            className={`rounded-lg border px-3 py-2 ${configured ? "border-emerald-800 text-emerald-300" : "border-red-800 text-red-300"}`}
          >
            Google Sheets: {configured ? "ready" : "missing Paragon sheet config"}
          </div>
          <div
            className={`rounded-lg border px-3 py-2 ${enerfloConfigured ? "border-emerald-800 text-emerald-300" : "border-red-800 text-red-300"}`}
          >
            Enerflo: {enerfloConfigured ? "ready" : "missing API key"}
          </div>
          <div
            className={`rounded-lg border px-3 py-2 ${config.syncEnabled ? "border-emerald-800 text-emerald-300" : "border-amber-800 text-amber-300"}`}
          >
            Cron writes: {config.syncEnabled ? "enabled" : "preview only"}
          </div>
        </div>
      )}

      {config && (
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-4 text-sm text-gray-300 space-y-1">
          <p>
            <span className="text-gray-500">Tab:</span>{" "}
            <code className="text-teal-300">{config.tabName ?? "—"}</code>
          </p>
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
          <div className="pt-2 border-t border-gray-800 mt-2">
            <p className="text-gray-500 text-xs mb-2">Sheet columns:</p>
            <div className="flex flex-wrap gap-2 text-xs font-mono">
              {PARAGON_SHEET_HEADERS.map(header => (
                <span key={header} className="rounded bg-gray-800 px-2 py-0.5 text-teal-300">
                  {header}
                </span>
              ))}
            </div>
          </div>
          {config.sheetUrl && (
            <p>
              <span className="text-gray-500">Open sheet:</span>{" "}
              <a
                href={config.sheetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-teal-400 hover:text-teal-300 break-all font-medium"
              >
                Open Paragon spreadsheet
              </a>
            </p>
          )}
        </div>
      )}

      <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800">
          <h3 className="text-sm font-semibold text-white">Sync controls</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Preview polls Enerflo and shows rows that would append without writing. Run sync
            appends immediately from the dashboard.
          </p>
        </div>
        <div className="p-4 flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">Max rows per run (optional)</label>
            <input
              type="number"
              min={1}
              max={500}
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
            {previewing ? "Previewing…" : "Preview sync"}
          </button>

          <button
            type="button"
            onClick={handleRunSync}
            disabled={busy || !ready}
            className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-600 disabled:opacity-50 inline-flex items-center gap-2"
          >
            {syncing && <Spinner />}
            {syncing ? "Syncing…" : "Run sync"}
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
                Open spreadsheet → click &quot;{config.tabName}&quot; tab
              </a>
            </p>
          )}
        </div>
      )}

      {result && (
        <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-800">
            <h3 className="text-sm font-semibold text-white">
              {result.dryRun ? "Preview result" : "Last sync result"}
            </h3>
          </div>
          <div className="px-4 py-3 text-sm text-gray-300 space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
              <div className="rounded-lg border border-gray-800 px-3 py-2">
                <span className="text-gray-500">Polled</span>
                <p className="text-white font-medium">{result.polled}</p>
              </div>
              <div className="rounded-lg border border-gray-800 px-3 py-2">
                <span className="text-gray-500">
                  {result.dryRun ? "Would append" : "Appended"}
                </span>
                <p className="text-teal-300 font-medium">
                  {result.dryRun ? result.toAppend.length : result.appended}
                </p>
              </div>
              <div className="rounded-lg border border-gray-800 px-3 py-2">
                <span className="text-gray-500">Already in sheet</span>
                <p className="text-gray-200 font-medium">{result.alreadyInSheet}</p>
              </div>
              <div className="rounded-lg border border-gray-800 px-3 py-2">
                <span className="text-gray-500">Excluded (status)</span>
                <p className="text-gray-200 font-medium">{result.excludedByStatus}</p>
              </div>
              <div className="rounded-lg border border-gray-800 px-3 py-2">
                <span className="text-gray-500">Skipped (missing fields)</span>
                <p className="text-gray-200 font-medium">{result.skippedMissingFields}</p>
              </div>
            </div>

            {result.errors.length > 0 && (
              <div className="rounded-lg border border-red-800 bg-red-950/30 px-3 py-2 text-xs text-red-200">
                {result.errors.map(err => (
                  <p key={err}>{err}</p>
                ))}
              </div>
            )}

            {result.sampleAppended.length > 0 && (
              <div className="overflow-x-auto">
                <p className="text-xs text-gray-500 mb-2">
                  Sample {result.dryRun ? "rows to append" : "appended rows"}:
                </p>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-gray-500 border-b border-gray-800">
                      <th className="py-1 pr-3">External_id</th>
                      <th className="py-1 pr-3">Customer</th>
                      <th className="py-1 pr-3">Email</th>
                      <th className="py-1">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.sampleAppended.map(row => (
                      <tr key={row.installId} className="border-b border-gray-800/50">
                        <td className="py-1 pr-3 text-gray-400">{row.installId}</td>
                        <td className="py-1 pr-3 text-gray-200">{row.customerName}</td>
                        <td className="py-1 pr-3 text-gray-400">{row.customerEmail}</td>
                        <td className="py-1 text-gray-500">{row.statusName}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {result.skipped.length > 0 && (
              <div className="overflow-x-auto">
                <p className="text-xs text-gray-500 mb-2">
                  Skipped installs ({result.skipped.length}):
                </p>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-gray-500 border-b border-gray-800">
                      <th className="py-1 pr-3">Install ID</th>
                      <th className="py-1 pr-3">Status</th>
                      <th className="py-1">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.skipped.slice(0, 10).map(row => (
                      <tr key={`${row.installId}-${row.reason}`} className="border-b border-gray-800/50">
                        <td className="py-1 pr-3 text-gray-400">{row.installId || "—"}</td>
                        <td className="py-1 pr-3 text-gray-500">{row.statusName || "—"}</td>
                        <td className="py-1 text-amber-300/90">{row.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {result.skipped.length > 10 && (
                  <p className="text-xs text-gray-600 mt-1">
                    + {result.skipped.length - 10} more skipped rows
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
