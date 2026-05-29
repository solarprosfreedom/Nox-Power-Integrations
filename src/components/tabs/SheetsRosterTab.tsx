"use client";

import { useCallback, useEffect, useState } from "react";
import {
  appendManualRowToTestSheet,
  getGoogleSheetsConfig,
  syncSequifiRosterToTestSheet,
  testGoogleSheetsConnection,
} from "@/app/actions/google-sheets";
import {
  appendManualRowToSharePointTestSheet,
  getSharePointRosterConfig,
  syncSequifiRosterToSharePointTestSheet,
  testSharePointRosterConnection,
} from "@/app/actions/sharepoint-roster";
import {
  EMPTY_MANUAL_ROSTER_ROW,
  normalizeManualRosterRow,
  SAMPLE_MANUAL_ROSTER_ROW,
  type ManualRosterRow,
} from "@/lib/google-sheets/roster-map";
import { LAZARUS_COLUMNS } from "@/lib/sharepoint/tab-layout";

type Subtab = "google" | "sharepoint";

type GoogleConfig = Awaited<ReturnType<typeof getGoogleSheetsConfig>>;
type SharePointConfig = Awaited<ReturnType<typeof getSharePointRosterConfig>>;
type GoogleConnection = Awaited<ReturnType<typeof testGoogleSheetsConnection>>;
type SharePointConnection = Awaited<ReturnType<typeof testSharePointRosterConnection>>;
type SyncSampleRow = { sequifiUserId: number; repName: string; personalEmail: string };

const MANUAL_FIELDS: {
  key: keyof ManualRosterRow;
  label: string;
  required?: boolean;
  placeholder?: string;
  type?: "email" | "tel" | "text";
  hideOnSharePoint?: boolean;
  sharePointOnly?: boolean;
}[] = [
  { key: "dealer", label: "Dealer", sharePointOnly: true },
  { key: "repId", label: "Rep ID", placeholder: "noxpwr000075" },
  { key: "repName", label: "Rep Name", required: true, placeholder: "Jane Doe" },
  { key: "phoneNumber", label: "Phone Number", placeholder: "555-0100", type: "tel" },
  {
    key: "personalEmail",
    label: "Personal Email",
    placeholder: "jane@gmail.com",
    type: "email",
  },
  { key: "workEmail", label: "Work Email", placeholder: "jane@company.com", type: "email" },
  {
    key: "noxEmail",
    label: "Nox Email",
    placeholder: "janedoe@noxpwr.com",
    type: "email",
    hideOnSharePoint: true,
  },
  { key: "division", label: "Division" },
  { key: "region", label: "Region", placeholder: "Envision" },
  { key: "team", label: "Team", placeholder: "Dictate" },
  { key: "role", label: "Role", placeholder: "Sales Rep" },
  { key: "market", label: "Market" },
  { key: "redline", label: "Redline" },
  { key: "overridingEntity1", label: "Overriding Entity 1" },
  { key: "overridingEntity2", label: "Overriding Entity 2" },
  { key: "overridingEntity3", label: "Overriding Entity 3" },
  { key: "addis", label: "Addis", hideOnSharePoint: true },
  { key: "dob", label: "DOB" },
  { key: "caHis", label: "CA HIS" },
  { key: "issueDate", label: "Issue Date" },
  { key: "expDate", label: "Exp Date" },
];

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

interface RosterPanelProps {
  subtab: Subtab;
  googleConfig: GoogleConfig | null;
  sharepointConfig: SharePointConfig | null;
}

