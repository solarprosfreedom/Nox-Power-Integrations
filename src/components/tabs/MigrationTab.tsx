"use client";

import { useState, useEffect, useCallback } from "react";
import { testExport, getExportStatus, debugAccount, testFilters } from "@/app/actions/migration";
import type { ExportStatusResult, DebugAccountResult, FilterTestResult } from "@/app/actions/migration";

// ── Types ────────────────────────────────────────────────────────────────────

type Phase = "idle" | "running" | "done" | "error";

interface StreamProgress {
  done: number;
  total: number;
  failed: number;
  message?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function consumeNdjsonStream(
  url: string,
  onProgress: (p: StreamProgress) => void,
  onPhase: (msg: string) => void,
  onEvent?: (evt: Record<string, unknown>) => void,
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(url, { method: "POST" });
  if (!res.ok || !res.body) {
    return { ok: false, error: `HTTP ${res.status}` };
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const evt = JSON.parse(trimmed) as Record<string, unknown>;
        if (evt.type === "phase") {
          onPhase(String(evt.message ?? ""));
        } else if (evt.type === "list_progress") {
          const collected = Number(evt.collected ?? 0).toLocaleString();
          const label     = evt.label ? `  •  ${String(evt.label)}` : "";
          onPhase(`Collecting IDs… ${collected} unique accounts${label}`);
        } else if (evt.type === "progress" || evt.type === "complete") {
          onProgress({
            done: Number(evt.done ?? 0),
            total: Number(evt.total ?? 0),
            failed: Number(evt.failed ?? 0),
          });
          onEvent?.(evt);
        } else if (evt.type === "error") {
          return { ok: false, error: String(evt.message ?? "Unknown error") };
        }
      } catch { /* malformed line */ }
    }
  }

  return { ok: true };
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusBadge({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div className={`rounded-lg border px-4 py-3 ${color}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wider opacity-70">{label}</p>
      <p className="mt-0.5 text-2xl font-bold tabular-nums">{value}</p>
    </div>
  );
}

function ProgressBar({ done, total }: { done: number; total: number }) {
  const known = total > 0;
  const pct = known ? Math.round((done / total) * 100) : 0;
  return (
    <div className="mt-3">
      <div className="flex justify-between text-xs text-gray-400 mb-1">
        <span>{done.toLocaleString()}{known ? ` / ${total.toLocaleString()}` : " saved"}</span>
        {known && <span>{pct}%</span>}
      </div>
      <div className="h-2 rounded-full bg-gray-800 overflow-hidden">
        {known ? (
          <div className="h-full rounded-full bg-amber-500 transition-all duration-200" style={{ width: `${pct}%` }} />
        ) : (
          <div className="h-full rounded-full bg-amber-500 animate-pulse" style={{ width: "100%" }} />
        )}
      </div>
    </div>
  );
}

function SectionCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-gray-800 bg-gray-900 p-5 ${className}`}>
      {children}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function MigrationTab() {
  const [status, setStatus]           = useState<ExportStatusResult | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);

  // Test export state
  const [testPhase, setTestPhase]     = useState<Phase>("idle");
  const [testAccounts, setTestAccounts] = useState<Record<string, unknown>[]>([]);
  const [testTotal, setTestTotal]     = useState<number | null>(null);
  const [testError, setTestError]     = useState<string | null>(null);
  const [testPassed, setTestPassed]   = useState(false);

  // Filter test state
  const [filterResult, setFilterResult]   = useState<FilterTestResult | null>(null);
  const [filterLoading, setFilterLoading] = useState(false);
  const [filterZip, setFilterZip]         = useState("");

  // Debug inspector state
  const [debugResult, setDebugResult]   = useState<DebugAccountResult | null>(null);
  const [debugLoading, setDebugLoading] = useState(false);
  const [debugOpen, setDebugOpen]       = useState(false);
  const [manualAccountId, setManualAccountId] = useState("");

  // Export state
  const [exportPhase, setExportPhase]   = useState<Phase>("idle");
  const [exportProgress, setExportProgress] = useState<StreamProgress>({ done: 0, total: 0, failed: 0 });
  const [exportMsg, setExportMsg]       = useState("");
  const [exportError, setExportError]   = useState<string | null>(null);

  // Restore state
  const [restorePhase, setRestorePhase]   = useState<Phase>("idle");
  const [restoreProgress, setRestoreProgress] = useState<StreamProgress>({ done: 0, total: 0, failed: 0 });
  const [restoreMsg, setRestoreMsg]       = useState("");
  const [restoreError, setRestoreError]   = useState<string | null>(null);

  // Fix stages state
  const [fixPhase, setFixPhase]           = useState<Phase>("idle");
  const [fixProgress, setFixProgress]     = useState<StreamProgress>({ done: 0, total: 0, failed: 0 });
  const [fixMsg, setFixMsg]               = useState("");
  const [fixError, setFixError]           = useState<string | null>(null);
  const [fixStats, setFixStats]           = useState<{ fixed: number; skipped: number } | null>(null);

  const refreshStatus = useCallback(async () => {
    setLoadingStatus(true);
    const s = await getExportStatus();
    setStatus(s);
    setLoadingStatus(false);
  }, []);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  async function handleDebugAccount(accountId: string) {
    setDebugLoading(true);
    setDebugOpen(true);
    setDebugResult(null);
    const result = await debugAccount(accountId);
    setDebugResult(result);
    setDebugLoading(false);
  }

  async function handleTestFilters() {
    setFilterLoading(true);
    setFilterResult(null);
    const result = await testFilters(filterZip || undefined);
    setFilterResult(result);
    setFilterLoading(false);
  }

  async function handleTestExport() {
    setTestPhase("running");
    setTestAccounts([]);
    setTestError(null);
    setTestPassed(false);

    const result = await testExport(10);

    if (result.error) {
      setTestError(result.error);
      setTestPhase("error");
      return;
    }

    setTestAccounts(result.accounts);
    setTestTotal(result.totalIds);
    setTestPassed(result.accounts.length > 0);
    setTestPhase("done");
  }

  async function handleExportAll() {
    setExportPhase("running");
    setExportProgress({ done: 0, total: 0, failed: 0 });
    setExportError(null);
    setExportMsg("Starting export…");

    const result = await consumeNdjsonStream(
      "/api/migration/export",
      (p) => setExportProgress(p),
      (msg) => setExportMsg(msg),
    );

    if (!result.ok) {
      setExportError(result.error ?? "Export failed");
      setExportPhase("error");
    } else {
      setExportPhase("done");
      await refreshStatus();
    }
  }

  async function handleRestoreAll() {
    setRestorePhase("running");
    setRestoreProgress({ done: 0, total: 0, failed: 0 });
    setRestoreError(null);
    setRestoreMsg("Starting restore…");

    const result = await consumeNdjsonStream(
      "/api/migration/restore",
      (p) => setRestoreProgress(p),
      (msg) => setRestoreMsg(msg),
    );

    if (!result.ok) {
      setRestoreError(result.error ?? "Restore failed");
      setRestorePhase("error");
    } else {
      setRestorePhase("done");
      await refreshStatus();
    }
  }

  async function handleFixStages() {
    setFixPhase("running");
    setFixProgress({ done: 0, total: 0, failed: 0 });
    setFixError(null);
    setFixMsg("Starting stage fix…");
    setFixStats(null);

    const result = await consumeNdjsonStream(
      "/api/migration/fix-stages",
      (p) => setFixProgress(p),
      (msg) => setFixMsg(msg),
      (evt) => {
        if (evt.type === "complete") {
          setFixStats({ fixed: (evt.fixed as number) ?? 0, skipped: (evt.skipped as number) ?? 0 });
        }
      },
    );

    if (!result.ok) {
      setFixError(result.error ?? "Fix stages failed");
      setFixPhase("error");
    } else {
      setFixPhase("done");
      await refreshStatus();
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const exportRunning  = exportPhase === "running";
  const restoreRunning = restorePhase === "running";
  const canExport      = testPassed && exportPhase !== "running";
  const canRestore     = (status?.exported ?? 0) > 0 && restorePhase !== "running";

  return (
    <div className="space-y-6 max-w-3xl">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div>
        <h2 className="text-lg font-semibold text-amber-300">Terros Account Migration</h2>
        <p className="mt-1 text-sm text-gray-500">
          Export all Terros accounts to Supabase as a raw backup, then restore them after manually
          deleting and getting Terros support confirmation.
        </p>
      </div>

      {/* ── Status Badges ──────────────────────────────────────────────── */}
      <SectionCard>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-white">Supabase Snapshot Status</h3>
          <button
            onClick={refreshStatus}
            disabled={loadingStatus}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors disabled:opacity-40"
          >
            {loadingStatus ? "Refreshing…" : "↻ Refresh"}
          </button>
        </div>
        {status?.error ? (
          <div className="rounded-lg bg-red-950/50 border border-red-900/50 px-4 py-3 space-y-2">
            <p className="text-sm text-red-300 font-medium">Supabase table not found</p>
            <p className="text-xs text-red-400">{status.error}</p>
            <p className="text-xs text-gray-400">
              Run this SQL in your{" "}
              <a
                href="https://supabase.com/dashboard"
                target="_blank"
                rel="noreferrer"
                className="underline text-sky-400 hover:text-sky-300"
              >
                Supabase dashboard
              </a>
              {" "}→ SQL Editor:
            </p>
            <pre className="rounded bg-gray-950 p-3 text-[11px] text-gray-300 overflow-x-auto whitespace-pre-wrap select-all">{`CREATE TABLE terros_account_snapshots (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        text        NOT NULL UNIQUE,
  external_lead_id  text,
  owner_id          text,
  workflow_stage_id text,
  name              text,
  email             text,
  phone             text,
  address           text,
  -- extracted from snapshot.customFields for easy visibility in Supabase
  custom_fields     jsonb,
  -- full raw JSON from account/get — nothing is lost
  snapshot          jsonb       NOT NULL,
  source            text        DEFAULT 'account/get',
  exported_at       timestamptz DEFAULT now(),
  restored_at       timestamptz,
  restore_result    jsonb,
  status            text        DEFAULT 'exported'
);
CREATE INDEX ON terros_account_snapshots (status);
CREATE INDEX ON terros_account_snapshots (external_lead_id);`}</pre>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatusBadge label="Total" value={status?.total ?? "—"} color="border-gray-700 text-gray-300" />
            <StatusBadge label="Exported" value={status?.exported ?? "—"} color="border-amber-900/60 text-amber-300" />
            <StatusBadge label="Restored" value={status?.restored ?? "—"} color="border-emerald-900/60 text-emerald-300" />
            <StatusBadge label="Failed" value={status?.failed ?? "—"} color="border-red-900/60 text-red-300" />
          </div>
        )}
      </SectionCard>

      {/* ── Step 1: Test Export ────────────────────────────────────────── */}
      <SectionCard>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-white">Step 1 — Test Export</h3>
            <p className="mt-1 text-xs text-gray-500">
              Fetches 10 accounts and shows a preview. No data is written to Supabase. Validates
              that the Terros API is reachable and returning custom fields.
            </p>
          </div>
          <button
            onClick={handleTestExport}
            disabled={testPhase === "running"}
            className="flex-shrink-0 rounded-lg bg-gray-700 px-4 py-2 text-sm font-medium text-white hover:bg-gray-600 disabled:opacity-50 transition-colors"
          >
            {testPhase === "running" ? "Running…" : "Test Export"}
          </button>
        </div>

        {testPhase === "error" && (
          <div className="mt-4 rounded-lg bg-red-950/50 border border-red-900/50 px-4 py-3 text-sm text-red-300">
            {testError}
          </div>
        )}

        {testPhase === "done" && (
          <div className="mt-4 space-y-3">
            <div className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm ${testPassed ? "bg-emerald-950/50 border border-emerald-900/50 text-emerald-300" : "bg-red-950/50 border border-red-900/50 text-red-300"}`}>
              <span>{testPassed ? "✓" : "✗"}</span>
              <span>
                {testPassed
                  ? `Fetched ${testAccounts.length} accounts successfully. Total in Terros: ${testTotal === -1 ? "unknown (large)" : (testTotal?.toLocaleString() ?? "?")}`
                  : "No accounts returned — check API key and Terros connectivity."}
              </span>
            </div>

            {testAccounts.length > 0 && (
              <>
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead>
                    <tr className="border-b border-gray-800 text-gray-500">
                      <th className="pb-2 pr-4 font-medium">Account ID</th>
                      <th className="pb-2 pr-4 font-medium">Name</th>
                      <th className="pb-2 pr-4 font-medium">Ext. Lead ID</th>
                      <th className="pb-2 pr-4 font-medium">Stage</th>
                      <th className="pb-2 pr-4 font-medium">Owner</th>
                      <th className="pb-2 pr-4 font-medium">Custom Fields</th>
                      <th className="pb-2 font-medium">Inspect</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800/60">
                    {testAccounts.map((acc, i) => {
                      const resident = acc.resident as Record<string, unknown> | undefined;
                      const displayName =
                        String(resident?.name ?? "").trim() ||
                        [resident?.firstName, resident?.lastName].filter(Boolean).join(" ") ||
                        String(acc.name ?? "—");
                      const cfs = acc.customFields as Record<string, unknown> | undefined;
                      const cfCount = cfs ? Object.keys(cfs).length : 0;
                      const extId   = String(acc.externalLeadId ?? "").trim() || "—";
                      const stageId = String(acc.workflowStageId ?? "").trim() || "—";
                      const ownerId = String(acc.ownerId ?? "").trim() || "—";
                      const acctId  = String(acc.accountId ?? acc.id ?? "");
                      return (
                        <tr key={i} className="text-gray-300">
                          <td className="py-2 pr-4 font-mono text-[11px] text-gray-500">
                            {acctId.slice(0, 16)}…
                          </td>
                          <td className="py-2 pr-4 truncate max-w-[140px]">{displayName}</td>
                          <td className="py-2 pr-4 font-mono text-[11px] text-gray-500">{extId.slice(0, 12)}{extId.length > 12 ? "…" : ""}</td>
                          <td className="py-2 pr-4 font-mono text-[11px] text-gray-500">{stageId === "—" ? <span className="text-gray-700">—</span> : stageId.slice(0, 10) + "…"}</td>
                          <td className="py-2 pr-4 font-mono text-[11px] text-gray-500">{ownerId === "—" ? <span className="text-gray-700">—</span> : ownerId.slice(0, 10) + "…"}</td>
                          <td className="py-2 pr-4">
                            {cfCount > 0 ? (
                              <span
                                title={cfs ? Object.entries(cfs).map(([k, v]) => `${k}: ${v}`).join("\n") : ""}
                                className="cursor-help text-emerald-400"
                              >
                                {cfCount} fields
                              </span>
                            ) : (
                              <span className="text-yellow-600">none</span>
                            )}
                          </td>
                          <td className="py-2">
                            <button
                              onClick={() => handleDebugAccount(acctId)}
                              className="text-sky-500 hover:text-sky-300 text-[11px] underline"
                            >
                              raw →
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              </>
            )}
          </div>
        )}
      </SectionCard>

      {/* ── Filter Test ────────────────────────────────────────────────── */}
      <SectionCard>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-white mb-1">Test API Filters</h3>
            <p className="text-xs text-gray-500">
              Checks whether <code className="text-gray-400">userId</code>, <code className="text-gray-400">zipCodes</code>,
              and <code className="text-gray-400">lastActionDate</code> filters return accounts not in the unfiltered baseline.
              If any show <span className="text-green-400">new IDs &gt; 0</span>, the export will go beyond 1,000.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <input
              type="text"
              placeholder="Zip (optional)"
              value={filterZip}
              onChange={e => setFilterZip(e.target.value)}
              className="w-28 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              maxLength={5}
            />
            <button
              onClick={handleTestFilters}
              disabled={filterLoading}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {filterLoading ? "Testing…" : "Test Filters"}
            </button>
          </div>
        </div>

        {filterResult && (
          <div className="mt-4 space-y-2">
            {filterResult.error && (
              <p className="text-xs text-red-400">{filterResult.error}</p>
            )}
            <div className="rounded-lg bg-gray-800 divide-y divide-gray-700 text-xs font-mono">
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-gray-400">Unfiltered baseline</span>
                <span className="text-white font-bold">{filterResult.unfiltered.toLocaleString()} accounts</span>
              </div>
              {filterResult.userId && (
                <div className="px-3 py-2 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400">userId: <span className="text-gray-300">{filterResult.userId.id}</span></span>
                    <span>
                      <span className="text-gray-300">{filterResult.userId.total} returned</span>
                      {" · "}
                      <span className={filterResult.userId.newIds > 0 ? "text-green-400 font-bold" : "text-gray-500"}>
                        +{filterResult.userId.newIds} new
                      </span>
                    </span>
                  </div>
                  {filterResult.userId.total === 0 && (
                    <pre className="text-[10px] text-gray-500 whitespace-pre-wrap break-all">{filterResult.userId.raw}</pre>
                  )}
                </div>
              )}
              {filterResult.stageId && (
                <div className="px-3 py-2 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400">stageIds: <span className="text-gray-300">{filterResult.stageId.stageId.slice(0, 20)}…</span></span>
                    <span>
                      <span className="text-gray-300">{filterResult.stageId.total} returned</span>
                      {" · "}
                      <span className={filterResult.stageId.newIds > 0 ? "text-green-400 font-bold" : filterResult.stageId.total > 0 ? "text-blue-400" : "text-gray-500"}>
                        {filterResult.stageId.total > 0 ? (filterResult.stageId.newIds > 0 ? `+${filterResult.stageId.newIds} new` : "✓ works (same accounts)") : "+0 new"}
                      </span>
                    </span>
                  </div>
                  {filterResult.stageId.total === 0 && (
                    <pre className="text-[10px] text-gray-500 whitespace-pre-wrap break-all">{filterResult.stageId.raw}</pre>
                  )}
                </div>
              )}
              {filterResult.zipCode && (
                <div className="px-3 py-2 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400">zipCodes: <span className="text-gray-300">{filterResult.zipCode.zip}</span></span>
                    <span>
                      <span className="text-gray-300">{filterResult.zipCode.total} returned</span>
                      {" · "}
                      <span className={filterResult.zipCode.newIds > 0 ? "text-green-400 font-bold" : "text-gray-500"}>
                        +{filterResult.zipCode.newIds} new
                      </span>
                    </span>
                  </div>
                  {filterResult.zipCode.total === 0 && (
                    <pre className="text-[10px] text-gray-500 whitespace-pre-wrap break-all">{filterResult.zipCode.raw}</pre>
                  )}
                </div>
              )}
              {filterResult.lastActionDate && (
                <div className="px-3 py-2 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400">lastActionDate: <span className="text-gray-300">{filterResult.lastActionDate.window}</span></span>
                    <span>
                      <span className="text-gray-300">{filterResult.lastActionDate.total} returned</span>
                      {" · "}
                      <span className={filterResult.lastActionDate.newIds > 0 ? "text-green-400 font-bold" : "text-gray-500"}>
                        +{filterResult.lastActionDate.newIds} new
                      </span>
                    </span>
                  </div>
                  {filterResult.lastActionDate.total === 0 && (
                    <pre className="text-[10px] text-gray-500 whitespace-pre-wrap break-all">{filterResult.lastActionDate.raw}</pre>
                  )}
                </div>
              )}
            </div>
            {filterResult.userId?.total === 0 && filterResult.zipCode?.total === 0 && filterResult.lastActionDate?.total === 0 && (
              <p className="text-xs text-amber-400 mt-2">
                ⚠ All filters returned 0 accounts (not just 0 new) — the filters may be broken or Terros is returning errors.
                Check the raw responses above for clues.
              </p>
            )}
          </div>
        )}
      </SectionCard>

      {/* ── Manual Account Inspector ───────────────────────────────────── */}
      <SectionCard>
        <h3 className="text-sm font-semibold text-white mb-1">Inspect Any Account</h3>
        <p className="text-xs text-gray-500 mb-3">
          Paste a Terros Account ID to see the exact raw <code className="text-gray-400">account/get</code> response,
          including all custom fields, workflowStageId, ownerId, and externalLeadId.
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            value={manualAccountId}
            onChange={(e) => setManualAccountId(e.target.value)}
            placeholder="Account.xxxxxxxxxxxxxxxx"
            className="flex-1 rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-sky-600"
          />
          <button
            onClick={() => { if (manualAccountId.trim()) handleDebugAccount(manualAccountId.trim()); }}
            disabled={!manualAccountId.trim() || debugLoading}
            className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-600 disabled:opacity-40 transition-colors"
          >
            {debugLoading ? "Fetching…" : "Inspect"}
          </button>
        </div>

        {debugOpen && (
          <div className="mt-4 rounded-lg border border-gray-700 bg-gray-950">
            <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800">
              <span className="text-xs font-semibold text-gray-300">
                Raw account/get response
                {debugResult && (
                  <span className="ml-2 font-mono text-gray-600">{debugResult.accountId}</span>
                )}
              </span>
              <button onClick={() => setDebugOpen(false)} className="text-gray-600 hover:text-gray-300 text-xs">✕ close</button>
            </div>
            {debugLoading ? (
              <p className="px-4 py-3 text-xs text-gray-500 animate-pulse">Fetching raw response…</p>
            ) : debugResult ? (
              <div className="p-4 space-y-4">
                {debugResult.parsed && (
                  <div>
                    <p className="text-[11px] font-semibold text-emerald-400 mb-1">
                      ✓ Parsed account — top-level keys: {Object.keys(debugResult.parsed).join(", ")}
                    </p>
                    {debugResult.parsed.customFields
                      ? <p className="text-[11px] text-emerald-300">customFields keys: {Object.keys(debugResult.parsed.customFields as Record<string, unknown>).join(", ")}</p>
                      : <p className="text-[11px] text-yellow-500">⚠ No customFields key found in parsed account</p>
                    }
                  </div>
                )}
                {debugResult.attempts.map((a, i) => (
                  <div key={i}>
                    <p className="text-[11px] font-semibold text-gray-500 mb-1">
                      Attempt {i + 1}: <span className="font-mono text-gray-400">{a.body}</span>
                      {" "}→ HTTP {a.status}{" "}
                      {a.ok ? <span className="text-emerald-400">✓</span> : <span className="text-red-400">✗</span>}
                    </p>
                    <pre className="rounded bg-gray-900 p-3 text-[11px] text-gray-300 overflow-x-auto max-h-80 whitespace-pre-wrap">
                      {(() => { try { return JSON.stringify(JSON.parse(a.raw), null, 2); } catch { return a.raw; } })()}
                    </pre>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </SectionCard>

      {/* ── Step 2: Export All ──────────────────────────────────────────── */}
      <SectionCard>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-white">Step 2 — Export All to Supabase</h3>
            <p className="mt-1 text-xs text-gray-500">
              Paginates through all Terros accounts, fetches full data via{" "}
              <code className="text-gray-400">account/get</code>, and saves each as a JSON snapshot.
              Re-running is safe — existing rows are overwritten.
            </p>
            {!testPassed && (
              <p className="mt-1.5 text-xs text-amber-500">Complete a passing test export first.</p>
            )}
          </div>
          <button
            onClick={handleExportAll}
            disabled={!canExport || exportRunning}
            className="flex-shrink-0 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {exportRunning ? "Exporting…" : "Export All"}
          </button>
        </div>

        {(exportPhase === "running" || exportPhase === "done") && (
          <div className="mt-4 space-y-2">
            {exportMsg && (
              <p className="text-xs text-gray-400 flex items-center gap-2">
                {exportPhase === "running" && <span className="inline-block h-2 w-2 rounded-full bg-amber-400 animate-pulse flex-shrink-0" />}
                {exportMsg}
              </p>
            )}
            {exportProgress.total > 0 && (
            <ProgressBar done={exportProgress.done} total={exportProgress.total} />
            )}
            {exportProgress.failed > 0 && (
              <p className="text-xs text-red-400">{exportProgress.failed} failed</p>
            )}
          </div>
        )}

        {exportPhase === "done" && (
          <div className="mt-3 flex items-center gap-2 rounded-lg bg-emerald-950/50 border border-emerald-900/50 px-4 py-2 text-sm text-emerald-300">
            <span>✓</span>
            <span>
              {exportProgress.done.toLocaleString()} accounts exported
              {exportProgress.failed > 0 ? ` (${exportProgress.failed} failed)` : ""}
            </span>
          </div>
        )}

        {exportPhase === "error" && (
          <div className="mt-3 rounded-lg bg-red-950/50 border border-red-900/50 px-4 py-3 text-sm text-red-300">
            {exportError}
          </div>
        )}
      </SectionCard>

      {/* ── Step 3: Manual Verification & Deletion ─────────────────────── */}
      <SectionCard>
        <h3 className="text-sm font-semibold text-white">Step 3 — Verify &amp; Delete (manual)</h3>
        <ol className="mt-2 space-y-1.5 text-xs text-gray-400 list-decimal list-inside">
          <li>Open the Supabase dashboard → <code className="text-gray-300">terros_account_snapshots</code> table.</li>
          <li>Confirm the row count matches Terros and that the <code className="text-gray-300">snapshot</code> column contains custom field data.</li>
          <li>
            Confirm with Terros support that the leaderboard bug is fixed and accounts can be re-created
            safely.
          </li>
          <li>Manually delete accounts in the Terros UI.</li>
          <li>Come back and click <strong className="text-white">Restore All</strong> below.</li>
        </ol>
      </SectionCard>

      {/* ── Step 4: Restore All ─────────────────────────────────────────── */}
      <SectionCard>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-white">Step 4 — Restore All to Terros</h3>
            <p className="mt-1 text-xs text-gray-500">
              Reads all <code className="text-gray-400">exported</code> rows from Supabase and
              re-creates each account via <code className="text-gray-400">account/add</code> (preserves workflow stage).
              Only processes rows not yet restored — safe to re-run. Failed rows stay marked{" "}
              <code className="text-gray-400">failed</code> for retry.
            </p>
            {(status?.exported ?? 0) === 0 && (
              <p className="mt-1.5 text-xs text-amber-500">
                Complete a full export and delete accounts in Terros first.
              </p>
            )}
          </div>
          <button
            onClick={handleRestoreAll}
            disabled={!canRestore || restoreRunning}
            className="flex-shrink-0 rounded-lg bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {restoreRunning ? "Restoring…" : "Restore All"}
          </button>
        </div>

        {(restorePhase === "running" || restorePhase === "done") && (
          <div className="mt-4 space-y-2">
            {restoreMsg && <p className="text-xs text-gray-400">{restoreMsg}</p>}
            <ProgressBar done={restoreProgress.done} total={restoreProgress.total} />
            {restoreProgress.failed > 0 && (
              <p className="text-xs text-red-400">{restoreProgress.failed} failed</p>
            )}
          </div>
        )}

        {restorePhase === "done" && (
          <div className="mt-3 flex items-center gap-2 rounded-lg bg-emerald-950/50 border border-emerald-900/50 px-4 py-2 text-sm text-emerald-300">
            <span>✓</span>
            <span>
              {restoreProgress.done.toLocaleString()} accounts restored
              {restoreProgress.failed > 0 ? ` (${restoreProgress.failed} failed — check Supabase for details)` : ""}
            </span>
          </div>
        )}

        {restorePhase === "error" && (
          <div className="mt-3 rounded-lg bg-red-950/50 border border-red-900/50 px-4 py-3 text-sm text-red-300">
            {restoreError}
          </div>
        )}
      </SectionCard>

      {/* ── Fix Stages ───────────────────────────────────────────────────── */}
      <SectionCard>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-white">Fix Stages — Assign stage to stageless accounts</h3>
            <p className="mt-1 text-xs text-gray-500">
              If a previous restore used <code className="text-gray-400">account/upsert</code> (which ignores{" "}
              <code className="text-gray-400">workflowStageId</code>), those accounts are stageless and
              invisible in Terros. This reads all <code className="text-gray-400">restored</code> rows from
              Supabase and calls <code className="text-gray-400">account/update</code> to assign each
              account its original stage — falling back to <strong className="text-white">Knock</strong> if
              the snapshot has no stage.
            </p>
          </div>
          <button
            onClick={handleFixStages}
            disabled={fixPhase === "running"}
            className="flex-shrink-0 rounded-lg bg-violet-700 px-4 py-2 text-sm font-medium text-white hover:bg-violet-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {fixPhase === "running" ? "Fixing…" : "Fix Stages"}
          </button>
        </div>

        {(fixPhase === "running" || fixPhase === "done") && (
          <div className="mt-4 space-y-2">
            {fixMsg && <p className="text-xs text-gray-400">{fixMsg}</p>}
            <ProgressBar done={fixProgress.done} total={fixProgress.total} />
            {fixProgress.failed > 0 && (
              <p className="text-xs text-red-400">{fixProgress.failed} failed</p>
            )}
          </div>
        )}

        {fixPhase === "done" && (
          <div className="mt-3 flex items-center gap-2 rounded-lg bg-emerald-950/50 border border-emerald-900/50 px-4 py-2 text-sm text-emerald-300">
            <span>✓</span>
            <span>
              {fixStats?.fixed.toLocaleString() ?? fixProgress.done.toLocaleString()} stages fixed
              {(fixStats?.skipped ?? 0) > 0 ? ` · ${fixStats!.skipped} skipped (no new accountId)` : ""}
              {fixProgress.failed > 0 ? ` · ${fixProgress.failed} failed` : ""}
            </span>
          </div>
        )}

        {fixPhase === "error" && (
          <div className="mt-3 rounded-lg bg-red-950/50 border border-red-900/50 px-4 py-3 text-sm text-red-300">
            {fixError}
          </div>
        )}
      </SectionCard>

    </div>
  );
}
