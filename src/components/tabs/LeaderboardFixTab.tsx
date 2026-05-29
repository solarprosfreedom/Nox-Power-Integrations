"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fixLeaderboardAccount,
  getLeaderboardFixMeta,
  loadDefaultLeaderboardCsv,
  type LeaderboardFixMeta,
  type LeaderboardFixResult,
} from "@/app/actions/leaderboard-fix";
import { DEFAULT_LEADERBOARD_CSV_FILENAME } from "@/lib/terros/leaderboard-fix";
import {
  getLastLoadedFileName,
  isTerminalStatus,
  loadPersistedRows,
  persistRow,
  setLastLoadedFileName,
  type PersistedRow,
} from "@/lib/terros/leaderboard-fix-storage";
import {
  accountDisplayName,
  groupAccountsByStage,
  parseLeaderboardFixCsv,
  type LeaderboardFixAccount,
  type LeaderboardFixStageGroup,
} from "@/lib/terros/leaderboard-fix";

type RowStatus = "pending" | "updating" | "updated" | "skipped" | "failed";

type RowState = {
  account: LeaderboardFixAccount;
  status: RowStatus;
  message?: string;
  ownerId?: string;
};

function SectionCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-gray-800 bg-gray-900 p-5 ${className}`}>
      {children}
    </div>
  );
}

function StatusPill({ status }: { status: RowStatus }) {
  const styles: Record<RowStatus, string> = {
    pending: "bg-gray-800 text-gray-400 border-gray-700",
    updating: "bg-sky-950/60 text-sky-300 border-sky-900/60",
    updated: "bg-emerald-950/60 text-emerald-300 border-emerald-900/60",
    skipped: "bg-amber-950/60 text-amber-300 border-amber-900/60",
    failed: "bg-red-950/60 text-red-300 border-red-900/60",
  };
  const labels: Record<RowStatus, string> = {
    pending: "Pending",
    updating: "Updating…",
    updated: "Fixed",
    skipped: "Skipped",
    failed: "Failed",
  };
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}

function applyResult(prev: RowState, result: LeaderboardFixResult): RowState {
  if (result.status === "updated") {
    return { ...prev, status: "updated", message: undefined, ownerId: result.ownerId };
  }
  if (result.status === "skipped") {
    return {
      ...prev,
      status: "skipped",
      message: result.reason,
      ownerId: result.ownerId,
    };
  }
  return { ...prev, status: "failed", message: result.reason, ownerId: result.ownerId };
}

function persistRowState(fileName: string, accountId: string, row: RowState): void {
  if (!isTerminalStatus(row.status)) return;
  const persisted: PersistedRow = {
    status: row.status as PersistedRow["status"],
    message: row.message,
    ownerId: row.ownerId,
    updatedAt: new Date().toISOString(),
  };
  persistRow(fileName, accountId, persisted);
}

function mergePersistedStates(
  fileName: string,
  states: Record<string, RowState>,
): Record<string, RowState> {
  const saved = loadPersistedRows(fileName);
  const merged = { ...states };
  for (const [accountId, savedRow] of Object.entries(saved)) {
    if (!merged[accountId]) continue;
    merged[accountId] = {
      ...merged[accountId],
      status: savedRow.status,
      message: savedRow.message,
      ownerId: savedRow.ownerId,
    };
  }
  return merged;
}

export default function LeaderboardFixTab() {
  const [meta, setMeta] = useState<LeaderboardFixMeta | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [groups, setGroups] = useState<LeaderboardFixStageGroup[]>([]);
  const [rowStates, setRowStates] = useState<Record<string, RowState>>({});
  const [expandedStages, setExpandedStages] = useState<Record<string, boolean>>({});
  const [parseError, setParseError] = useState<string | null>(null);
  const [stageRunning, setStageRunning] = useState<string | null>(null);
  const [loadingDefault, setLoadingDefault] = useState(false);

  useEffect(() => {
    getLeaderboardFixMeta().then(setMeta);
  }, []);

  const stats = useMemo(() => {
    const rows = Object.values(rowStates);
    return {
      total: rows.length,
      pending: rows.filter((r) => r.status === "pending").length,
      updated: rows.filter((r) => r.status === "updated").length,
      skipped: rows.filter((r) => r.status === "skipped").length,
      failed: rows.filter((r) => r.status === "failed").length,
    };
  }, [rowStates]);

  const loadCsvText = useCallback(
    (text: string, name: string) => {
      setParseError(null);
      try {
        const sourceUserId = meta?.sourceUserId;
        const accounts = parseLeaderboardFixCsv(text, sourceUserId);
        const stageLabels = meta?.stageLabels ?? {};
        const grouped = groupAccountsByStage(accounts, stageLabels);

        const states: Record<string, RowState> = {};
        for (const account of accounts) {
          states[account.accountId] = { account, status: "pending" };
        }

        const mergedStates = mergePersistedStates(name, states);

        const expanded: Record<string, boolean> = {};
        for (const g of grouped) {
          expanded[g.stageId] = true;
        }

        setLastLoadedFileName(name);
        setFileName(name);
        setGroups(grouped);
        setRowStates(mergedStates);
        setExpandedStages(expanded);
      } catch (e) {
        setParseError(e instanceof Error ? e.message : String(e));
        setGroups([]);
        setRowStates({});
        setFileName(null);
      }
    },
    [meta],
  );

  // Restore last CSV + saved fix progress after reload
  useEffect(() => {
    if (!meta) return;
    const lastFile = getLastLoadedFileName();
    if (lastFile !== DEFAULT_LEADERBOARD_CSV_FILENAME) return;

    let cancelled = false;
    (async () => {
      setLoadingDefault(true);
      try {
        const result = await loadDefaultLeaderboardCsv();
        if (cancelled || !result.ok) return;
        loadCsvText(result.csvText, result.fileName);
      } finally {
        if (!cancelled) setLoadingDefault(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [meta, loadCsvText]);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    loadCsvText(text, file.name);
    e.target.value = "";
  }

  async function handleLoadProjectCsv() {
    setLoadingDefault(true);
    setParseError(null);
    try {
      const result = await loadDefaultLeaderboardCsv();
      if (!result.ok) {
        setParseError(result.error);
        return;
      }
      loadCsvText(result.csvText, result.fileName);
    } finally {
      setLoadingDefault(false);
    }
  }

  async function handleFixOne(accountId: string) {
    if (!fileName) return;

    setRowStates((prev) => ({
      ...prev,
      [accountId]: { ...prev[accountId]!, status: "updating", message: undefined },
    }));

    const result = await fixLeaderboardAccount(accountId);
    setRowStates((prev) => {
      const next = applyResult(prev[accountId]!, result);
      persistRowState(fileName, accountId, next);
      return { ...prev, [accountId]: next };
    });
  }

  async function handleFixStage(stageId: string) {
    const group = groups.find((g) => g.stageId === stageId);
    if (!group || !fileName) return;

    setStageRunning(stageId);

    for (const account of group.accounts) {
      const current = rowStates[account.accountId];
      if (
        !current ||
        current.status === "updating" ||
        isTerminalStatus(current.status)
      ) {
        continue;
      }

      setRowStates((prev) => ({
        ...prev,
        [account.accountId]: { ...prev[account.accountId]!, status: "updating", message: undefined },
      }));

      const result = await fixLeaderboardAccount(account.accountId);
      setRowStates((prev) => {
        const next = applyResult(prev[account.accountId]!, result);
        persistRowState(fileName, account.accountId, next);
        return { ...prev, [account.accountId]: next };
      });
    }

    setStageRunning(null);
  }

  function toggleStage(stageId: string) {
    setExpandedStages((prev) => ({ ...prev, [stageId]: !prev[stageId] }));
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-white">Leaderboard History Fix</h2>
        <p className="mt-1 text-sm text-gray-500 max-w-3xl">
          Upload the Terros accounts CSV export. Accounts are grouped by workflow stage. Use{" "}
          <strong className="text-gray-300">Fix</strong> per account or{" "}
          <strong className="text-gray-300">Fix all in stage</strong> — same flow as the manual test:{" "}
          <code className="text-gray-400">account/get</code> → rewrite{" "}
          <code className="text-gray-400">workflowHistory</code> →{" "}
          <code className="text-gray-400">account/update</code>. Never creates missing accounts.
        </p>
      </div>

      {!meta?.terrosConfigured && (
        <div className="rounded-lg border border-red-900/50 bg-red-950/40 px-4 py-3 text-sm text-red-300">
          TERROS_API_KEY is not set in .env.local
        </div>
      )}

      <SectionCard>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-white">1. Upload CSV</h3>
            <p className="mt-1 text-xs text-gray-500">
              Expects columns: accountId, ownerId, workflowStageId, resident names, line1, snapshot
            </p>
            {fileName && (
              <p className="mt-2 text-xs text-gray-400">
                Loaded: <span className="text-gray-300">{fileName}</span>
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleLoadProjectCsv}
              disabled={loadingDefault}
              className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-600 disabled:opacity-40 transition-colors"
            >
              {loadingDefault ? "Loading…" : "Load project CSV"}
            </button>
            <label className="cursor-pointer rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 text-sm font-medium text-gray-200 hover:border-gray-600 transition-colors">
              Upload other CSV
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={handleFileChange} />
            </label>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-gray-600 font-mono truncate">
          Project file: {DEFAULT_LEADERBOARD_CSV_FILENAME}
        </p>

        {parseError && (
          <div className="mt-3 rounded-lg border border-red-900/50 bg-red-950/40 px-4 py-3 text-sm text-red-300">
            {parseError}
          </div>
        )}

        {stats.total > 0 && (
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[
              { label: "Candidates", value: stats.total, color: "border-gray-700 text-gray-300" },
              { label: "Pending", value: stats.pending, color: "border-gray-700 text-gray-400" },
              { label: "Fixed", value: stats.updated, color: "border-emerald-900/60 text-emerald-300" },
              { label: "Skipped", value: stats.skipped, color: "border-amber-900/60 text-amber-300" },
              { label: "Failed", value: stats.failed, color: "border-red-900/60 text-red-300" },
            ].map((s) => (
              <div key={s.label} className={`rounded-lg border px-3 py-2 ${s.color}`}>
                <p className="text-[10px] uppercase tracking-wider opacity-70">{s.label}</p>
                <p className="text-xl font-bold tabular-nums">{s.value}</p>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {groups.length === 0 && !parseError && (
        <SectionCard>
          <p className="text-sm text-gray-500">
            No accounts loaded yet. Upload a CSV to see accounts grouped by stage.
          </p>
        </SectionCard>
      )}

      {groups.map((group) => {
        const stagePending = group.accounts.filter((a) => {
          const s = rowStates[a.accountId]?.status;
          return !s || s === "pending";
        }).length;
        const stageFixed = group.accounts.filter((a) => rowStates[a.accountId]?.status === "updated").length;
        const isExpanded = expandedStages[group.stageId] ?? true;
        const isRunning = stageRunning === group.stageId;

        return (
          <SectionCard key={group.stageId}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => toggleStage(group.stageId)}
                className="flex items-center gap-2 text-left"
              >
                <span className="text-gray-500 text-xs">{isExpanded ? "▼" : "▶"}</span>
                <div>
                  <h3 className="text-sm font-semibold text-white">{group.stageLabel}</h3>
                  <p className="text-xs text-gray-500">
                    {group.stageId} · {group.accounts.length} account
                    {group.accounts.length === 1 ? "" : "s"}
                    {stageFixed > 0 ? ` · ${stageFixed} fixed` : ""}
                    {stagePending > 0 ? ` · ${stagePending} pending` : ""}
                  </p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => handleFixStage(group.stageId)}
                disabled={!meta?.terrosConfigured || isRunning || stagePending === 0}
                className="rounded-lg bg-violet-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {isRunning ? "Fixing stage…" : "Fix all in stage"}
              </button>
            </div>

            {isExpanded && (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-gray-800 text-gray-500">
                      <th className="pb-2 pr-4 font-medium">Customer</th>
                      <th className="pb-2 pr-4 font-medium">Address</th>
                      <th className="pb-2 pr-4 font-medium">CSV owner</th>
                      <th className="pb-2 pr-4 font-medium">Jonas entries</th>
                      <th className="pb-2 pr-4 font-medium">Status</th>
                      <th className="pb-2 font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.accounts.map((account) => {
                      const row = rowStates[account.accountId];
                      const status = row?.status ?? "pending";
                      const isUpdating = status === "updating";

                      return (
                        <tr key={account.accountId} className="border-b border-gray-800/60">
                          <td className="py-2.5 pr-4">
                            <p className="text-gray-200">{accountDisplayName(account)}</p>
                            <p className="text-[10px] text-gray-600 font-mono truncate max-w-[180px]">
                              {account.accountId}
                            </p>
                          </td>
                          <td className="py-2.5 pr-4 text-gray-400">
                            {[account.line1, account.locality].filter(Boolean).join(", ") || "—"}
                          </td>
                          <td className="py-2.5 pr-4 font-mono text-[10px] text-gray-500">
                            {account.ownerId}
                          </td>
                          <td className="py-2.5 pr-4 text-gray-400 tabular-nums">
                            {account.jonasEntryCount}
                          </td>
                          <td className="py-2.5 pr-4">
                            <StatusPill status={status} />
                            {row?.message && (
                              <p className="mt-1 text-[10px] text-gray-500 max-w-[160px]">{row.message}</p>
                            )}
                          </td>
                          <td className="py-2.5">
                            <button
                              type="button"
                              onClick={() => handleFixOne(account.accountId)}
                              disabled={
                                !meta?.terrosConfigured ||
                                isUpdating ||
                                (isTerminalStatus(status) && status !== "failed")
                              }
                              className="rounded-md border border-gray-700 bg-gray-800 px-2.5 py-1 text-[11px] font-medium text-gray-200 hover:border-gray-600 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            >
                              {isUpdating
                                ? "Fixing…"
                                : status === "updated"
                                  ? "Done"
                                  : status === "skipped"
                                    ? "Skipped"
                                    : status === "failed"
                                      ? "Retry"
                                      : "Fix"}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        );
      })}
    </div>
  );
}
