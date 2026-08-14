"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ActionStatus,
  BatchStatus,
  InactiveRepAccountLog,
  InactiveRepAutomationLogs,
  InactiveRepBatchLog,
} from "@/lib/inactive-reps/types";

type AccountFilter = "all" | ActionStatus;

const ACCOUNT_FILTERS: Array<{ id: AccountFilter; label: string }> = [
  { id: "all", label: "All accounts" },
  { id: "pending", label: "Pending" },
  { id: "success", label: "Deactivated" },
  { id: "skipped", label: "Skipped" },
  { id: "blocked", label: "Blocked" },
  { id: "failed", label: "Failed" },
];

const DATE_TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Phoenix",
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : DATE_TIME.format(date);
}

function batchStatus(status: BatchStatus): { label: string; style: string } {
  if (status === "completed") return { label: "Completed", style: "bg-emerald-950 text-emerald-300 ring-emerald-800" };
  if (status === "partial") return { label: "Needs review", style: "bg-amber-950 text-amber-300 ring-amber-800" };
  if (status === "processing") return { label: "Processing", style: "bg-cyan-950 text-cyan-300 ring-cyan-800" };
  if (status === "emailed") return { label: "Email sent", style: "bg-blue-950 text-blue-300 ring-blue-800" };
  if (status === "email_failed") return { label: "Email failed", style: "bg-red-950 text-red-300 ring-red-800" };
  return { label: status === "emailing" ? "Sending" : "Preparing", style: "bg-gray-800 text-gray-300 ring-gray-700" };
}

function actionStatus(status: ActionStatus): { label: string; style: string } {
  if (status === "success") return { label: "Deactivated", style: "bg-emerald-950 text-emerald-300 ring-emerald-800" };
  if (status === "skipped") return { label: "Skipped", style: "bg-sky-950 text-sky-300 ring-sky-800" };
  if (status === "blocked") return { label: "Blocked", style: "bg-amber-950 text-amber-300 ring-amber-800" };
  if (status === "failed") return { label: "Failed", style: "bg-red-950 text-red-300 ring-red-800" };
  return { label: "Pending", style: "bg-gray-800 text-gray-300 ring-gray-700" };
}

