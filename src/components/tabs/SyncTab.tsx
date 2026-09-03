"use client";

import { Fragment, useState } from "react";
import {
  executeSyncCoperniqToEnerflo,
  previewSyncCoperniqToEnerflo,
} from "@/app/actions/sync";
import type { CoperniqToEnerfloRow } from "@/lib/sync/coperniq-enerflo";
import type { ExecuteResultRow } from "@/lib/sync/execute";

type RowStatus = "pending" | "syncing" | "created" | "error";

interface CoperniqUiRow extends CoperniqToEnerfloRow {
  rowStatus: RowStatus;
  errorMsg?: string;
  targetId?: string;
}

function SyncBadge({
  status,
  errorMsg,
  label = "Created",
}: {
  status: RowStatus;
  errorMsg?: string;
  label?: string;
}) {
  if (status === "pending") return null;
  if (status === "syncing") {
    return (
      <span className="inline-block animate-pulse rounded-full bg-yellow-900/60 px-2.5 py-0.5 text-xs font-medium text-yellow-300">
        Syncing…
      </span>
    );
  }
  if (status === "created") {
    return (
      <span className="inline-block rounded-full bg-emerald-900/60 px-2.5 py-0.5 text-xs font-medium text-emerald-300">
        {label}
      </span>
    );
  }
  return (
    <span
      title={errorMsg}
      className="inline-block max-w-[180px] truncate rounded-full bg-red-900/60 px-2.5 py-0.5 text-xs font-medium text-red-300"
    >
      Error{errorMsg ? `: ${errorMsg}` : ""}
    </span>
  );
}

