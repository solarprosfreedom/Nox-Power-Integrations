"use client";

import { useCallback, useMemo, useState } from "react";
import type {
  OwnerSetterSummary,
  EnerfloSetterBackfillResult,
} from "@/lib/enerflo/backfill-setter-from-owner";

type LoadPhase = "idle" | "loading-reps" | "error";
type ScanPhase = "idle" | "scanning" | "done" | "error";
type RowRunState = "idle" | "running" | "done" | "error";
type GlobalRunPhase = "idle" | "running" | "done" | "error";

interface GlobalRunProgress {
  current: number;
  total: number;
  repName: string;
}

interface GlobalRunSummary {
  repsProcessed: number;
  totalUpdated: number;
  totalSkipped: number;
  repErrors: number;
  dryRun: boolean;
}

interface RowStatus {
  state: RowRunState;
  result?: EnerfloSetterBackfillResult;
  error?: string;
}

function summaryFromBackfillResult(
  rep: OwnerSetterSummary,
  result: EnerfloSetterBackfillResult,
): OwnerSetterSummary {
  const missingAfter = Math.max(0, result.eligible - (result.dryRun ? 0 : result.updated));
  return {
    ...rep,
    totalLeads: result.scanned,
    missingSetter: missingAfter,
    hasSetter: Math.max(0, result.scanned - result.eligible),
  };
}

function parseEligibleByOwner(raw: Record<string, unknown>): Map<number, string[]> {
  const map = new Map<number, string[]>();
  for (const [key, value] of Object.entries(raw)) {
    const ownerUserId = Number(key);
    if (!Number.isFinite(ownerUserId) || ownerUserId <= 0) continue;
    if (!Array.isArray(value)) continue;
    const ids = value.map(id => String(id).trim()).filter(Boolean);
    if (ids.length) map.set(ownerUserId, ids);
  }
  return map;
}

async function fetchAllReps(): Promise<OwnerSetterSummary[]> {
  const res = await fetch("/api/enerflo/setter-backfill/reps", { method: "POST" });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(String(data.error ?? `Failed to load reps (${res.status})`));
  }
  return (data.summaries as OwnerSetterSummary[]) ?? [];
}

async function consumeScanStream(
  baseReps: OwnerSetterSummary[],
  onProgress: (page: number, rowsScanned: number, summaries: OwnerSetterSummary[]) => void,
): Promise<{ summaries: OwnerSetterSummary[]; eligibleByOwner: Map<number, string[]> }> {
  const res = await fetch("/api/enerflo/setter-backfill/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ baseReps }),
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Scan failed (${res.status})`);
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let summaries: OwnerSetterSummary[] = baseReps;
  let eligibleByOwner = new Map<number, string[]>();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const evt = JSON.parse(trimmed) as Record<string, unknown>;
      if (evt.type === "progress") {
        onProgress(
          Number(evt.page ?? 0),
          Number(evt.rowsScanned ?? 0),
          (evt.summaries as OwnerSetterSummary[] | undefined) ?? summaries,
        );
      } else if (evt.type === "partial") {
        summaries = (evt.summaries as OwnerSetterSummary[]) ?? summaries;
        onProgress(0, 0, summaries);
      } else if (evt.type === "complete") {
        summaries = (evt.summaries as OwnerSetterSummary[]) ?? summaries;
        eligibleByOwner = parseEligibleByOwner(
          (evt.eligibleByOwner as Record<string, unknown>) ?? {},
        );
      } else if (evt.type === "error") {
        throw new Error(String(evt.message ?? "Scan failed"));
      }
    }
  }

  return { summaries, eligibleByOwner };
}

async function consumeBackfillStream(
  ownerUserId: number,
  dryRun: boolean,
  customerIds: string[],
  ownerTotalLeads: number,
  limit?: number,
): Promise<EnerfloSetterBackfillResult> {
  const res = await fetch("/api/enerflo/setter-backfill/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ownerUserId, dryRun, customerIds, ownerTotalLeads, limit }),
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Backfill failed (${res.status})`);
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let result: EnerfloSetterBackfillResult | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const evt = JSON.parse(trimmed) as Record<string, unknown>;
      if (evt.type === "complete") {
        result = evt.result as EnerfloSetterBackfillResult;
      } else if (evt.type === "error") {
        throw new Error(String(evt.message ?? "Backfill failed"));
      }
    }
  }

  if (!result) throw new Error("Backfill finished without a result");
  return result;
}