function StatusBadge({ label, style }: { label: string; style: string }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset ${style}`}>
      {label}
    </span>
  );
}

function EmailLog({ batch }: { batch: InactiveRepBatchLog }) {
  const status = batchStatus(batch.status);
  return (
    <article className="rounded-xl border border-gray-800 bg-gray-900/70 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-white">Report for {batch.reportDate}</h3>
            <StatusBadge {...status} />
          </div>
          <p className="mt-1 max-w-3xl truncate text-xs text-gray-500" title={batch.subject}>
            {batch.subject}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs font-medium text-gray-300">{formatDateTime(batch.emailedAt)}</p>
          <p className="mt-1 text-[10px] uppercase tracking-wider text-gray-600">Email confirmed</p>
        </div>
      </div>

      <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg bg-gray-950/70 p-3">
          <dt className="text-gray-600">Recipients</dt>
          <dd className="mt-1 break-words font-medium text-gray-300">{batch.recipients.join(", ")}</dd>
        </div>
        <div className="rounded-lg bg-gray-950/70 p-3">
          <dt className="text-gray-600">Included</dt>
          <dd className="mt-1 font-medium text-gray-300">
            {batch.candidateCount} reps · {batch.accountCount} accounts
          </dd>
        </div>
        <div className="rounded-lg bg-gray-950/70 p-3">
          <dt className="text-gray-600">Review window ends</dt>
          <dd className="mt-1 font-medium text-gray-300">{formatDateTime(batch.deactivationDueAt)}</dd>
        </div>
        <div className="rounded-lg bg-gray-950/70 p-3">
          <dt className="text-gray-600">Processing completed</dt>
          <dd className="mt-1 font-medium text-gray-300">{formatDateTime(batch.completedAt)}</dd>
        </div>
      </dl>

      {batch.errors.length > 0 && (
        <div className="mt-3 rounded-lg border border-red-900/60 bg-red-950/30 px-3 py-2 text-xs text-red-300">
          {batch.errors.join(" · ")}
        </div>
      )}
    </article>
  );
}

function AccountRow({ account }: { account: InactiveRepAccountLog }) {
  const status = account.status === "success" && account.alreadyInactive
    ? { label: "Already inactive", style: "bg-sky-950 text-sky-300 ring-sky-800" }
    : actionStatus(account.status);
  const platformStyle = account.platform === "enerflo"
    ? "bg-orange-950 text-orange-300"
    : account.platform === "microsoft"
      ? "bg-blue-950 text-blue-300"
      : "bg-sky-950 text-sky-300";
  return (
    <tr className="border-t border-gray-800/80 align-top hover:bg-gray-900/80">
      <td className="px-4 py-3">
        <p className="font-medium text-gray-200">{account.repName}</p>
        <p className="mt-0.5 text-[11px] text-gray-600">{account.repRole || "Rep role unavailable"}</p>
      </td>
      <td className="px-4 py-3">
        <p className="break-all text-gray-300">{account.accountEmail}</p>
        <p className="mt-0.5 text-[11px] text-gray-600">ID {account.accountId}</p>
      </td>
      <td className="px-4 py-3">
        <span className={`inline-flex rounded-md px-2 py-1 text-[11px] font-semibold capitalize ${platformStyle}`}>
          {account.platform}
        </span>
      </td>
      <td className="px-4 py-3"><StatusBadge {...status} /></td>
      <td className="px-4 py-3">
        <p className="max-w-md text-gray-400">{account.detail}</p>
        <p className="mt-1 text-[11px] text-gray-600">
          {account.processedAt ? formatDateTime(account.processedAt) : `Report ${account.reportDate}`}
          {account.attempts > 0 ? ` · ${account.attempts} attempt${account.attempts === 1 ? "" : "s"}` : ""}
        </p>
      </td>
    </tr>
  );
}

export default function InactiveRepLogsTab() {
  const [logs, setLogs] = useState<InactiveRepAutomationLogs | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<AccountFilter>("all");
  const [query, setQuery] = useState("");

  const loadLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/inactive-reps/logs", { cache: "no-store" });
      if (response.redirected) {
        window.location.href = response.url;
        return;
      }
      const payload = (await response.json()) as InactiveRepAutomationLogs & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? `Log request failed (${response.status})`);
      setLogs(payload);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void loadLogs(), 0);
    const timer = window.setInterval(() => void loadLogs(), 60_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [loadLogs]);

  const filteredAccounts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return (logs?.accounts ?? []).filter(account => {
      if (filter !== "all" && account.status !== filter) return false;
      if (!normalizedQuery) return true;
      return [account.repName, account.repRole, account.accountEmail, account.accountId, account.platform]
        .some(value => value.toLowerCase().includes(normalizedQuery));
    });
  }, [filter, logs?.accounts, query]);

  const counts = useMemo(() => {
    const accounts = logs?.accounts ?? [];
    return {
      sent: (logs?.batches ?? []).filter(batch => Boolean(batch.emailedAt)).length,
      success: accounts.filter(account => account.status === "success" && !account.alreadyInactive).length,
      pending: accounts.filter(account => account.status === "pending").length,
      attention: accounts.filter(account => ["blocked", "failed"].includes(account.status)).length,
    };
  }, [logs]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold text-white">Inactive Rep Automation</h2>
            <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${
              logs?.deactivationEnabled
                ? "bg-emerald-950 text-emerald-300 ring-1 ring-emerald-800"
                : "bg-amber-950 text-amber-300 ring-1 ring-amber-800"
            }`}>
              Deactivation {logs?.deactivationEnabled ? "enabled" : "disabled"}
            </span>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            Confirmed report emails and account-level outcomes from the 23-hour review workflow.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadLogs()}
          disabled={loading}
          className="rounded-lg border border-gray-700 bg-gray-900 px-4 py-2 text-sm font-medium text-gray-300 transition-colors hover:border-gray-600 hover:text-white disabled:cursor-wait disabled:opacity-50"
        >
          {loading ? "Refreshing…" : "Refresh logs"}
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-900/60 bg-red-950/30 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Emails confirmed", value: counts.sent, color: "text-blue-300" },
          { label: "Accounts deactivated", value: counts.success, color: "text-emerald-300" },
          { label: "Pending review", value: counts.pending, color: "text-gray-200" },
          { label: "Needs attention", value: counts.attention, color: "text-amber-300" },
        ].map(item => (
          <div key={item.label} className="rounded-xl border border-gray-800 bg-gray-900/70 p-4">
            <p className={`text-2xl font-bold ${item.color}`}>{item.value}</p>
            <p className="mt-1 text-xs text-gray-600">{item.label}</p>
          </div>
        ))}
      </div>

      <section>
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-white">Report email history</h3>
            <p className="mt-0.5 text-xs text-gray-600">Newest reports first · Phoenix timestamps</p>
          </div>
          {logs && <p className="text-[11px] text-gray-600">Updated {formatDateTime(logs.fetchedAt)}</p>}
        </div>
        <div className="space-y-3">
          {logs?.batches.map(batch => <EmailLog key={batch.id} batch={batch} />)}
          {!loading && logs?.batches.length === 0 && (
            <div className="rounded-xl border border-dashed border-gray-800 py-12 text-center text-sm text-gray-600">
              No inactive-rep report emails have been recorded yet.
            </div>
          )}
        </div>
      </section>

      <section>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-white">Account actions</h3>
            <p className="mt-0.5 text-xs text-gray-600">
              {filteredAccounts.length} visible of {logs?.accounts.length ?? 0} recorded platform accounts
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              type="search"
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Search rep, email, ID…"
              className="w-64 rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-xs text-gray-200 outline-none placeholder:text-gray-600 focus:border-cyan-700"
            />
            <select
              value={filter}
              onChange={event => setFilter(event.target.value as AccountFilter)}
              className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-xs text-gray-300 outline-none focus:border-cyan-700"
            >
              {ACCOUNT_FILTERS.map(option => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-3 overflow-x-auto rounded-xl border border-gray-800 bg-gray-950/40">
          <table className="min-w-full text-left text-xs">
            <thead className="bg-gray-900/90 text-[10px] uppercase tracking-wider text-gray-600">
              <tr>
                <th className="px-4 py-3 font-semibold">Representative</th>
                <th className="px-4 py-3 font-semibold">Account</th>
                <th className="px-4 py-3 font-semibold">Platform</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Result</th>
              </tr>
            </thead>
            <tbody>
              {filteredAccounts.map(account => <AccountRow key={account.id} account={account} />)}
            </tbody>
          </table>
          {!loading && filteredAccounts.length === 0 && (
            <div className="py-12 text-center text-sm text-gray-600">No account logs match this filter.</div>
          )}
        </div>
      </section>
    </div>
  );
}