function fmtCell(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

export default function SyncTab() {
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [missingConfig, setMissingConfig] = useState<string[]>([]);
  const [rows, setRows] = useState<CoperniqUiRow[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const pending = rows.filter(
    row => row.action === "create" && row.rowStatus === "pending",
  );

  async function loadPreview() {
    setLoading(true);
    setErrors([]);
    try {
      const result = await previewSyncCoperniqToEnerflo();
      if (result.fetchError) {
        setErrors([result.fetchError]);
        return;
      }
      setErrors(result.errors ?? []);
      setMissingConfig(result.missingConfig ?? []);
      setRows(
        result.rows.map(row => ({
          ...row,
          rowStatus: row.action === "skip" ? "created" : "pending",
          targetId: row.enerfloCustomerId ?? undefined,
        })),
      );
      setLoaded(true);
    } finally {
      setLoading(false);
    }
  }

  function applyResults(results: ExecuteResultRow[]) {
    setRows(previous => {
      const next = [...previous];
      for (const result of results) {
        const index = next.findIndex(
          row => row.coperniqProjectId === result.id,
        );
        if (index === -1) continue;
        next[index] = {
          ...next[index]!,
          rowStatus: result.status,
          targetId: result.targetId,
          errorMsg: result.error,
        };
      }
      return next;
    });
  }

  async function syncRows(selected: CoperniqUiRow[]) {
    if (!selected.length) return;
    const ids = new Set(selected.map(row => row.coperniqProjectId));
    setSyncing(true);
    setRows(previous =>
      previous.map(row =>
        ids.has(row.coperniqProjectId)
          ? { ...row, rowStatus: "syncing" }
          : row,
      ),
    );
    try {
      const result = await executeSyncCoperniqToEnerflo(selected);
      applyResults(result.results);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Bulk Sync</h2>
          <p className="mt-1 text-xs text-gray-500">
            Import Coperniq projects into Enerflo on demand.
          </p>
        </div>
        {loaded && (
          <button
            onClick={loadPreview}
            disabled={loading}
            className="flex-shrink-0 rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 text-sm font-semibold text-gray-200 transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Refreshing…" : "Refresh Preview"}
          </button>
        )}
      </div>

      <p className="text-xs text-gray-500">
        Fetch all Coperniq projects and create matching customer/install records
        in Enerflo.
      </p>

      {errors.length > 0 && (
        <div className="space-y-1 rounded-lg border border-red-800/50 bg-red-950/30 px-4 py-3 text-xs text-red-300">
          <p className="font-semibold text-red-200">Preview warnings:</p>
          {errors.map((error, index) => <p key={index}>{error}</p>)}
        </div>
      )}

      {missingConfig.length > 0 && (
        <div className="rounded-lg border border-amber-800/50 bg-amber-950/30 px-4 py-3 text-xs text-amber-200">
          <p className="font-semibold text-amber-100">Configuration notes</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-amber-300/90">
            {missingConfig.map(item => <li key={item}>{item}</li>)}
          </ul>
        </div>
      )}

      {!loaded || loading ? (
        <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-gray-800 py-20 text-center">
          <p className="text-4xl text-gray-700">{loading ? "…" : "⟳"}</p>
          <div>
            <p className="text-base font-medium text-gray-400">
              {loading ? "Fetching projects…" : "No preview loaded"}
            </p>
            <p className="mt-1 text-sm text-gray-600">
              Fetching checks which Coperniq projects already exist in Enerflo.
            </p>
          </div>
          {!loading && (
            <button
              onClick={loadPreview}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500"
            >
              Load Preview
            </button>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-800 bg-gray-900">
          <div className="flex items-center justify-between gap-4 border-b border-gray-800 px-5 py-3.5">
            <div className="flex items-center gap-2.5">
              <span className="h-2.5 w-2.5 rounded-full bg-violet-400" />
              <span className="text-sm font-semibold text-white">
                Coperniq → Enerflo
              </span>
              <span className="rounded-full bg-gray-800 px-2 py-0.5 text-xs text-gray-400">
                {pending.length} records
              </span>
            </div>
            {pending.length > 0 && (
              <button
                onClick={() => syncRows(pending)}
                disabled={syncing}
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {syncing ? "Syncing…" : `Sync All (${pending.length})`}
              </button>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-gray-800 bg-gray-900/80">
                  {["", "Project", "Address", "Email", "Size", "Price", "In Enerflo?", "Status", ""].map(header => (
                    <th
                      key={header}
                      className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500"
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/60">
                {rows.map((row, index) => {
                  const key = `${row.coperniqProjectId}-${index}`;
                  const isOpen = expanded[key] === true;
                  const canSync =
                    row.action === "create" && row.rowStatus === "pending";
                  return (
                    <Fragment key={key}>
                      <tr className="transition-colors hover:bg-gray-800/30">
                        <td className="px-2 py-2.5">
                          <button
                            type="button"
                            onClick={() =>
                              setExpanded(previous => ({
                                ...previous,
                                [key]: !previous[key],
                              }))
                            }
                            className="rounded px-1.5 py-0.5 text-gray-500 hover:bg-gray-800 hover:text-gray-300"
                          >
                            {isOpen ? "▾" : "▸"}
                          </button>
                        </td>
                        <td className="max-w-[160px] truncate px-4 py-2.5 font-medium text-gray-200" title={row.title}>
                          {row.title || row.name || "—"}
                        </td>
                        <td className="max-w-[180px] truncate px-4 py-2.5 text-gray-400" title={row.addressFull}>
                          {row.addressFull || "—"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-gray-400">
                          {row.email || "—"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-gray-400">
                          {fmtCell(row.systemSize)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-gray-400">
                          {fmtCell(row.systemPrice)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5">
                          <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            row.action === "skip"
                              ? "bg-sky-900/60 text-sky-300"
                              : "bg-orange-900/60 text-orange-300"
                          }`}>
                            {row.action === "skip" ? "Exists" : "Create"}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5">
                          <SyncBadge
                            status={row.rowStatus}
                            errorMsg={row.errorMsg}
                            label={row.action === "skip" ? "In Enerflo" : "Synced"}
                          />
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5">
                          {canSync && (
                            <button
                              onClick={() => syncRows([row])}
                              disabled={syncing}
                              className="rounded bg-gray-700 px-2 py-1 text-[10px] font-medium text-gray-300 hover:bg-gray-600 disabled:opacity-40"
                            >
                              Sync
                            </button>
                          )}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-gray-950/80">
                          <td colSpan={9} className="px-4 py-3">
                            <pre className="overflow-x-auto rounded-lg border border-gray-800 bg-gray-900 p-3 text-[11px] text-gray-300">
                              {JSON.stringify(row.enerfloPayload, null, 2)}
                            </pre>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