export default function SetterBackfillPanel() {
  const [allReps, setAllReps] = useState<OwnerSetterSummary[]>([]);
  const [countById, setCountById] = useState<Map<number, OwnerSetterSummary>>(new Map());
  const [eligibleByOwner, setEligibleByOwner] = useState<Map<number, string[]>>(new Map());
  const [loadPhase, setLoadPhase] = useState<LoadPhase>("idle");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [scanPhase, setScanPhase] = useState<ScanPhase>("idle");
  const [scanPage, setScanPage] = useState(0);
  const [scanRows, setScanRows] = useState(0);
  const [scanError, setScanError] = useState<string | null>(null);
  const [dryRun, setDryRun] = useState(false);
  const [rowStatus, setRowStatus] = useState<Record<number, RowStatus>>({});
  const [globalRunPhase, setGlobalRunPhase] = useState<GlobalRunPhase>("idle");
  const [globalProgress, setGlobalProgress] = useState<GlobalRunProgress | null>(null);
  const [globalSummary, setGlobalSummary] = useState<GlobalRunSummary | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);

  // Single-user test runner (skips the global scan — scans just one rep's leads)
  const [singleQuery, setSingleQuery] = useState("");
  const [singleSelected, setSingleSelected] = useState<OwnerSetterSummary | null>(null);
  // Empty = process ALL of this rep's eligible leads. Set a number only for a
  // quick capped preview — leaving it blank avoids silently missing leads.
  const [singleLimit, setSingleLimit] = useState("");
  const [singleStatus, setSingleStatus] = useState<{
    state: RowRunState;
    result?: EnerfloSetterBackfillResult;
    error?: string;
    dryRun?: boolean;
  }>({ state: "idle" });

  const visibleRows = useMemo(() => {
    return allReps.map(rep => {
      const counts = countById.get(rep.ownerUserId);
      return counts ?? rep;
    });
  }, [allReps, countById]);

  const anyRowBusy =
    globalRunPhase === "running" ||
    Object.values(rowStatus).some(s => s.state === "running");
  const scanReady = scanPhase === "done";
  const repsLoaded = allReps.length > 0;

  const handleLoadClick = useCallback(async () => {
    if (anyRowBusy || scanPhase === "scanning") return;

    if (repsLoaded) {
      setAllReps([]);
      setCountById(new Map());
      setEligibleByOwner(new Map());
      setLoadPhase("idle");
      setLoadError(null);
      setScanPhase("idle");
      setScanPage(0);
      setScanRows(0);
      setScanError(null);
      setRowStatus({});
      setGlobalRunPhase("idle");
      setGlobalProgress(null);
      setGlobalSummary(null);
      setGlobalError(null);
      return;
    }

    setLoadPhase("loading-reps");
    setLoadError(null);

    try {
      const reps = await fetchAllReps();
      setAllReps(reps);
      setLoadPhase("idle");
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
      setLoadPhase("error");
    }
  }, [anyRowBusy, repsLoaded, scanPhase]);

  const runScan = useCallback(async () => {
    if (!repsLoaded || scanPhase === "scanning" || anyRowBusy) return;

    setScanPhase("scanning");
    setScanError(null);
    setScanPage(0);
    setScanRows(0);
    setRowStatus({});
    setGlobalRunPhase("idle");
    setGlobalProgress(null);
    setGlobalSummary(null);
    setGlobalError(null);

    try {
      const { summaries, eligibleByOwner: eligible } = await consumeScanStream(
        allReps,
        (page, rowsScanned, partialSummaries) => {
          if (page > 0) setScanPage(page);
          if (rowsScanned > 0) setScanRows(rowsScanned);
          setCountById(new Map(partialSummaries.map(s => [s.ownerUserId, s])));
        },
      );

      setCountById(new Map(summaries.map(s => [s.ownerUserId, s])));
      setEligibleByOwner(eligible);
      setScanPhase("done");
    } catch (e) {
      setScanError(e instanceof Error ? e.message : String(e));
      setScanPhase("error");
    }
  }, [allReps, anyRowBusy, repsLoaded, scanPhase]);

  const applyBackfillResult = useCallback(
    (rep: OwnerSetterSummary, result: EnerfloSetterBackfillResult, cachedIds: string[]) => {
      const ownerUserId = rep.ownerUserId;

      setRowStatus(prev => ({
        ...prev,
        [ownerUserId]: { state: "done", result },
      }));

      setCountById(prev => {
        const next = new Map(prev);
        next.set(ownerUserId, summaryFromBackfillResult(rep, result));
        return next;
      });

      if (!dryRun) {
        setEligibleByOwner(prev => {
          const next = new Map(prev);
          const remainingEligible = Math.max(0, result.eligible - result.updated);
          if (remainingEligible === 0) {
            next.delete(ownerUserId);
          } else {
            next.set(ownerUserId, cachedIds.slice(result.updated));
          }
          return next;
        });
      }
    },
    [dryRun],
  );

  const runBackfill = useCallback(async (rep: OwnerSetterSummary) => {
    const ownerUserId = rep.ownerUserId;
    const cachedIds = eligibleByOwner.get(ownerUserId) ?? [];

    setRowStatus(prev => ({
      ...prev,
      [ownerUserId]: { state: "running" },
    }));

    try {
      const result = await consumeBackfillStream(
        ownerUserId,
        dryRun,
        cachedIds,
        rep.totalLeads,
      );
      applyBackfillResult(rep, result, cachedIds);
      return result;
    } catch (e) {
      setRowStatus(prev => ({
        ...prev,
        [ownerUserId]: {
          state: "error",
          error: e instanceof Error ? e.message : String(e),
        },
      }));
      throw e;
    }
  }, [applyBackfillResult, dryRun, eligibleByOwner]);

  const runAllBackfill = useCallback(async () => {
    if (!scanReady || globalRunPhase === "running" || anyRowBusy) return;

    const targets = visibleRows
      .filter(rep => rep.missingSetter > 0)
      .filter(rep => (eligibleByOwner.get(rep.ownerUserId)?.length ?? 0) > 0)
      .sort((a, b) => b.missingSetter - a.missingSetter);

    if (targets.length === 0) return;

    setGlobalRunPhase("running");
    setGlobalError(null);
    setGlobalSummary(null);
    setGlobalProgress({ current: 0, total: targets.length, repName: "" });

    let totalUpdated = 0;
    let totalSkipped = 0;
    let repErrors = 0;

    for (let i = 0; i < targets.length; i++) {
      const rep = targets[i]!;
      setGlobalProgress({
        current: i + 1,
        total: targets.length,
        repName: rep.ownerName,
      });

      try {
        const result = await runBackfill(rep);
        totalUpdated += result.updated;
        totalSkipped += result.skipped;
      } catch {
        repErrors++;
      }
    }

    setGlobalRunPhase(repErrors > 0 ? "error" : "done");
    setGlobalSummary({
      repsProcessed: targets.length,
      totalUpdated,
      totalSkipped,
      repErrors,
      dryRun,
    });
    setGlobalProgress(null);

    if (repErrors > 0) {
      setGlobalError(`${repErrors} rep(s) failed — see row errors below. Others may have completed.`);
    }
  }, [anyRowBusy, dryRun, eligibleByOwner, globalRunPhase, runBackfill, scanReady, visibleRows]);

  const singleMatches = useMemo(() => {
    const q = singleQuery.trim().toLowerCase();
    if (!q) return [];
    return allReps
      .filter(
        r =>
          r.ownerName.toLowerCase().includes(q) ||
          (r.ownerEmail ?? "").toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [allReps, singleQuery]);

  const singleBusy = singleStatus.state === "running";

  const runSingleUser = useCallback(
    async (asDryRun: boolean) => {
      if (!singleSelected) return;
      const lim = parseInt(singleLimit, 10);
      const limit = Number.isFinite(lim) && lim > 0 ? lim : undefined;
      setSingleStatus({ state: "running" });
      try {
        const result = await consumeBackfillStream(
          singleSelected.ownerUserId,
          asDryRun,
          [],
          0,
          limit,
        );
        setSingleStatus({ state: "done", result, dryRun: asDryRun });
      } catch (e) {
        setSingleStatus({ state: "error", error: e instanceof Error ? e.message : String(e) });
      }
    },
    [singleSelected, singleLimit],
  );

  const loadButtonLabel = (() => {
    if (loadPhase === "loading-reps") return "Loading reps…";
    if (repsLoaded) return "Clear";
    return "Load reps";
  })();

  const repsWithMissing = visibleRows.filter(r => r.missingSetter > 0).length;
  const totalEligibleCustomers = useMemo(() => {
    let total = 0;
    for (const rep of visibleRows) {
      if (rep.missingSetter <= 0) continue;
      total += eligibleByOwner.get(rep.ownerUserId)?.length ?? 0;
    }
    return total;
  }, [eligibleByOwner, visibleRows]);

  return (
    <div className="px-8 py-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-white">Setter Backfill</h2>
          <p className="text-sm text-gray-500 mt-1 max-w-2xl">
            Copy Lead Owner to Setter on existing customers. Golden rule: only updates rows where Setter
            is empty — never overwrites an existing setter. Scan once, then backfill per rep or run all
            reps globally.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={dryRun}
              onChange={e => setDryRun(e.target.checked)}
              className="rounded border-gray-600 bg-gray-800 text-orange-500 focus:ring-orange-500/40"
            />
            Dry run (preview only)
          </label>
          <button
            type="button"
            onClick={handleLoadClick}
            disabled={loadPhase === "loading-reps" || anyRowBusy || scanPhase === "scanning"}
            className="rounded-lg border border-gray-700 bg-gray-900 px-4 py-2 text-sm font-medium text-gray-200 hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loadButtonLabel}
          </button>
          {repsLoaded && (
            <button
              type="button"
              onClick={runScan}
              disabled={scanPhase === "scanning" || anyRowBusy}
              className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {scanPhase === "scanning"
                ? `Scanning all… p${scanPage || 1}${scanRows > 0 ? ` · ${scanRows.toLocaleString()} rows` : ""}`
                : scanReady
                  ? "Re-scan all customers"
                  : "Scan all customers"}
            </button>
          )}
          {scanReady && repsWithMissing > 0 && (
            <button
              type="button"
              onClick={runAllBackfill}
              disabled={anyRowBusy || totalEligibleCustomers === 0}
              className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {globalRunPhase === "running"
                ? globalProgress
                  ? `${dryRun ? "Previewing" : "Backfilling"} all… ${globalProgress.current}/${globalProgress.total}`
                  : "Backfilling all…"
                : dryRun
                  ? "Preview all reps"
                  : "Backfill all reps"}
            </button>
          )}
        </div>
      </div>

      {repsLoaded && (
        <div className="mb-6 rounded-xl border border-gray-800 bg-gray-950/40 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">Try one rep (no full scan)</h3>
            <span className="text-xs text-gray-500">Scans only this rep&apos;s leads</span>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="relative">
              <label className="mb-1 block text-xs text-gray-500">Search rep</label>
              <input
                type="text"
                value={singleQuery}
                onChange={e => {
                  setSingleQuery(e.target.value);
                  setSingleSelected(null);
                }}
                placeholder="name or email"
                className="w-64 rounded-md border border-gray-700 bg-gray-900 px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-orange-500/40"
              />
              {singleQuery.trim() && !singleSelected && singleMatches.length > 0 && (
                <div className="absolute z-10 mt-1 max-h-56 w-64 overflow-y-auto rounded-md border border-gray-700 bg-gray-900 shadow-lg">
                  {singleMatches.map(rep => (
                    <button
                      key={rep.ownerUserId}
                      type="button"
                      onClick={() => {
                        setSingleSelected(rep);
                        setSingleQuery(rep.ownerName);
                      }}
                      className="block w-full px-3 py-2 text-left text-sm text-gray-200 hover:bg-gray-800"
                    >
                      {rep.ownerName}
                      <span className="block text-xs text-gray-500">
                        {rep.ownerEmail ?? `ID ${rep.ownerUserId}`}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-500">Max leads (blank = all)</label>
              <input
                type="number"
                min={1}
                value={singleLimit}
                onChange={e => setSingleLimit(e.target.value)}
                placeholder="all"
                className="w-28 rounded-md border border-gray-700 bg-gray-900 px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-orange-500/40"
              />
            </div>
            <button
              type="button"
              disabled={!singleSelected || singleBusy || scanPhase === "scanning" || globalRunPhase === "running"}
              onClick={() => runSingleUser(true)}
              className="rounded-lg border border-gray-700 bg-gray-900 px-4 py-2 text-sm font-medium text-gray-200 hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
            >
              {singleBusy ? "Running…" : "Preview (dry run)"}
            </button>
            <button
              type="button"
              disabled={!singleSelected || singleBusy || scanPhase === "scanning" || globalRunPhase === "running"}
              onClick={() => runSingleUser(false)}
              className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-500 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
            >
              {singleBusy ? "Running…" : "Backfill this rep"}
            </button>
          </div>
          {singleSelected && (
            <p className="mt-2 text-xs text-gray-400">
              Selected: <span className="text-gray-200">{singleSelected.ownerName}</span>{" "}
              <span className="text-gray-500">
                ({singleSelected.ownerEmail ?? `ID ${singleSelected.ownerUserId}`})
              </span>
            </p>
          )}
          {singleStatus.state === "running" && (
            <p className="mt-2 text-sm text-orange-200">
              Scanning this rep&apos;s leads in Enerflo… this can take a minute.
            </p>
          )}
          {singleStatus.state === "done" && singleStatus.result && (
            <p className="mt-2 text-sm text-green-400">
              ✓ {singleStatus.dryRun ? "Would update" : "Updated"} {singleStatus.result.updated}
              {` · scanned ${singleStatus.result.scanned}`}
              {singleStatus.result.skipped > 0 && ` · skipped ${singleStatus.result.skipped}`}
              {singleStatus.result.errors.length > 0 && ` · errors ${singleStatus.result.errors.length}`}
            </p>
          )}
          {singleStatus.state === "error" && (
            <p className="mt-2 text-sm text-red-400">{singleStatus.error}</p>
          )}
        </div>
      )}

      {loadPhase === "loading-reps" && (
        <div className="mb-6 rounded-lg border border-orange-900/40 bg-orange-950/20 px-4 py-3 text-sm text-orange-200">
          Loading all Enerflo sales reps…
        </div>
      )}

      {scanPhase === "scanning" && (
        <div className="mb-6 rounded-lg border border-orange-900/40 bg-orange-950/20 px-4 py-3 text-sm text-orange-200">
          Scanning all Enerflo customers once… page {scanPage || 1}
          {scanRows > 0 && ` · ${scanRows.toLocaleString()} rows processed`}
        </div>
      )}

      {loadError && (
        <div className="mb-6 rounded-lg border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-300">
          {loadError}
        </div>
      )}

      {scanError && (
        <div className="mb-6 rounded-lg border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-300">
          {scanError}
        </div>
      )}

      {globalRunPhase === "running" && globalProgress && (
        <div className="mb-6 rounded-lg border border-emerald-900/40 bg-emerald-950/20 px-4 py-3 text-sm text-emerald-200">
          {dryRun ? "Previewing" : "Backfilling"} all reps ({globalProgress.current}/
          {globalProgress.total}) — <strong>{globalProgress.repName}</strong>
          {!dryRun && " · empty setters only, never overwriting existing setters"}
        </div>
      )}

      {globalSummary && globalRunPhase === "done" && (
        <div className="mb-6 rounded-lg border border-emerald-800 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-200">
          ✓ Global {globalSummary.dryRun ? "preview" : "backfill"} complete —{" "}
          {globalSummary.repsProcessed} rep(s),{" "}
          {globalSummary.dryRun ? "would update" : "updated"} {globalSummary.totalUpdated},{" "}
          skipped {globalSummary.totalSkipped}
        </div>
      )}

      {globalError && (
        <div className="mb-6 rounded-lg border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-300">
          {globalError}
        </div>
      )}

      {visibleRows.length > 0 && (
        <p className="mb-4 text-xs text-gray-500">
          {allReps.length} reps loaded
          {scanReady && repsWithMissing > 0 && (
            <>
              {` · ${repsWithMissing} with missing setter`}
              {totalEligibleCustomers > 0 && ` · ${totalEligibleCustomers.toLocaleString()} customers eligible`}
            </>
          )}
          {!scanReady && " · scan all customers to load counts"}
        </p>
      )}

      {!repsLoaded && loadPhase === "idle" && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-800 py-20 text-center">
          <p className="text-4xl">👤</p>
          <p className="mt-3 text-base font-medium text-gray-400">No reps loaded</p>
          <p className="mt-1 text-sm text-gray-600 max-w-md">
            1. Load reps — fetches every sales rep.
            <br />
            2. Scan all customers — one pass, counts for everyone.
            <br />
            3. Backfill setter — per rep, or use Backfill all reps after scan.
          </p>
        </div>
      )}

      {visibleRows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-gray-800">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-900/80 text-left text-xs uppercase tracking-wider text-gray-500">
                <th className="px-4 py-3 font-semibold">Sales rep</th>
                <th className="px-4 py-3 font-semibold text-right">Leads owned</th>
                <th className="px-4 py-3 font-semibold text-right">Missing setter</th>
                <th className="px-4 py-3 font-semibold text-right">Has setter</th>
                <th className="px-4 py-3 font-semibold text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/80">
              {visibleRows.map(row => {
                const status = rowStatus[row.ownerUserId];
                const isRunning = status?.state === "running";
                const countsReady = scanReady && countById.has(row.ownerUserId);
                const canRun = scanReady && !isRunning && !anyRowBusy;

                return (
                  <tr key={row.ownerUserId} className="bg-gray-950/40 hover:bg-gray-900/40">
                    <td className="px-4 py-3">
                      <p className="font-medium text-white">{row.ownerName}</p>
                      <p className="text-xs text-gray-500">
                        {row.ownerEmail ?? `ID ${row.ownerUserId}`}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-300">
                      {countsReady ? row.totalLeads : "—"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      <span className={row.missingSetter > 0 ? "text-amber-400 font-medium" : "text-gray-500"}>
                        {countsReady ? row.missingSetter : "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-500">
                      {countsReady ? row.hasSetter : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex flex-col items-end gap-1">
                        <button
                          type="button"
                          disabled={!canRun}
                          onClick={() => runBackfill(row)}
                          className="rounded-md border border-orange-700/60 bg-orange-950/40 px-3 py-1.5 text-xs font-medium text-orange-200 hover:bg-orange-900/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                          {!scanReady
                            ? "Scan first"
                            : isRunning
                              ? "Updating…"
                              : countsReady && row.missingSetter === 0
                                ? "Complete"
                                : dryRun
                                  ? "Preview backfill"
                                  : "Backfill setter"}
                        </button>
                        {status?.state === "done" && status.result && (
                          <span className="text-[11px] text-green-400">
                            ✓ {dryRun ? "Would update" : "Updated"} {status.result.updated}
                            {status.result.skipped > 0 && ` · skipped ${status.result.skipped}`}
                          </span>
                        )}
                        {status?.state === "error" && (
                          <span className="text-[11px] text-red-400 max-w-[200px] truncate" title={status.error}>
                            {status.error}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
