"use client";

import { useState } from "react";
import {
  previewSyncInstalls,
  previewSyncE2T,
  previewSyncT2E,
  executeSyncE2T,
  executeSyncT2E,
  executeSyncInstalls,
} from "@/app/actions/sync";
import type { E2TRow, T2ERow, InstallsRow } from "@/lib/sync/preview";
import type { ExecuteResultRow } from "@/lib/sync/execute";

type RowStatus = "pending" | "syncing" | "created" | "error";
type SyncSubTab = "installs" | "e2t" | "t2e";

interface E2TUiRow extends E2TRow {
  rowStatus: RowStatus;
  errorMsg?: string;
  targetId?: string;
  installCount?: number;
}

interface T2EUiRow extends T2ERow {
  rowStatus: RowStatus;
  errorMsg?: string;
  targetId?: string;
}

interface InstallsUiRow extends InstallsRow {
  rowStatus: RowStatus;
  errorMsg?: string;
  targetId?: string;
}

function SyncBadge({ status, errorMsg, label = "Created" }: { status: RowStatus; errorMsg?: string; label?: string }) {
  if (status === "pending") return null;
  if (status === "syncing")
    return <span className="inline-block rounded-full bg-yellow-900/60 px-2.5 py-0.5 text-xs font-medium text-yellow-300 animate-pulse">Syncing…</span>;
  if (status === "created")
    return <span className="inline-block rounded-full bg-emerald-900/60 px-2.5 py-0.5 text-xs font-medium text-emerald-300">{label}</span>;
  return (
    <span title={errorMsg} className="inline-block max-w-[180px] truncate rounded-full bg-red-900/60 px-2.5 py-0.5 text-xs font-medium text-red-300">
      Error{errorMsg ? `: ${errorMsg}` : ""}
    </span>
  );
}

