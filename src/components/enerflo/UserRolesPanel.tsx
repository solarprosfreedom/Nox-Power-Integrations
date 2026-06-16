"use client";

import { useState } from "react";
import type { EnsureAllUserRolesResult, EnsureRolesResult } from "@/lib/enerflo/ensure-user-roles";

const REQUIRED_ROLES = ["Setter", "Sales Rep"] as const;

type RunPhase = "idle" | "running" | "done" | "error";

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

function RoleTag({ role }: { role: string }) {
  const isRequired = REQUIRED_ROLES.map(r => r.toLowerCase()).includes(role.toLowerCase());
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-medium
        ${isRequired ? "bg-orange-500/20 text-orange-300 border border-orange-500/30" : "bg-gray-800 text-gray-400 border border-gray-700"}`}
    >
      {role}
    </span>
  );
}

function ResultRow({ row }: { row: EnsureRolesResult }) {
  const added = row.newRoles.filter(
    r => !row.previousRoles.map(p => p.toLowerCase()).includes(r.toLowerCase()),
  );

  const actionColor =
    row.action === "updated"
      ? "text-green-400"
      : row.action === "would_update"
        ? "text-yellow-400"
        : row.action === "error"
          ? "text-red-400"
          : "text-gray-500";

  const actionLabel =
    row.action === "updated"
      ? "Updated"
      : row.action === "would_update"
        ? "Would update"
        : row.action === "error"
          ? "Error"
          : "Skipped";

  return (
    <tr className="border-b border-gray-800 hover:bg-gray-800/30 transition-colors">
      <td className="px-4 py-3 text-sm text-white font-medium">{row.name}</td>
      <td className="px-4 py-3 text-xs text-gray-400">{row.email}</td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap gap-1">
          {row.previousRoles.length > 0
            ? row.previousRoles.map((r, i) => <RoleTag key={`${r}-${i}`} role={r} />)
            : <span className="text-xs text-gray-600 italic">none</span>}
        </div>
      </td>
      <td className="px-4 py-3">
        {added.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {added.map((r, i) => (
              <span key={`${r}-${i}`} className="inline-block rounded px-1.5 py-0.5 text-[11px] font-medium bg-green-900/40 text-green-300 border border-green-700">
                + {r}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-xs text-gray-600">—</span>
        )}
      </td>
      <td className={`px-4 py-3 text-xs font-medium ${actionColor}`}>
        {actionLabel}
        {row.skipReason === "already_has_required_roles" && (
          <span className="ml-1 text-gray-600">✓</span>
        )}
        {row.skipReason === "inactive" && (
          <span className="ml-1 text-gray-600">(inactive)</span>
        )}
        {row.skipReason === "admin_account" && (
          <span className="ml-1 text-gray-600">(admin)</span>
        )}
        {row.skipReason === "not_found_in_this_account" && (
          <span className="ml-1 text-gray-600">(different account)</span>
        )}
        {row.error && (
          <p className="mt-1 text-[10px] text-red-400 font-normal">{row.error}</p>
        )}
      </td>
    </tr>
  );
}

async function runEnsureRoles(dryRun: boolean): Promise<{
  result: EnsureAllUserRolesResult | null;
  error: string | null;
}> {
  const res = await fetch("/api/enerflo/ensure-user-roles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dryRun }),
  });

  if (!res.ok || !res.body) {
    return { result: null, error: `HTTP ${res.status}` };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalResult: EnsureAllUserRolesResult | null = null;
  let errorMsg: string | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed) as Record<string, unknown>;
        if (msg.type === "complete") {
          finalResult = msg.result as EnsureAllUserRolesResult;
        } else if (msg.type === "error") {
          errorMsg = String(msg.message ?? "Unknown error");
        }
      } catch { /* skip */ }
    }
  }

  return { result: finalResult, error: errorMsg };
}

export default function UserRolesPanel() {
  const [phase, setPhase] = useState<RunPhase>("idle");
  const [dryRun, setDryRun] = useState(true);
  const [filterEmail, setFilterEmail] = useState("");
  const [result, setResult] = useState<EnsureAllUserRolesResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [progressMsg, setProgressMsg] = useState<string>("");

  async function handleRun() {
    setPhase("running");
    setResult(null);
    setErrorMsg(null);
    setProgressMsg("Fetching users…");

    const payload: Record<string, unknown> = { dryRun };
    if (filterEmail.trim()) payload.filterEmail = filterEmail.trim();

    try {
      const res = await fetch("/api/enerflo/ensure-user-roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok || !res.body) {
        setErrorMsg(`HTTP ${res.status}`);
        setPhase("error");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const msg = JSON.parse(trimmed) as Record<string, unknown>;
            if (msg.type === "phase") {
              setProgressMsg(String(msg.message ?? ""));
            } else if (msg.type === "progress") {
              setProgressMsg(`Checking user ${msg.done}/${msg.total} — ${msg.userName}`);
            } else if (msg.type === "complete") {
              setResult(msg.result as EnsureAllUserRolesResult);
              setPhase("done");
            } else if (msg.type === "error") {
              setErrorMsg(String(msg.message ?? "Unknown error"));
              setPhase("error");
            }
          } catch { /* skip */ }
        }
      }

      if (phase !== "done" && phase !== "error") {
        setPhase("done");
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  }

  const busy = phase === "running";
  const updates = result?.samples.filter(s => s.action === "updated" || s.action === "would_update") ?? [];
  const skipped = result?.samples.filter(s => s.action === "skipped") ?? [];
  const errors = result?.samples.filter(s => s.action === "error") ?? [];

  return (
    <div className="px-8 py-8 space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-semibold text-white">Ensure User Roles</h2>
        <p className="text-sm text-gray-500 mt-1">
          Adds{" "}
          {REQUIRED_ROLES.map((r, i) => (
            <span key={r}>
              <code className="text-orange-300/90">{r}</code>
              {i < REQUIRED_ROLES.length - 1 ? " + " : ""}
            </span>
          ))}{" "}
          to every active Enerflo user that is missing them.
          Never removes existing roles. Skips inactive and admin accounts.
        </p>
      </div>

      {/* Controls */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/50 px-5 py-4 space-y-4">
        {/* Single-user test */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[220px]">
            <label className="block text-xs text-gray-500 mb-1">
              Test single user (optional — leave blank to run all)
            </label>
            <input
              type="email"
              value={filterEmail}
              onChange={e => setFilterEmail(e.target.value)}
              disabled={busy}
              placeholder="email@example.com"
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-600
                focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500 disabled:opacity-50"
            />
          </div>
        </div>

        {/* Dry run + run button */}
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={dryRun}
              onChange={e => setDryRun(e.target.checked)}
              disabled={busy}
              className="h-4 w-4 rounded border-gray-600 bg-gray-800 text-orange-500 focus:ring-orange-500"
            />
            <span className="text-sm text-gray-300">Dry run (preview only — no changes)</span>
          </label>

          <button
            onClick={handleRun}
            disabled={busy}
            className={`ml-auto flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold transition-colors
              ${busy
                ? "bg-gray-700 text-gray-400 cursor-not-allowed"
                : dryRun
                  ? "bg-yellow-600 hover:bg-yellow-500 text-white"
                  : "bg-orange-600 hover:bg-orange-500 text-white"
              }`}
          >
            {busy && <Spinner />}
            {busy
              ? "Running…"
              : filterEmail.trim()
                ? dryRun ? "Preview this user" : "Apply to this user"
                : dryRun ? "Preview all users" : "Apply to all users"}
          </button>
        </div>
      </div>

      {/* Progress */}
      {busy && progressMsg && (
        <div className="flex items-center gap-3 rounded-lg border border-yellow-900/40 bg-yellow-900/10 px-4 py-3 text-sm text-yellow-300">
          <Spinner className="h-4 w-4 flex-shrink-0" />
          {progressMsg}
        </div>
      )}

      {/* Error */}
      {phase === "error" && errorMsg && (
        <div className="rounded-lg border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-300">
          {errorMsg}
        </div>
      )}

      {/* Summary */}
      {result && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "Scanned", value: result.scanned, color: "text-white" },
            {
              label: result.dryRun ? "Would update" : "Updated",
              value: result.updated,
              color: result.updated > 0 ? "text-orange-400" : "text-gray-400",
            },
            { label: "Already correct", value: result.skipped, color: "text-gray-400" },
            { label: "Errors", value: result.errors.length, color: result.errors.length > 0 ? "text-red-400" : "text-gray-400" },
          ].map(({ label, value, color }) => (
            <div key={label} className="rounded-lg border border-gray-800 bg-gray-900/50 px-4 py-3 text-center">
              <p className={`text-2xl font-bold ${color}`}>{value}</p>
              <p className="mt-0.5 text-xs text-gray-500">{label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Errors list */}
      {result && result.errors.length > 0 && (
        <div className="rounded-lg border border-red-800 bg-red-900/10 px-4 py-3">
          <p className="text-sm font-medium text-red-300 mb-2">Errors ({result.errors.length})</p>
          <ul className="space-y-1">
            {result.errors.map((e, i) => (
              <li key={i} className="text-xs text-red-400">{e}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Results table */}
      {result && updates.length + errors.length > 0 && (
        <div className="rounded-xl border border-gray-800 overflow-hidden">
          <p className="px-4 py-3 text-xs font-semibold uppercase tracking-widest text-gray-500 border-b border-gray-800">
            {result.dryRun ? "Would change" : "Changed"} ({updates.length + errors.length})
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-gray-800 bg-gray-900">
                <tr>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500">Name</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500">Email</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500">Current roles</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500">Adding</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500">Status</th>
                </tr>
              </thead>
              <tbody>
                {[...updates, ...errors].map(row => (
                  <ResultRow key={row.userId} row={row} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Already-correct count */}
      {result && skipped.length > 0 && updates.length + errors.length > 0 && (
        <p className="text-xs text-gray-600 text-center">
          {skipped.filter(s => s.skipReason === "already_has_required_roles").length} user(s) already had the required roles — not shown above.
        </p>
      )}

      {/* All good */}
      {result && updates.length === 0 && errors.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-800 py-12 text-center">
          <p className="text-3xl">✅</p>
          <p className="mt-3 text-base font-medium text-gray-300">All users already have the required roles</p>
          <p className="mt-1 text-sm text-gray-600">No changes needed.</p>
        </div>
      )}
    </div>
  );
}