function RosterPanel({ subtab, googleConfig, sharepointConfig }: RosterPanelProps) {
  const isGoogle = subtab === "google";
  const config = isGoogle ? googleConfig : sharepointConfig;
  const testTabName = isGoogle
    ? (googleConfig?.testTabName ?? "EMPWR")
    : (sharepointConfig?.testWorksheetName ?? "LAZARUS");
  const productionTabName = isGoogle ? googleConfig?.productionTabName : null;
  const configured = config?.configured ?? false;
  const sequifiConfigured = config?.sequifiConfigured ?? false;
  const fileUrl = isGoogle
    ? (googleConfig?.testTabUrl ??
      (googleConfig?.spreadsheetId
        ? `https://docs.google.com/spreadsheets/d/${googleConfig.spreadsheetId}/edit`
        : null))
    : (sharepointConfig?.fileUrl ?? null);

  const manualFields = MANUAL_FIELDS.filter(f => {
    if (f.sharePointOnly) return !isGoogle;
    if (f.hideOnSharePoint) return isGoogle;
    return true;
  });

  const [connection, setConnection] = useState<GoogleConnection | SharePointConnection | null>(
    null,
  );
  const [syncResult, setSyncResult] = useState<{
    appended: number;
    alreadyInSheet: number;
    tabName: string;
    sampleRows: SyncSampleRow[];
  } | null>(null);
  const [manualRow, setManualRow] = useState<ManualRosterRow>(() =>
    normalizeManualRosterRow(EMPTY_MANUAL_ROSTER_ROW),
  );
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [appending, setAppending] = useState(false);
  const [applyGoLive, setApplyGoLive] = useState(true);
  const [limit, setLimit] = useState<number | "">(10);
  const [message, setMessage] = useState<string | null>(null);
  const [messageKind, setMessageKind] = useState<"success" | "error" | "info">("info");

  useEffect(() => {
    setConnection(null);
    setSyncResult(null);
    setMessage(null);
    setManualRow(normalizeManualRosterRow(EMPTY_MANUAL_ROSTER_ROW));
  }, [subtab]);

  function updateManualField(key: keyof ManualRosterRow, value: string) {
    setManualRow(prev => normalizeManualRosterRow({ ...prev, [key]: value }));
  }

  async function handleTestConnection() {
    setTesting(true);
    setMessage(null);
    setConnection(null);
    try {
      const result = isGoogle
        ? await testGoogleSheetsConnection()
        : await testSharePointRosterConnection();
      setConnection(result);
      if ("error" in result && result.error) {
        setMessageKind("error");
        setMessage(result.error);
      } else if ("ok" in result && result.ok) {
        setMessageKind("success");
        if (isGoogle && "spreadsheetTitle" in result) {
          setMessage(
            `Connected to "${result.spreadsheetTitle}" · writes go to tab "${result.tabName}"${productionTabName ? ` (not ${productionTabName})` : ""}`,
          );
        } else if (!isGoogle && "fileName" in result) {
          setMessage(
            `Connected to "${result.fileName}" · writes go to worksheet "${result.worksheetName}"${result.worksheetExists ? "" : " (worksheet missing — create it in Excel first)"}`,
          );
        }
      }
    } catch (e) {
      setMessageKind("error");
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  }

  async function handleAppendManualRow() {
    if (!manualRow.repName.trim()) {
      setMessageKind("error");
      setMessage("Rep Name is required.");
      return;
    }

    setAppending(true);
    setMessage(null);
    try {
      const result = isGoogle
        ? await appendManualRowToTestSheet(manualRow)
        : await appendManualRowToSharePointTestSheet(manualRow);

      if ("error" in result) {
        setMessageKind("error");
        setMessage(result.error ?? "Append failed");
      } else {
        setMessageKind("success");
        const dest = isGoogle ? "Google Sheet" : "SharePoint workbook";
        setMessage(
          `Success — row appended to the "${testTabName}" tab in ${dest} for "${result.row.repName}".`,
        );
      }
    } catch (e) {
      setMessageKind("error");
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setAppending(false);
    }
  }

  async function handleSync() {
    setSyncing(true);
    setMessage(null);
    setSyncResult(null);
    try {
      const result = isGoogle
        ? await syncSequifiRosterToTestSheet({
            limit: limit === "" ? undefined : limit,
            applyGoLiveFilter: applyGoLive,
          })
        : await syncSequifiRosterToSharePointTestSheet({
            limit: limit === "" ? undefined : limit,
            applyGoLiveFilter: applyGoLive,
          });

      if ("error" in result) {
        setMessageKind("error");
        setMessage(result.error ?? "Sync failed");
      } else {
        setMessageKind("success");
        const tab = "tabName" in result ? result.tabName : result.worksheetName;
        setSyncResult({
          appended: result.appended,
          alreadyInSheet: result.alreadyInSheet,
          tabName: tab,
          sampleRows: result.sampleRows,
        });
        setMessage(
          `Appended ${result.appended} row(s) from Sequifi to "${tab}" · ${result.alreadyInSheet} already in sheet`,
        );
      }
    } catch (e) {
      setMessageKind("error");
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  }

  const busy = testing || syncing || appending;

  const manualHint = isGoogle
    ? "Fill in any fields, then append one row to the test tab. EMPWR puts Rep ID in column A; Axia-style tabs leave A blank."
    : "Columns A–S match the LAZARUS header row exactly. Sequifi sync puts Nox UPN in Work Email (F) when Work Email is empty.";

  return (
    <div className="space-y-6">
      <div
        className={`rounded-lg border px-4 py-3 text-sm ${
          isGoogle
            ? "border-amber-800 bg-amber-950/40 text-amber-200"
            : "border-blue-800 bg-blue-950/40 text-blue-200"
        }`}
      >
        {isGoogle ? (
          <>
            <strong>Google Sheets testing.</strong> All writes go to{" "}
            <strong>{testTabName}</strong> — not {productionTabName ?? "production"}.
          </>
        ) : (
          <>
            <strong>SharePoint testing.</strong> All writes go to the{" "}
            <strong>{testTabName}</strong> worksheet in the roster workbook. Delete test rows
            manually after verifying.
          </>
        )}
      </div>

      {config && (
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div
            className={`rounded-lg border px-3 py-2 ${configured ? "border-emerald-800 text-emerald-300" : "border-red-800 text-red-300"}`}
          >
            {isGoogle ? "Google Sheets" : "SharePoint"}: {configured ? "ready" : "missing credentials"}
          </div>
          <div
            className={`rounded-lg border px-3 py-2 ${sequifiConfigured ? "border-emerald-800 text-emerald-300" : "border-amber-800 text-amber-300"}`}
          >
            Sequifi: {sequifiConfigured ? "ready" : "optional for manual test"}
          </div>
        </div>
      )}

      {config && (
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-4 text-sm text-gray-300 space-y-1">
          <p>
            <span className="text-gray-500">Test tab:</span>{" "}
            <code className={isGoogle ? "text-green-300" : "text-blue-300"}>{testTabName}</code>
          </p>
          {isGoogle && googleConfig?.spreadsheetId && (
            <p>
              <span className="text-gray-500">Spreadsheet ID:</span>{" "}
              <code className="text-gray-400">{googleConfig.spreadsheetId}</code>
            </p>
          )}
          {!isGoogle && sharepointConfig?.excelPath && (
            <p>
              <span className="text-gray-500">File:</span>{" "}
              <code className="text-gray-400">{sharepointConfig.excelPath}</code>
            </p>
          )}
          {!isGoogle && (
            <div className="pt-2 border-t border-gray-800 mt-2">
              <p className="text-gray-500 text-xs mb-2">LAZARUS columns (A–S):</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-0.5 text-xs font-mono">
                {LAZARUS_COLUMNS.map(({ column, header }) => (
                  <span key={column} className="text-gray-400">
                    <span className="text-blue-400">{column}</span> {header}
                  </span>
                ))}
              </div>
            </div>
          )}
          {fileUrl && (
            <p>
              <span className="text-gray-500">Open file:</span>{" "}
              <a
                href={fileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:text-blue-300 break-all font-medium"
              >
                Open &quot;{testTabName}&quot; {isGoogle ? "tab" : "workbook"}
              </a>
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={handleTestConnection}
          disabled={busy || !configured}
          className="rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 text-sm text-white hover:bg-gray-700 disabled:opacity-50 inline-flex items-center gap-2"
        >
          {testing && <Spinner />}
          {testing ? "Testing…" : "1. Test connection"}
        </button>
      </div>

      {connection && "ok" in connection && connection.ok && (
        <div className="rounded-xl border border-emerald-900/40 bg-gray-900 p-4 text-sm">
          <p className="text-emerald-300 font-medium">Connection OK</p>
          {isGoogle && "spreadsheetTitle" in connection && (
            <p className="text-gray-400 mt-1 text-xs">Spreadsheet: {connection.spreadsheetTitle}</p>
          )}
          {!isGoogle && "fileName" in connection && (
            <p className="text-gray-400 mt-1 text-xs">
              Workbook: {connection.fileName}
              {!connection.worksheetExists && (
                <span className="text-amber-400 block mt-1">
                  Worksheet &quot;{connection.worksheetName}&quot; not found — add it in Excel first.
                </span>
              )}
            </p>
          )}
        </div>
      )}

      <div className="rounded-xl border border-green-900/40 bg-gray-900 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800">
          <h3 className="text-sm font-semibold text-white">2. Manual test row</h3>
          <p className="text-xs text-gray-500 mt-0.5">{manualHint}</p>
        </div>
        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {manualFields.map(field => (
            <label key={field.key} className="block text-xs">
              <span className="text-gray-400">
                {field.label}
                {field.required && <span className="text-red-400"> *</span>}
              </span>
              <input
                type={field.type ?? "text"}
                value={manualRow[field.key] ?? ""}
                onChange={e => updateManualField(field.key, e.target.value)}
                placeholder={field.placeholder}
                className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white"
              />
            </label>
          ))}
        </div>
        <div className="px-4 pb-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() =>
              setManualRow(
                normalizeManualRosterRow(
                  isGoogle ? SAMPLE_MANUAL_ROSTER_ROW : { ...SAMPLE_MANUAL_ROSTER_ROW, addis: "" },
                ),
              )
            }
            disabled={busy}
            className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 disabled:opacity-50"
          >
            Fill sample data
          </button>
          <button
            type="button"
            onClick={() => setManualRow(normalizeManualRosterRow(EMPTY_MANUAL_ROSTER_ROW))}
            disabled={busy}
            className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 disabled:opacity-50"
          >
            Clear form
          </button>
          <button
            type="button"
            onClick={handleAppendManualRow}
            disabled={busy || !configured}
            className="rounded-lg bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-600 disabled:opacity-50 inline-flex items-center gap-2"
          >
            {appending && <Spinner />}
            {appending ? "Appending…" : `Append row to ${testTabName}`}
          </button>
        </div>
        {message && (
          <div
            className={`mx-4 mb-4 rounded-lg border px-4 py-3 text-sm ${
              messageKind === "success"
                ? "border-emerald-800 bg-emerald-950/50 text-emerald-200"
                : messageKind === "error"
                  ? "border-red-800 bg-red-950/40 text-red-200"
                  : "border-gray-700 bg-gray-900 text-gray-300"
            }`}
          >
            {messageKind === "success" && <p className="font-semibold mb-1">✓ Success</p>}
            {message}
            {messageKind === "success" && fileUrl && (
              <p className="mt-2">
                <a
                  href={fileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-emerald-300 underline hover:text-emerald-200"
                >
                  Open {isGoogle ? "spreadsheet" : "workbook"} → click &quot;{testTabName}&quot; tab
                </a>
              </p>
            )}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800">
          <h3 className="text-sm font-semibold text-white">3. Bulk sync from Sequifi (optional)</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Pulls hired users from Sequifi API and appends rows. Skips duplicates by Personal Email.
          </p>
        </div>
        <div className="p-4 flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">Max rows per sync</label>
            <input
              type="number"
              min={1}
              max={500}
              value={limit}
              onChange={e => {
                const v = e.target.value;
                setLimit(v === "" ? "" : Math.max(1, Number(v) || 1));
              }}
              className="w-24 rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white"
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-400 pb-2">
            <input
              type="checkbox"
              checked={applyGoLive}
              onChange={e => setApplyGoLive(e.target.checked)}
              className="rounded border-gray-600"
            />
            Apply ONBOARDING_GO_LIVE_AT filter
          </label>

          <button
            type="button"
            onClick={handleSync}
            disabled={busy || !configured || !sequifiConfigured}
            className="rounded-lg bg-violet-700 px-4 py-2 text-sm font-medium text-white hover:bg-violet-600 disabled:opacity-50 inline-flex items-center gap-2"
          >
            {syncing && <Spinner />}
            {syncing ? "Syncing…" : "Sync from Sequifi"}
          </button>
        </div>
      </div>

      {message && messageKind !== "success" && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            messageKind === "error"
              ? "border-red-800 bg-red-950/40 text-red-200"
              : "border-gray-700 bg-gray-900 text-gray-300"
          }`}
        >
          {message}
        </div>
      )}

      {syncResult && (
        <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-800">
            <h3 className="text-sm font-semibold text-white">Last Sequifi sync</h3>
          </div>
          <div className="px-4 py-3 text-sm text-gray-300 space-y-2">
            <p>
              Appended <strong className="text-green-300">{syncResult.appended}</strong> · skipped{" "}
              {syncResult.alreadyInSheet} duplicates
            </p>
            {syncResult.sampleRows.length > 0 && (
              <div className="overflow-x-auto mt-2">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-gray-500 border-b border-gray-800">
                      <th className="py-1 pr-3">Sequifi ID</th>
                      <th className="py-1 pr-3">Rep Name</th>
                      <th className="py-1">Personal Email</th>
                    </tr>
                  </thead>
                  <tbody>
                    {syncResult.sampleRows.map(row => (
                      <tr key={row.sequifiUserId} className="border-b border-gray-800/50">
                        <td className="py-1 pr-3 text-gray-400">{row.sequifiUserId}</td>
                        <td className="py-1 pr-3 text-gray-200">{row.repName}</td>
                        <td className="py-1 text-gray-400">{row.personalEmail}</td>
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

export default function SheetsRosterTab() {
  const [subtab, setSubtab] = useState<Subtab>("google");
  const [googleConfig, setGoogleConfig] = useState<GoogleConfig | null>(null);
  const [sharepointConfig, setSharepointConfig] = useState<SharePointConfig | null>(null);

  const refreshConfig = useCallback(async () => {
    const [google, sharepoint] = await Promise.all([
      getGoogleSheetsConfig(),
      getSharePointRosterConfig(),
    ]);
    setGoogleConfig(google);
    setSharepointConfig(sharepoint);
  }, []);

  useEffect(() => {
    refreshConfig();
  }, [refreshConfig]);

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h2 className="text-lg font-semibold text-white">Roster sync — testing</h2>
        <p className="text-sm text-gray-400 mt-1">
          Append test rows manually or bulk-sync from Sequifi. Each destination writes only to its
          test tab — never production roster tabs.
        </p>
      </div>

      <div className="flex gap-1 rounded-lg border border-gray-800 bg-gray-950 p-1 w-fit">
        <button
          type="button"
          onClick={() => setSubtab("google")}
          className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
            subtab === "google"
              ? "bg-green-900/60 text-green-200 border border-green-800"
              : "text-gray-400 hover:text-gray-200"
          }`}
        >
          Google Sheets
          {googleConfig?.testTabName && (
            <span className="ml-1.5 text-xs opacity-75">({googleConfig.testTabName})</span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setSubtab("sharepoint")}
          className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
            subtab === "sharepoint"
              ? "bg-blue-900/60 text-blue-200 border border-blue-800"
              : "text-gray-400 hover:text-gray-200"
          }`}
        >
          SharePoint
          {sharepointConfig?.testWorksheetName && (
            <span className="ml-1.5 text-xs opacity-75">
              ({sharepointConfig.testWorksheetName})
            </span>
          )}
        </button>
      </div>

      <RosterPanel
        subtab={subtab}
        googleConfig={googleConfig}
        sharepointConfig={sharepointConfig}
      />
    </div>
  );
}
