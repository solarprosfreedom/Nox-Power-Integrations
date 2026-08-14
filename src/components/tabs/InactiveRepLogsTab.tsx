"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ActionStatus,
  BatchStatus,
  InactiveRepAccountLog,
  InactiveRepAutomationLogs,
  InactiveRepBatchLog,
  InactiveRepExemption,
  InactiveRepExemptionScope,
} from "@/lib/inactive-reps/types";

type AccountFilter = "all" | ActionStatus;

interface ScheduledRep {
  key: string;
  batch: InactiveRepBatchLog;
  identityKey: string;
  repName: string;
  repRole: string;
  accounts: InactiveRepAccountLog[];
  exemption: InactiveRepExemption | null;
}

interface AccountGroup {
  key: string;
  repName: string;
  repRole: string;
  accounts: InactiveRepAccountLog[];
}

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

function scheduledRepStatus(rep: ScheduledRep): { label: string; style: string } {
  if (rep.accounts.some(account => account.manuallyProtected)) {
    return { label: "Protected", style: "bg-violet-950 text-violet-300 ring-violet-800" };
  }
  if (rep.accounts.every(account => account.status === "success")) {
    return { label: "Deactivated", style: "bg-emerald-950 text-emerald-300 ring-emerald-800" };
  }
  if (rep.accounts.some(account => account.status === "success")) {
    return { label: "Partially processed", style: "bg-amber-950 text-amber-300 ring-amber-800" };
  }
  if (rep.accounts.some(account => account.status === "blocked" || account.status === "failed")) {
    return { label: "Needs attention", style: "bg-amber-950 text-amber-300 ring-amber-800" };
  }
  if (rep.accounts.some(account => account.status === "pending")) {
    return { label: "Scheduled", style: "bg-blue-950 text-blue-300 ring-blue-800" };
  }
  return { label: "Skipped", style: "bg-sky-950 text-sky-300 ring-sky-800" };
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

function accountDisplayStatus(account: InactiveRepAccountLog): { label: string; style: string } {
  return account.manuallyProtected
    ? { label: "Protected", style: "bg-violet-950 text-violet-300 ring-violet-800" }
    : account.status === "success" && account.alreadyInactive
      ? { label: "Already inactive", style: "bg-sky-950 text-sky-300 ring-sky-800" }
      : actionStatus(account.status);
}

function platformBadgeStyle(platform: InactiveRepAccountLog["platform"]): string {
  return platform === "enerflo"
    ? "bg-orange-950 text-orange-300"
    : platform === "microsoft"
      ? "bg-blue-950 text-blue-300"
      : "bg-sky-950 text-sky-300";
}

function AccountGroupRow({ group }: { group: AccountGroup }) {
  const emails = [...new Set(group.accounts.map(account => account.accountEmail).filter(Boolean))];
  return (
    <tr className="border-t border-gray-800/80 align-top hover:bg-gray-900/80">
      <td className="px-4 py-3">
        <p className="font-medium text-gray-200">{group.repName}</p>
        <p className="mt-0.5 text-[11px] text-gray-600">{group.repRole || "Rep role unavailable"}</p>
      </td>
      <td className="px-4 py-3">
        <div className="space-y-1.5">
          {emails.map(email => (
            <p key={email} className="break-all text-gray-300">{email}</p>
          ))}
          {emails.length === 0 && <p className="text-gray-600">No account email</p>}
        </div>
      </td>
      <td className="min-w-[32rem] px-4 py-3">
        <div className="space-y-2">
          {group.accounts.map(account => {
            const status = accountDisplayStatus(account);
            return (
              <div
                key={account.id}
                className="grid gap-2 rounded-lg border border-gray-800/80 bg-gray-900/45 p-3 sm:grid-cols-[7rem_9rem_minmax(0,1fr)] sm:items-start"
              >
                <div>
                  <span className={`inline-flex rounded-md px-2 py-1 text-[11px] font-semibold capitalize ${platformBadgeStyle(account.platform)}`}>
                    {account.platform}
                  </span>
                  <p className="mt-1 break-all text-[10px] text-gray-700">ID {account.accountId}</p>
                </div>
                <div><StatusBadge {...status} /></div>
                <div>
                  <p className="text-gray-400">{account.detail}</p>
                  <p className="mt-1 text-[11px] text-gray-600">
                    {account.processedAt ? formatDateTime(account.processedAt) : `Report ${account.reportDate}`}
                    {account.attempts > 0 ? ` · ${account.attempts} attempt${account.attempts === 1 ? "" : "s"}` : ""}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
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
  const [protectionTarget, setProtectionTarget] = useState<ScheduledRep | null>(null);
  const [protectionScope, setProtectionScope] = useState<InactiveRepExemptionScope>("persistent");
  const [protectionReason, setProtectionReason] = useState("");
  const [mutationPending, setMutationPending] = useState(false);
  const [mutationMessage, setMutationMessage] = useState<string | null>(null);

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

  const groupedAccounts = useMemo(() => {
    const groups = new Map<string, AccountGroup>();
    for (const account of filteredAccounts) {
      const key = account.identityKey || account.accountEmail.toLowerCase() || account.repName.toLowerCase();
      const existing = groups.get(key);
      if (existing) {
        existing.accounts.push(account);
        continue;
      }
      groups.set(key, {
        key,
        repName: account.repName,
        repRole: account.repRole,
        accounts: [account],
      });
    }
    for (const group of groups.values()) {
      group.accounts.sort((left, right) =>
        left.platform.localeCompare(right.platform) || right.reportDate.localeCompare(left.reportDate),
      );
    }
    return [...groups.values()].sort((left, right) => left.repName.localeCompare(right.repName));
  }, [filteredAccounts]);

  const counts = useMemo(() => {
    const accounts = logs?.accounts ?? [];
    return {
      sent: (logs?.batches ?? []).filter(batch => Boolean(batch.emailedAt)).length,
      success: accounts.filter(account => account.status === "success" && !account.alreadyInactive).length,
      pending: accounts.filter(account => account.status === "pending").length,
      attention: accounts.filter(account => ["blocked", "failed"].includes(account.status)).length,
      protected: accounts.filter(account => account.manuallyProtected).length,
    };
  }, [logs]);

  const scheduledReps = useMemo(() => {
    const batches = new Map((logs?.batches ?? []).map(batch => [batch.id, batch]));
    const exemptions = logs?.exemptions ?? [];
    const grouped = new Map<string, ScheduledRep>();
    for (const account of logs?.accounts ?? []) {
      const batch = batches.get(account.batchId);
      if (!batch?.emailedAt) continue;
      const key = `${account.batchId}|${account.identityKey}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.accounts.push(account);
        continue;
      }
      const exemption = exemptions.find(item =>
        item.identityKey === account.identityKey &&
        (item.scope === "persistent" || item.batchId === account.batchId),
      ) ?? null;
      grouped.set(key, {
        key,
        batch,
        identityKey: account.identityKey,
        repName: account.repName,
        repRole: account.repRole,
        accounts: [account],
        exemption,
      });
    }
    return [...grouped.values()].sort((left, right) =>
      right.batch.reportDate.localeCompare(left.batch.reportDate) || left.repName.localeCompare(right.repName),
    );
  }, [logs]);

  const persistentExemptions = useMemo(
    () => (logs?.exemptions ?? []).filter(exemption => exemption.scope === "persistent"),
    [logs?.exemptions],
  );

  function openProtection(rep: ScheduledRep) {
    setProtectionTarget(rep);
    setProtectionScope("persistent");
    setProtectionReason("");
    setMutationMessage(null);
  }

  function closeProtection() {
    if (mutationPending) return;
    setProtectionTarget(null);
    setProtectionReason("");
  }

  async function submitProtection() {
    if (!protectionTarget || protectionReason.trim().length < 3) return;
    setMutationPending(true);
    setMutationMessage(null);
    try {
      const response = await fetch("/api/inactive-reps/protection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          batchId: protectionTarget.batch.id,
          identityKey: protectionTarget.identityKey,
          scope: protectionScope,
          reason: protectionReason.trim(),
        }),
      });
      const payload = (await response.json()) as { error?: string; skippedActions?: number };
      if (!response.ok) throw new Error(payload.error ?? `Protection request failed (${response.status})`);
      const skipped = payload.skippedActions ?? protectionTarget.accounts.length;
      setProtectionTarget(null);
      setProtectionReason("");
      setMutationMessage(
        `${protectionTarget.repName} was removed from ${skipped} scheduled account action${skipped === 1 ? "" : "s"}.`,
      );
      await loadLogs();
    } catch (mutationError) {
      setMutationMessage(mutationError instanceof Error ? mutationError.message : String(mutationError));
    } finally {
      setMutationPending(false);
    }
  }

  async function revokeProtection(exemption: InactiveRepExemption) {
    if (!window.confirm(`Resume inactive-rep checks for ${exemption.displayName || exemption.identityKey}?`)) return;
    setMutationPending(true);
    setMutationMessage(null);
    try {
      const response = await fetch("/api/inactive-reps/protection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revoke", exemptionId: exemption.id }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? `Resume request failed (${response.status})`);
      setMutationMessage(`${exemption.displayName || exemption.identityKey} will be evaluated in future reports.`);
      await loadLogs();
    } catch (mutationError) {
      setMutationMessage(mutationError instanceof Error ? mutationError.message : String(mutationError));
    } finally {
      setMutationPending(false);
    }
  }

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

      {mutationMessage && (
        <div className="rounded-xl border border-cyan-900/60 bg-cyan-950/30 px-4 py-3 text-sm text-cyan-200">
          {mutationMessage}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {[
          { label: "Emails confirmed", value: counts.sent, color: "text-blue-300" },
          { label: "Accounts deactivated", value: counts.success, color: "text-emerald-300" },
          { label: "Pending review", value: counts.pending, color: "text-gray-200" },
          { label: "Needs attention", value: counts.attention, color: "text-amber-300" },
          { label: "Accounts protected", value: counts.protected, color: "text-violet-300" },
        ].map(item => (
          <div key={item.label} className="rounded-xl border border-gray-800 bg-gray-900/70 p-4">
            <p className={`text-2xl font-bold ${item.color}`}>{item.value}</p>
            <p className="mt-1 text-xs text-gray-600">{item.label}</p>
          </div>
        ))}
      </div>

      <section>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-white">Scheduled representatives</h3>
            <p className="mt-0.5 text-xs text-gray-600">
              One row per rep included in a confirmed email. Remove a rep before processing begins.
            </p>
          </div>
          <p className="text-[11px] text-gray-600">{scheduledReps.length} emailed representative records</p>
        </div>

        <div className="mt-3 overflow-x-auto rounded-xl border border-gray-800 bg-gray-950/40">
          <table className="min-w-full text-left text-xs">
            <thead className="bg-gray-900/90 text-[10px] uppercase tracking-wider text-gray-600">
              <tr>
                <th className="px-4 py-3 font-semibold">Representative</th>
                <th className="px-4 py-3 font-semibold">Report</th>
                <th className="px-4 py-3 font-semibold">Scheduled accounts</th>
                <th className="px-4 py-3 font-semibold">Deactivation time</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 text-right font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {scheduledReps.map(rep => {
                const status = scheduledRepStatus(rep);
                const canProtect = ["emailed", "partial"].includes(rep.batch.status) &&
                  rep.accounts.some(account => ["pending", "blocked", "failed"].includes(account.status));
                return (
                  <tr key={rep.key} className="border-t border-gray-800/80 align-top hover:bg-gray-900/80">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-200">{rep.repName}</p>
                      <p className="mt-0.5 text-[11px] text-gray-600">{rep.repRole || rep.identityKey}</p>
                    </td>
                    <td className="px-4 py-3 text-gray-400">{rep.batch.reportDate}</td>
                    <td className="px-4 py-3">
                      <p className="capitalize text-gray-300">
                        {[...new Set(rep.accounts.map(account => account.platform))].join(", ")}
                      </p>
                      <p className="mt-0.5 max-w-sm break-words text-[11px] text-gray-600">
                        {[...new Set(rep.accounts.map(account => account.accountEmail))].join(", ")}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-gray-400">{formatDateTime(rep.batch.deactivationDueAt)}</td>
                    <td className="px-4 py-3">
                      <StatusBadge {...status} />
                      {rep.exemption && (
                        <p className="mt-1 max-w-xs text-[11px] text-violet-300/80" title={rep.exemption.reason}>
                          {rep.exemption.scope === "persistent" ? "Protected from future lists" : "Removed from this batch"}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {canProtect ? (
                        <button
                          type="button"
                          onClick={() => openProtection(rep)}
                          disabled={mutationPending}
                          className="whitespace-nowrap rounded-lg border border-violet-800 bg-violet-950/60 px-3 py-2 text-[11px] font-semibold text-violet-200 transition-colors hover:border-violet-600 hover:text-white disabled:cursor-wait disabled:opacity-50"
                        >
                          Remove from inactive list
                        </button>
                      ) : (
                        <span className="text-[11px] text-gray-700">
                          {rep.batch.status === "processing" ? "Processing started" : "No pending actions"}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!loading && scheduledReps.length === 0 && (
            <div className="py-12 text-center text-sm text-gray-600">
              No emailed representatives have scheduled account actions.
            </div>
          )}
        </div>
      </section>

      {persistentExemptions.length > 0 && (
        <section>
          <div>
            <h3 className="text-sm font-semibold text-white">Protected representatives</h3>
            <p className="mt-0.5 text-xs text-gray-600">
              These reps are excluded from all future inactive-rep reports until protection is removed.
            </p>
          </div>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            {persistentExemptions.map(exemption => (
              <article key={exemption.id} className="rounded-xl border border-violet-900/60 bg-violet-950/20 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-medium text-gray-100">{exemption.displayName || exemption.identityKey}</p>
                    <p className="mt-0.5 text-[11px] text-gray-600">{exemption.identityKey}</p>
                    <p className="mt-3 text-xs text-violet-200">{exemption.reason}</p>
                    <p className="mt-1 text-[11px] text-gray-600">
                      Protected by {exemption.createdBy} · {formatDateTime(exemption.createdAt)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void revokeProtection(exemption)}
                    disabled={mutationPending}
                    className="whitespace-nowrap rounded-lg border border-gray-700 px-3 py-2 text-[11px] font-semibold text-gray-300 transition-colors hover:border-gray-500 hover:text-white disabled:cursor-wait disabled:opacity-50"
                  >
                    Resume automation
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

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
              {groupedAccounts.length} representatives · {filteredAccounts.length} visible platform accounts
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
                <th className="px-4 py-3 font-semibold">Account email</th>
                <th className="px-4 py-3 font-semibold">Platforms, status, and result</th>
              </tr>
            </thead>
            <tbody>
              {groupedAccounts.map(group => <AccountGroupRow key={group.key} group={group} />)}
            </tbody>
          </table>
          {!loading && filteredAccounts.length === 0 && (
            <div className="py-12 text-center text-sm text-gray-600">No account logs match this filter.</div>
          )}
        </div>
      </section>

      {protectionTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="inactive-rep-protection-title"
        >
          <div className="w-full max-w-lg rounded-2xl border border-gray-700 bg-gray-950 p-6 shadow-2xl">
            <h3 id="inactive-rep-protection-title" className="text-lg font-semibold text-white">
              Keep {protectionTarget.repName} active
            </h3>
            <p className="mt-1 text-sm text-gray-500">
              This immediately cancels all remaining account actions in the {protectionTarget.batch.reportDate} batch.
            </p>

            <fieldset className="mt-5 space-y-2">
              <legend className="text-xs font-semibold uppercase tracking-wider text-gray-500">Protection</legend>
              {[
                {
                  id: "persistent" as const,
                  label: "Keep active until removed",
                  description: "Recommended. Excludes this rep from this batch and all future inactive lists.",
                },
                {
                  id: "batch" as const,
                  label: "Skip this batch only",
                  description: "Cancels this batch, but the rep can appear again in a future report.",
                },
              ].map(option => (
                <label
                  key={option.id}
                  className={`flex cursor-pointer gap-3 rounded-xl border p-3 ${
                    protectionScope === option.id
                      ? "border-violet-700 bg-violet-950/30"
                      : "border-gray-800 bg-gray-900/60"
                  }`}
                >
                  <input
                    type="radio"
                    name="protection-scope"
                    value={option.id}
                    checked={protectionScope === option.id}
                    onChange={() => setProtectionScope(option.id)}
                    className="mt-1"
                  />
                  <span>
                    <span className="block text-sm font-medium text-gray-200">{option.label}</span>
                    <span className="mt-0.5 block text-xs text-gray-600">{option.description}</span>
                  </span>
                </label>
              ))}
            </fieldset>

            <label className="mt-5 block">
              <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">Reason</span>
              <textarea
                value={protectionReason}
                onChange={event => setProtectionReason(event.target.value.slice(0, 500))}
                rows={3}
                autoFocus
                placeholder="Example: Manager confirmed the rep is actively working with us."
                className="mt-2 w-full resize-none rounded-xl border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-200 outline-none placeholder:text-gray-700 focus:border-violet-700"
              />
              <span className="mt-1 block text-right text-[10px] text-gray-700">
                {protectionReason.length}/500
              </span>
            </label>

            {mutationMessage && (
              <div className="mt-3 rounded-lg border border-red-900/60 bg-red-950/30 px-3 py-2 text-xs text-red-300">
                {mutationMessage}
              </div>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeProtection}
                disabled={mutationPending}
                className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:border-gray-500 hover:text-white disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submitProtection()}
                disabled={mutationPending || protectionReason.trim().length < 3}
                className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {mutationPending ? "Protecting…" : "Confirm and keep active"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