function TableShell({
  title, dot, count, onSyncAll, syncing, headers, children,
}: {
  title: string; dot: string; count: number;
  onSyncAll: () => void; syncing: boolean;
  headers: string[]; children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
      <div className="flex items-center justify-between gap-4 px-5 py-3.5 border-b border-gray-800">
        <div className="flex items-center gap-2.5">
          <span className={`h-2.5 w-2.5 rounded-full flex-shrink-0 ${dot}`} />
          <span className="font-semibold text-white text-sm">{title}</span>
          <span className="rounded-full bg-gray-800 px-2 py-0.5 text-xs text-gray-400">{count} records</span>
        </div>
        {count > 0 && (
          <button
            onClick={onSyncAll}
            disabled={syncing}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {syncing ? "Syncing…" : `Sync All (${count})`}
          </button>
        )}
      </div>
      {count === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <p className="text-3xl text-emerald-400">✓</p>
          <p className="mt-2 text-sm text-gray-500">All records already synced</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-900/80">
                {headers.map(h => (
                  <th key={h} className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/60">{children}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function E2TTable({ rows, onSyncAll, onSyncRow, syncing }: {
  rows: E2TUiRow[]; onSyncAll: () => void;
  onSyncRow: (idx: number) => void; syncing: boolean;
}) {
  return (
    <TableShell
      title="Enerflo → Terros" dot="bg-orange-400"
      count={rows.filter(r => r.rowStatus === "pending").length}
      onSyncAll={onSyncAll} syncing={syncing}
      headers={["Name", "Email", "Phone", "Address", "Sales Rep", "Status", ""]}
    >
      {rows.map((row, i) => (
        <tr key={`${row.enerfloId}-${i}`} className="transition-colors hover:bg-gray-800/30">
          <td className="px-4 py-2.5 text-gray-200 font-medium whitespace-nowrap">{row.name || "—"}</td>
          <td className="px-4 py-2.5 text-gray-400 whitespace-nowrap">{row.email || "—"}</td>
          <td className="px-4 py-2.5 text-gray-400 whitespace-nowrap">{row.phone || "—"}</td>
          <td className="px-4 py-2.5 text-gray-400 max-w-[180px] truncate" title={row.addressFull}>{row.addressFull || "—"}</td>
          <td className="px-4 py-2.5 text-gray-400 whitespace-nowrap">{row.salesRepEmail || "—"}</td>
          <td className="px-4 py-2.5 whitespace-nowrap"><SyncBadge status={row.rowStatus} errorMsg={row.errorMsg} /></td>
          <td className="px-4 py-2.5 whitespace-nowrap">
            <div className="flex items-center gap-2">
              {row.rowStatus === "pending" && (
                <button onClick={() => onSyncRow(i)} disabled={syncing}
                  className="rounded bg-gray-700 px-2 py-1 text-[10px] font-medium text-gray-300 hover:bg-gray-600 disabled:opacity-40">
                  Sync
                </button>
              )}
              {row.installCount !== undefined && (
                <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                  row.installCount > 0
                    ? "bg-emerald-900/60 text-emerald-300"
                    : "bg-gray-800 text-gray-500"
                }`}>
                  {row.installCount} install{row.installCount !== 1 ? "s" : ""}
                </span>
              )}
            </div>
          </td>
        </tr>
      ))}
    </TableShell>
  );
}

function T2ETable({ rows, onSyncAll, onSyncRow, syncing }: {
  rows: T2EUiRow[]; onSyncAll: () => void;
  onSyncRow: (idx: number) => void; syncing: boolean;
}) {
  return (
    <TableShell
      title="Terros → Enerflo" dot="bg-sky-400"
      count={rows.filter(r => r.rowStatus === "pending").length}
      onSyncAll={onSyncAll} syncing={syncing}
      headers={["Name", "Email", "Phone", "Address", "Owner", "Status", ""]}
    >
      {rows.map((row, i) => (
        <tr key={`${row.terrosAccountId}-${i}`} className="transition-colors hover:bg-gray-800/30">
          <td className="px-4 py-2.5 text-gray-200 font-medium whitespace-nowrap">{row.name || "—"}</td>
          <td className="px-4 py-2.5 text-gray-400 whitespace-nowrap">{row.email || "—"}</td>
          <td className="px-4 py-2.5 text-gray-400 whitespace-nowrap">{row.phone || "—"}</td>
          <td className="px-4 py-2.5 text-gray-400 max-w-[180px] truncate" title={row.addressFull}>{row.addressFull || "—"}</td>
          <td className="px-4 py-2.5 text-gray-400 whitespace-nowrap">{row.ownerEmail || "—"}</td>
          <td className="px-4 py-2.5 whitespace-nowrap"><SyncBadge status={row.rowStatus} errorMsg={row.errorMsg} /></td>
          <td className="px-4 py-2.5 whitespace-nowrap">
            {row.rowStatus === "pending" && (
              <button onClick={() => onSyncRow(i)} disabled={syncing}
                className="rounded bg-gray-700 px-2 py-1 text-[10px] font-medium text-gray-300 hover:bg-gray-600 disabled:opacity-40">
                Sync
              </button>
            )}
          </td>
        </tr>
      ))}
    </TableShell>
  );
}

function InstallsTable({ rows, onSyncAll, onSyncRow, syncing, hideTitle }: {
  rows: InstallsUiRow[]; onSyncAll: () => void;
  onSyncRow: (idx: number) => void; syncing: boolean;
  hideTitle?: boolean;
}) {
  const pending = rows.filter(r => r.rowStatus === "pending").length;
  return (
    <TableShell
      title={hideTitle ? "Installs" : "Installs Backfill (Closed Stage)"} dot="bg-emerald-400"
      count={pending}
      onSyncAll={onSyncAll} syncing={syncing}
      headers={["Name", "Email", "Phone", "Address", "Sales Rep", "Installs", "In Terros?", "Status", ""]}
    >
      {rows.map((row, i) => (
        <tr key={`${row.enerfloId}-${i}`} className="transition-colors hover:bg-gray-800/30">
          <td className="px-4 py-2.5 text-gray-200 font-medium whitespace-nowrap">{row.name || "—"}</td>
          <td className="px-4 py-2.5 text-gray-400 whitespace-nowrap">{row.email || "—"}</td>
          <td className="px-4 py-2.5 text-gray-400 whitespace-nowrap">{row.phone || "—"}</td>
          <td className="px-4 py-2.5 text-gray-400 max-w-[160px] truncate" title={row.addressFull}>{row.addressFull || "—"}</td>
          <td className="px-4 py-2.5 text-gray-400 whitespace-nowrap">{row.salesRepEmail || "—"}</td>
          <td className="px-4 py-2.5 whitespace-nowrap">
            <span className="inline-block rounded-full bg-emerald-900/60 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
              {row.installCount}
            </span>
          </td>
          <td className="px-4 py-2.5 whitespace-nowrap">
            {row.action === "update" ? (
              <div className="flex flex-col gap-0.5">
                <span className="inline-block rounded-full bg-sky-900/60 px-2 py-0.5 text-[10px] font-medium text-sky-300 w-fit">
                  Update
                </span>
                {row.terrosAccountId && (
                  <span className="text-[10px] text-gray-500 font-mono truncate max-w-[120px]" title={row.terrosAccountId}>
                    {row.terrosAccountId}
                  </span>
                )}
              </div>
            ) : (
              <span className="inline-block rounded-full bg-orange-900/60 px-2 py-0.5 text-[10px] font-medium text-orange-300">
                Create
              </span>
            )}
          </td>
          <td className="px-4 py-2.5 whitespace-nowrap"><SyncBadge status={row.rowStatus} errorMsg={row.errorMsg} label="Synced" /></td>
          <td className="px-4 py-2.5 whitespace-nowrap">
            {row.rowStatus === "pending" && (
              <button onClick={() => onSyncRow(i)} disabled={syncing}
                className="rounded bg-gray-700 px-2 py-1 text-[10px] font-medium text-gray-300 hover:bg-gray-600 disabled:opacity-40">
                Sync
              </button>
            )}
          </td>
        </tr>
      ))}
    </TableShell>
  );
}

const SUB_TABS: { id: SyncSubTab; label: string; dot: string; description: string }[] = [
  {
    id: "installs",
    label: "Installs",
    dot: "bg-emerald-400",
    description: "Backfill closed installs — updates existing Terros accounts or creates new ones with project details.",
  },
  {
    id: "e2t",
    label: "Enerflo → Terros",
    dot: "bg-orange-400",
    description: "Create Enerflo customers that are missing in Terros.",
  },
  {
    id: "t2e",
    label: "Terros → Enerflo",
    dot: "bg-sky-400",
    description: "Create Terros accounts that are missing in Enerflo.",
  },
];

function PreviewEmpty({ onLoad, loading, loaded }: { onLoad: () => void; loading: boolean; loaded: boolean }) {
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-700 py-20 gap-3">
        <svg className="animate-spin h-8 w-8 text-indigo-400" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
        </svg>
        <p className="text-sm text-gray-500">Fetching records…</p>
        <p className="text-xs text-gray-600">Loading Enerflo installs and matching Terros accounts — usually 30–60 seconds.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-800 py-20 text-center gap-4">
      <p className="text-4xl text-gray-700">⟳</p>
      <div>
        <p className="text-base font-medium text-gray-400">No preview loaded</p>
        <p className="mt-1 text-sm text-gray-600">Load preview for this tab only — other tabs stay idle.</p>
      </div>
      <button
        onClick={onLoad}
        className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500"
      >
        {loaded ? "Refresh Preview" : "Load Preview"}
      </button>
    </div>
  );
}

export default function SyncTab() {
  const [activeTab, setActiveTab]                   = useState<SyncSubTab>("installs");

  const [installsLoaded, setInstallsLoaded]         = useState(false);
  const [installsLoading, setInstallsLoading]       = useState(false);
  const [installsErrors, setInstallsErrors]         = useState<string[]>([]);
  const [installsRows, setInstallsRows]           = useState<InstallsUiRow[]>([]);
  const [installsSyncing, setInstallsSyncing]       = useState(false);

  const [e2tLoaded, setE2tLoaded]                 = useState(false);
  const [e2tLoading, setE2tLoading]                 = useState(false);
  const [e2tErrors, setE2tErrors]                   = useState<string[]>([]);
  const [e2tRows, setE2tRows]                       = useState<E2TUiRow[]>([]);
  const [e2tSyncing, setE2tSyncing]                 = useState(false);

  const [t2eLoaded, setT2eLoaded]                 = useState(false);
  const [t2eLoading, setT2eLoading]                 = useState(false);
  const [t2eErrors, setT2eErrors]                   = useState<string[]>([]);
  const [t2eRows, setT2eRows]                       = useState<T2EUiRow[]>([]);
  const [t2eSyncing, setT2eSyncing]                 = useState(false);

  async function handleLoadInstallsPreview() {
    setInstallsLoading(true);
    setInstallsErrors([]);
    try {
      const result = await previewSyncInstalls();
      if (result.fetchError) {
        setInstallsErrors([result.fetchError]);
      } else {
        setInstallsErrors(result.errors ?? []);
        setInstallsRows(result.rows.map(r => ({ ...r, rowStatus: "pending" as RowStatus })));
        setInstallsLoaded(true);
      }
    } finally {
      setInstallsLoading(false);
    }
  }

  async function handleLoadE2TPreview() {
    setE2tLoading(true);
    setE2tErrors([]);
    try {
      const result = await previewSyncE2T();
      if (result.fetchError) {
        setE2tErrors([result.fetchError]);
      } else {
        setE2tErrors(result.errors ?? []);
        setE2tRows(result.rows.map(r => ({ ...r, rowStatus: "pending" as RowStatus })));
        setE2tLoaded(true);
      }
    } finally {
      setE2tLoading(false);
    }
  }

  async function handleLoadT2EPreview() {
    setT2eLoading(true);
    setT2eErrors([]);
    try {
      const result = await previewSyncT2E();
      if (result.fetchError) {
        setT2eErrors([result.fetchError]);
      } else {
        setT2eErrors(result.errors ?? []);
        setT2eRows(result.rows.map(r => ({ ...r, rowStatus: "pending" as RowStatus })));
        setT2eLoaded(true);
      }
    } finally {
      setT2eLoading(false);
    }
  }

  function handleLoadActivePreview() {
    if (activeTab === "installs") return handleLoadInstallsPreview();
    if (activeTab === "e2t") return handleLoadE2TPreview();
    return handleLoadT2EPreview();
  }

  const activeMeta = SUB_TABS.find(t => t.id === activeTab)!;
  const activeLoading = activeTab === "installs" ? installsLoading : activeTab === "e2t" ? e2tLoading : t2eLoading;
  const activeLoaded = activeTab === "installs" ? installsLoaded : activeTab === "e2t" ? e2tLoaded : t2eLoaded;
  const activeErrors = activeTab === "installs" ? installsErrors : activeTab === "e2t" ? e2tErrors : t2eErrors;

  function pendingCount(tab: SyncSubTab): number | null {
    if (tab === "installs") return installsLoaded ? installsRows.filter(r => r.rowStatus === "pending").length : null;
    if (tab === "e2t") return e2tLoaded ? e2tRows.filter(r => r.rowStatus === "pending").length : null;
    return t2eLoaded ? t2eRows.filter(r => r.rowStatus === "pending").length : null;
  }

  function applyE2TResults(results: ExecuteResultRow[]) {
    setE2tRows(prev => {
      const next = [...prev];
      for (const r of results) {
        const idx = next.findIndex(row => row.enerfloId === r.id);
        if (idx === -1) continue;
        next[idx] = { ...next[idx]!, rowStatus: r.status, targetId: r.targetId, errorMsg: r.error, installCount: r.installCount };
      }
      return next;
    });
  }

  function applyT2EResults(results: ExecuteResultRow[]) {
    setT2eRows(prev => {
      const next = [...prev];
      for (const r of results) {
        const idx = next.findIndex(row => row.terrosAccountId === r.id);
        if (idx === -1) continue;
        next[idx] = { ...next[idx]!, rowStatus: r.status, targetId: r.targetId, errorMsg: r.error };
      }
      return next;
    });
  }

  async function handleSyncAllE2T() {
    const pending = e2tRows.filter(r => r.rowStatus === "pending");
    if (!pending.length) return;
    setE2tSyncing(true);
    setE2tRows(prev => prev.map(r => r.rowStatus === "pending" ? { ...r, rowStatus: "syncing" } : r));
    try {
      const result = await executeSyncE2T(pending);
      applyE2TResults(result.results);
    } finally { setE2tSyncing(false); }
  }

  async function handleSyncRowE2T(idx: number) {
    const row = e2tRows[idx];
    if (!row || row.rowStatus !== "pending") return;
    setE2tRows(prev => prev.map((r, i) => i === idx ? { ...r, rowStatus: "syncing" } : r));
    try {
      const result = await executeSyncE2T([row]);
      applyE2TResults(result.results);
    } catch (e) {
      setE2tRows(prev => prev.map((r, i) =>
        i === idx ? { ...r, rowStatus: "error", errorMsg: e instanceof Error ? e.message : String(e) } : r
      ));
    }
  }

  async function handleSyncAllT2E() {
    const pending = t2eRows.filter(r => r.rowStatus === "pending");
    if (!pending.length) return;
    setT2eSyncing(true);
    setT2eRows(prev => prev.map(r => r.rowStatus === "pending" ? { ...r, rowStatus: "syncing" } : r));
    try {
      const result = await executeSyncT2E(pending);
      applyT2EResults(result.results);
    } finally { setT2eSyncing(false); }
  }

  async function handleSyncRowT2E(idx: number) {
    const row = t2eRows[idx];
    if (!row || row.rowStatus !== "pending") return;
    setT2eRows(prev => prev.map((r, i) => i === idx ? { ...r, rowStatus: "syncing" } : r));
    try {
      const result = await executeSyncT2E([row]);
      applyT2EResults(result.results);
    } catch (e) {
      setT2eRows(prev => prev.map((r, i) =>
        i === idx ? { ...r, rowStatus: "error", errorMsg: e instanceof Error ? e.message : String(e) } : r
      ));
    }
  }

  function applyInstallsResults(results: ExecuteResultRow[]) {
    setInstallsRows(prev => {
      const next = [...prev];
      for (const r of results) {
        const idx = next.findIndex(row => row.enerfloId === r.id);
        if (idx === -1) continue;
        next[idx] = { ...next[idx]!, rowStatus: r.status, targetId: r.targetId, errorMsg: r.error };
      }
      return next;
    });
  }

  async function handleSyncAllInstalls() {
    const pending = installsRows.filter(r => r.rowStatus === "pending");
    if (!pending.length) return;
    setInstallsSyncing(true);
    setInstallsRows(prev => prev.map(r => r.rowStatus === "pending" ? { ...r, rowStatus: "syncing" } : r));
    try {
      const result = await executeSyncInstalls(pending);
      applyInstallsResults(result.results);
    } finally { setInstallsSyncing(false); }
  }

  async function handleSyncRowInstalls(idx: number) {
    const row = installsRows[idx];
    if (!row || row.rowStatus !== "pending") return;
    setInstallsRows(prev => prev.map((r, i) => i === idx ? { ...r, rowStatus: "syncing" } : r));
    try {
      const result = await executeSyncInstalls([row]);
      applyInstallsResults(result.results);
    } catch (e) {
      setInstallsRows(prev => prev.map((r, i) =>
        i === idx ? { ...r, rowStatus: "error", errorMsg: e instanceof Error ? e.message : String(e) } : r
      ));
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Bulk Sync</h2>
          <p className="mt-1 text-xs text-gray-500">
            Each tab loads its own preview on demand — switch tabs without re-fetching everything.
          </p>
        </div>
        {activeLoaded && (
          <button
            onClick={handleLoadActivePreview}
            disabled={activeLoading}
            className="flex-shrink-0 flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 text-sm font-semibold text-gray-200 transition hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {activeLoading ? "Refreshing…" : "Refresh Preview"}
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-2 border-b border-gray-800 pb-1">
        {SUB_TABS.map(tab => {
          const count = pendingCount(tab.id);
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 rounded-t-lg px-4 py-2.5 text-sm font-medium transition ${
                isActive
                  ? "bg-gray-800 text-white border border-b-0 border-gray-700 -mb-px"
                  : "text-gray-500 hover:text-gray-300 hover:bg-gray-900/60"
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${tab.dot}`} />
              {tab.label}
              {count != null && (
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                  isActive ? "bg-gray-700 text-gray-300" : "bg-gray-800 text-gray-500"
                }`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <p className="text-xs text-gray-500 -mt-3">{activeMeta.description}</p>

      {activeErrors.length > 0 && (
        <div className="rounded-lg border border-red-800/50 bg-red-950/30 px-4 py-3 text-xs text-red-300 space-y-1">
          <p className="font-semibold text-red-200">Preview warnings:</p>
          {activeErrors.map((e, i) => <p key={i}>{e}</p>)}
        </div>
      )}

      {activeTab === "installs" && (
        installsLoaded && !installsLoading ? (
          <InstallsTable
            rows={installsRows}
            onSyncAll={handleSyncAllInstalls}
            onSyncRow={handleSyncRowInstalls}
            syncing={installsSyncing}
            hideTitle
          />
        ) : (
          <PreviewEmpty onLoad={handleLoadInstallsPreview} loading={installsLoading} loaded={installsLoaded} />
        )
      )}

      {activeTab === "e2t" && (
        e2tLoaded && !e2tLoading ? (
          <E2TTable rows={e2tRows} onSyncAll={handleSyncAllE2T} onSyncRow={handleSyncRowE2T} syncing={e2tSyncing} />
        ) : (
          <PreviewEmpty onLoad={handleLoadE2TPreview} loading={e2tLoading} loaded={e2tLoaded} />
        )
      )}

      {activeTab === "t2e" && (
        t2eLoaded && !t2eLoading ? (
          <T2ETable rows={t2eRows} onSyncAll={handleSyncAllT2E} onSyncRow={handleSyncRowT2E} syncing={t2eSyncing} />
        ) : (
          <PreviewEmpty onLoad={handleLoadT2EPreview} loading={t2eLoading} loaded={t2eLoaded} />
        )
      )}
    </div>
  );
}
