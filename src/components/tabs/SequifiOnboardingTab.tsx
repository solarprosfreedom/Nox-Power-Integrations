"use client";

import { useCallback, useEffect, useState } from "react";
import {
  checkOnboardingUserExists,
  getOnboardingConfig,
  getOnboardingJobs,
  getOnboardingPreview,
  provisionSequifiUser,
  provisionSequifiUsersBulkAction,
  retryOnboardingJob,
  runHiredOnboardingNow,
  scanSequifiMicrosoftGapList,
  submitEmpwrHubSpotForJob,
} from "@/app/actions/onboarding";
import type { MicrosoftGapStatus, SequifiMicrosoftGapRow } from "@/lib/onboarding/microsoft-gap-scan";
import { parseSequifiFields } from "@/lib/onboarding/sequifi-fields";
import type { OnboardingJob } from "@/lib/onboarding/types";

type PreviewState = Awaited<ReturnType<typeof getOnboardingPreview>>;
type ConfigState = Awaited<ReturnType<typeof getOnboardingConfig>>;
type ExistsState = Awaited<ReturnType<typeof checkOnboardingUserExists>>;
type GapScanState = Awaited<ReturnType<typeof scanSequifiMicrosoftGapList>>;

function MicrosoftGapTable({
  rows,
  emptyMessage,
  showProvision,
  provisioningId,
  onProvision,
}: {
  rows: SequifiMicrosoftGapRow[];
  emptyMessage: string;
  showProvision?: boolean;
  provisioningId?: number | null;
  onProvision?: (sequifiUserId: number) => void;
}) {
  if (rows.length === 0) {
    return <p className="px-4 py-6 text-sm text-gray-500">{emptyMessage}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-800 text-left text-xs text-gray-500 uppercase">
            <th className="px-4 py-2">Name</th>
            <th className="px-4 py-2">Sequifi email</th>
            <th className="px-4 py-2">Expected work email</th>
            <th className="px-4 py-2">M365 status</th>
            <th className="px-4 py-2">Found in Graph</th>
            {showProvision && <th className="px-4 py-2" />}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.sequifi_user_id} className="border-b border-gray-800/60">
              <td className="px-4 py-2 text-gray-200 whitespace-nowrap">
                {[row.first_name, row.last_name].filter(Boolean).join(" ") || "—"}
              </td>
              <td className="px-4 py-2 text-gray-400 text-xs max-w-[180px] truncate" title={row.sequifi_email}>
                {row.sequifi_email}
              </td>
              <td className="px-4 py-2 text-gray-300 text-xs whitespace-nowrap">{row.work_upn}</td>
              <td className="px-4 py-2">
                <MicrosoftGapPill status={row.status} />
              </td>
              <td className="px-4 py-2 text-xs text-gray-500 max-w-[240px]">
                {row.member_upn && (
                  <span className="text-emerald-400">member: {row.member_upn}</span>
                )}
                {!row.member_upn && row.guest_upn && (
                  <span className="text-amber-400">guest: {row.guest_upn}</span>
                )}
                {!row.member_upn && !row.guest_upn && row.error && (
                  <span className="text-red-400">{row.error}</span>
                )}
                {!row.member_upn && !row.guest_upn && !row.error && (
                  <span className="text-gray-600">—</span>
                )}
              </td>
              {showProvision && onProvision && (
                <td className="px-4 py-2">
                  <button
                    type="button"
                    onClick={() => onProvision(row.sequifi_user_id)}
                    disabled={provisioningId != null}
                    className="text-xs text-violet-400 hover:text-violet-300 disabled:opacity-50 inline-flex items-center gap-1"
                  >
                    {provisioningId === row.sequifi_user_id ? (
                      <>
                        <Spinner className="h-3 w-3" />
                        Provisioning…
                      </>
                    ) : (
                      "Provision"
                    )}
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MicrosoftGapPill({ status }: { status: MicrosoftGapStatus }) {
  const styles: Record<MicrosoftGapStatus, string> = {
    missing: "bg-red-900/50 text-red-300",
    guest_only: "bg-amber-900/50 text-amber-300",
    member: "bg-emerald-900/50 text-emerald-300",
    error: "bg-gray-800 text-gray-400",
  };
  const labels: Record<MicrosoftGapStatus, string> = {
    missing: "missing",
    guest_only: "guest only",
    member: "member",
    error: "error",
  };
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}

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

function StatusPill({ status }: { status: string }) {
  const colors: Record<string, string> = {
    completed: "bg-emerald-900/50 text-emerald-300",
    success: "bg-emerald-900/50 text-emerald-300",
    partial: "bg-amber-900/50 text-amber-300",
    failed: "bg-red-900/50 text-red-300",
    pending: "bg-gray-800 text-gray-400",
    processing: "bg-blue-900/50 text-blue-300",
    skipped: "bg-gray-800 text-gray-500",
  };
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${colors[status] ?? "bg-gray-800 text-gray-400"}`}
    >
      {status}
    </span>
  );
}

export default function SequifiOnboardingTab() {
  const [config, setConfig] = useState<ConfigState | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [jobs, setJobs] = useState<OnboardingJob[]>([]);
  const [jobsTableReady, setJobsTableReady] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkEmail, setCheckEmail] = useState("");
  const [existsResult, setExistsResult] = useState<ExistsState | null>(null);
  const [gapScan, setGapScan] = useState<GapScanState | null>(null);
  const [showMissingTable, setShowMissingTable] = useState(false);
  const [showMemberTable, setShowMemberTable] = useState(false);
  const [scanningMissing, setScanningMissing] = useState(false);
  const [scanningMember, setScanningMember] = useState(false);
  const [provisioningId, setProvisioningId] = useState<number | null>(null);
  const [bulkProvisioning, setBulkProvisioning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [hubspotJobId, setHubspotJobId] = useState<string | null>(null);

  function jobHasEmpwrTab(job: OnboardingJob): boolean {
    return parseSequifiFields(job.raw_sequifi_payload ?? {}).installerTabs.some(
      tab => tab.trim().toLowerCase() === "empwr",
    );
  }

  const refresh = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const [cfg, prev, jobResult] = await Promise.all([
        getOnboardingConfig(),
        getOnboardingPreview(),
        getOnboardingJobs(),
      ]);
      setConfig(cfg);
      setPreview(prev);
      setJobs(jobResult.jobs);
      setJobsTableReady(jobResult.tableReady);
      if (prev.error) setMessage(prev.error);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleRunHiredOnboarding() {
    setRunning(true);
    setMessage(null);
    try {
      const result = await runHiredOnboardingNow();
      const parts = [
        `${result.gapNeed} need provisioning of ${result.polled} hired`,
        result.onboardingCompleteFiltered > 0
          ? `${result.onboardingCompleteFiltered} skipped (onboarding incomplete)`
          : null,
        result.excludeFiltered > 0 ? `${result.excludeFiltered} excluded` : null,
        `new jobs ${result.newJobs}`,
        result.dryRun ? "(dry run — queued only)" : `completed ${result.completed}, partial ${result.partial}, failed ${result.failed}`,
      ];
      if (result.errors.length) parts.push(result.errors.join("; "));
      setMessage(parts.filter(Boolean).join(" · "));
      await refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  async function handleProvisionUser(sequifiUserId: number) {
    setProvisioningId(sequifiUserId);
    setMessage(null);
    let resultMessage: string | null = null;
    try {
      const result = await provisionSequifiUser(sequifiUserId);
      if (result.skipped && result.reason) {
        resultMessage = `User ${sequifiUserId}: ${result.reason}`;
      } else if (result.error) {
        resultMessage = `User ${sequifiUserId} failed: ${result.error}`;
      } else if (result.job) {
        resultMessage = `User ${sequifiUserId}: job ${result.job.status} (MS ${result.job.microsoft_status}, EN ${result.job.enerflo_status})`;
      } else {
        resultMessage = `User ${sequifiUserId}: done`;
      }
    } catch (e) {
      resultMessage = e instanceof Error ? e.message : String(e);
    } finally {
      setProvisioningId(null);
    }
    setMessage(resultMessage);
    await refresh();
    if (showMissingTable) void refreshMissingList();
  }

  async function handleProvisionAllMissing() {
    if (!gapScan?.gapRows.length || bulkProvisioning) return;
    setBulkProvisioning(true);
    setMessage(null);
    let resultMessage: string | null = null;
    try {
      const ids = gapScan.gapRows.map(r => r.sequifi_user_id);
      const result = await provisionSequifiUsersBulkAction(ids);
      resultMessage =
        `Bulk: ${result.completed} completed, ${result.partial} partial, ${result.failed} failed, ${result.skipped} skipped` +
        (result.dryRun ? " (dry run)" : "") +
        (result.errors.length ? ` · ${result.errors.join("; ")}` : "");
    } catch (e) {
      resultMessage = e instanceof Error ? e.message : String(e);
    } finally {
      setBulkProvisioning(false);
    }
    setMessage(resultMessage);
    await refresh();
    if (showMissingTable) void refreshMissingList();
  }

  const missingListReady = Boolean(gapScan && !gapScan.error && showMissingTable);

  async function ensureGapScan(force = false): Promise<GapScanState | null> {
    if (!force && gapScan && !gapScan.error) return gapScan;

    const result = await scanSequifiMicrosoftGapList();
    setGapScan(result);
    return result;
  }

  async function handleLoadMissingUsers(force = false) {
    if (scanningMissing || scanningMember) return;
    setScanningMissing(true);
    if (force) setGapScan(null);
    setMessage(null);
    try {
      const result = await ensureGapScan(force);
      setShowMissingTable(true);
      if (result?.error) {
        setMessage(result.error);
      } else if (result) {
        setMessage(
          `${result.gapRows.length} without member @noxpwr.com (${result.missingCount} missing, ${result.guestOnlyCount} guest only) · ${result.scanned} hired scanned` +
            (result.goLiveFiltered > 0
              ? ` · ${result.goLiveFiltered} hidden by ONBOARDING_GO_LIVE_AT`
              : "") +
            (result.onboardingCompleteFiltered > 0
              ? ` · ${result.onboardingCompleteFiltered} skipped (onboarding_complete !== 1)`
              : "") +
            (result.excludeFiltered > 0 ? ` · ${result.excludeFiltered} excluded (test blocklist)` : ""),
        );
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setScanningMissing(false);
    }
  }

  async function handleLoadMemberUsers(force = false) {
    if (scanningMissing || scanningMember) return;
    setScanningMember(true);
    if (force) setGapScan(null);
    setMessage(null);
    try {
      const result = await ensureGapScan(force);
      setShowMemberTable(true);
      if (result?.error) {
        setMessage(result.error);
      } else if (result) {
        setMessage(
          `${result.memberRows.length} with member @noxpwr.com · ${result.scanned} hired scanned`,
        );
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setScanningMember(false);
    }
  }

  async function refreshMissingList() {
    await handleLoadMissingUsers(true);
  }

  async function handleCheckExists() {
    if (!checkEmail.trim() || checking) return;
    setChecking(true);
    setExistsResult(null);
    setMessage(null);
    try {
      setExistsResult(await checkOnboardingUserExists(checkEmail.trim()));
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setChecking(false);
    }
  }

  async function handleRetry(jobId: string) {
    setRunning(true);
    try {
      await retryOnboardingJob(jobId);
      await refresh();
    } finally {
      setRunning(false);
    }
  }

  async function handleEmpwrHubSpot(jobId: string) {
    setHubspotJobId(jobId);
    setMessage(null);
    try {
      const result = await submitEmpwrHubSpotForJob(jobId);
      if (result.result === "sent") {
        setMessage(`EMPWR HubSpot: submitted for job ${jobId}`);
      } else {
        setMessage(
          `EMPWR HubSpot ${result.result}: ${result.error ?? result.stepError ?? "unknown"}`,
        );
      }
      await refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setHubspotJobId(null);
    }
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h2 className="text-lg font-semibold text-white">Sequifi Onboarding</h2>
        <p className="text-sm text-gray-400 mt-1">
          Load Sequifi hires and compare against Microsoft. Review users without a member{" "}
          <code className="text-gray-300">@noxpwr.com</code> account before running onboarding.
          Uses first + last name when Sequifi only has a personal email.
        </p>
      </div>

      {config?.requireSequifiComplete && (
        <div className="rounded-lg border border-gray-700 bg-gray-900/60 px-4 py-3 text-sm text-gray-300">
          Only Sequifi users with <code className="text-gray-100">onboarding_complete = 1</code> are
          eligible for auto-provisioning. Set{" "}
          <code className="text-gray-100">ONBOARDING_REQUIRE_SEQUIFI_COMPLETE=false</code> to
          disable.
        </div>
      )}

      {config?.dryRun && (
        <div className="rounded-lg border border-amber-800 bg-amber-950/40 px-4 py-3 text-sm text-amber-200">
          <strong>Dry run mode</strong> — queues jobs only, no account creation. Set{" "}
          <code className="text-amber-100">ONBOARDING_DRY_RUN=false</code> in .env.local to provision
          for real. Set{" "}
          <code className="text-amber-100">ONBOARDING_ASSIGN_MS_LICENSE=true</code> and{" "}
          <code className="text-amber-100">MS_LICENSE_SKU_ID</code> to auto-assign Exchange
          Online (Plan 1) after M365 create.
        </div>
      )}

      {config && !config.dryRun && (
        <div className="rounded-lg border border-blue-800 bg-blue-950/30 px-4 py-3 text-sm text-blue-200">
          Work email format: <code className="text-blue-100">firstnamelastname@noxpwr.com</code>{" "}
          (e.g. jonaslim@noxpwr.com). Azure app needs{" "}
          <strong>User.Read.All</strong> to check users and <strong>User.ReadWrite.All</strong> to
          create them.
        </div>
      )}

      {loading && !config && (
        <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
          <Spinner className="h-4 w-4 text-gray-400" />
          Loading…
        </div>
      )}

      {config && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
          {(
            [
              { label: "Sequifi", ok: config.sequifiConfigured },
              { label: "Supabase", ok: config.supabaseConfigured },
              { label: "Graph", ok: config.graphConfigured },
              { label: "Enerflo", ok: config.enerfloConfigured },
              { label: "Terros", ok: config.terrosConfigured },
              { label: "EMPWR HubSpot", ok: config.empwrHubSpotConfigured },
            ] as const
          ).map(({ label, ok }) => (
            <div
              key={label}
              className={`rounded-lg border px-3 py-2 ${ok ? "border-emerald-800 text-emerald-300" : "border-red-800 text-red-300"}`}
            >
              {label}: {ok ? "ready" : "missing"}
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-3 items-center">
        <button
          type="button"
          onClick={() => handleLoadMissingUsers()}
          disabled={scanningMissing || scanningMember || loading || checking}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50 inline-flex items-center gap-2"
        >
          {scanningMissing && <Spinner />}
          {scanningMissing
            ? "Loading users without Microsoft…"
            : "Load users without Microsoft account"}
        </button>
        <button
          type="button"
          onClick={() => handleLoadMemberUsers()}
          disabled={scanningMissing || scanningMember || loading || checking}
          className="rounded-lg border border-emerald-800 bg-emerald-950/40 px-4 py-2 text-sm font-medium text-emerald-200 hover:bg-emerald-950/60 disabled:opacity-50 inline-flex items-center gap-2"
        >
          {scanningMember && <Spinner />}
          {scanningMember
            ? "Loading users with Microsoft…"
            : "Load users with Microsoft account"}
        </button>
        <button
          type="button"
          onClick={refresh}
          disabled={loading || checking || scanningMissing || scanningMember}
          className="rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 text-sm text-white hover:bg-gray-700 disabled:opacity-50 inline-flex items-center gap-2"
        >
          {loading && <Spinner />}
          {loading ? "Loading…" : "Refresh"}
        </button>
        <button
          type="button"
          onClick={handleRunHiredOnboarding}
          disabled={
            running ||
            loading ||
            checking ||
            scanningMissing ||
            scanningMember ||
            bulkProvisioning ||
            !missingListReady
          }
          title={
            missingListReady
              ? undefined
              : "Load users without Microsoft account first"
          }
          className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
        >
          {running && <Spinner />}
          {running ? "Running…" : "Run hired onboarding now"}
        </button>
      </div>

      {!missingListReady && !scanningMissing && (
        <p className="text-xs text-gray-500">
          Run <strong className="text-gray-400">Load users without Microsoft account</strong> first
          to review the gap list, then use <strong className="text-gray-400">Run hired onboarding now</strong>.
        </p>
      )}

      {message && (
        <div className="rounded-lg border border-gray-700 bg-gray-900 px-4 py-3 text-sm text-gray-300">
          {message}
        </div>
      )}

      {(scanningMissing || scanningMember) && (
        <div className="flex items-center gap-3 rounded-lg border border-indigo-900/50 bg-indigo-950/20 px-4 py-3 text-sm text-indigo-200">
          <Spinner className="h-5 w-5 shrink-0" />
          <div>
            <p className="font-medium">
              {scanningMissing
                ? "Loading users without Microsoft account…"
                : "Loading users with Microsoft account…"}
            </p>
            <p className="text-xs text-indigo-300/80 mt-0.5">
              Checking each hire for a member <code className="text-indigo-200">@noxpwr.com</code>{" "}
              account. Usually 30–90 seconds for ~60 users.
            </p>
          </div>
        </div>
      )}

      {showMissingTable && gapScan && !scanningMissing && !gapScan.error && (
        <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-800 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-white">
                Sequifi users without member Microsoft account
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">
                {gapScan.gapRows.length} need action ({gapScan.missingCount} missing,{" "}
                {gapScan.guestOnlyCount} guest only)
                {gapScan.goLiveFiltered > 0 &&
                  ` · ${gapScan.goLiveFiltered} hidden by ONBOARDING_GO_LIVE_AT`}
                {gapScan.onboardingCompleteFiltered > 0 &&
                  ` · ${gapScan.onboardingCompleteFiltered} skipped (onboarding_complete !== 1)`}
                {gapScan.excludeFiltered > 0 &&
                  ` · ${gapScan.excludeFiltered} excluded (test blocklist)`}
                {gapScan.errorCount > 0 && ` · ${gapScan.errorCount} scan errors`}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => refreshMissingList()}
                disabled={scanningMissing || scanningMember}
                className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800 disabled:opacity-50"
              >
                Rescan
              </button>
              {gapScan.gapRows.length > 0 && (
                <button
                  type="button"
                  onClick={handleProvisionAllMissing}
                  disabled={bulkProvisioning || provisioningId != null || running}
                  className="rounded-lg bg-violet-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-600 disabled:opacity-50 inline-flex items-center gap-2"
                >
                  {bulkProvisioning && <Spinner className="h-3 w-3" />}
                  {bulkProvisioning ? "Provisioning all…" : "Provision all missing"}
                </button>
              )}
            </div>
          </div>
          <MicrosoftGapTable
            rows={gapScan.gapRows}
            emptyMessage="All scanned Sequifi users have a member @noxpwr.com account."
            showProvision
            provisioningId={provisioningId}
            onProvision={handleProvisionUser}
          />
        </div>
      )}

      {showMemberTable && gapScan && !scanningMember && !gapScan.error && (
        <div className="rounded-xl border border-emerald-900/40 bg-gray-900 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-800 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-white">
                Sequifi users with Microsoft account
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">
                {gapScan.memberRows.length} of {gapScan.scanned} have a member{" "}
                <code className="text-gray-400">@noxpwr.com</code> account
              </p>
            </div>
            <button
              type="button"
              onClick={() => handleLoadMemberUsers(true)}
              disabled={scanningMissing || scanningMember}
              className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800 disabled:opacity-50"
            >
              Rescan
            </button>
          </div>
          <MicrosoftGapTable
            rows={gapScan.memberRows}
            emptyMessage="No Sequifi users matched to a member @noxpwr.com account."
          />
        </div>
      )}

      {preview && !preview.error && (
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
          <p className="text-sm text-gray-300">
            Sequifi hired users (after go-live + onboarding-complete filters):{" "}
            <strong className="text-white">{preview.users.length}</strong>
            {preview.goLiveFiltered > 0 && (
              <span className="text-gray-500"> · {preview.goLiveFiltered} hidden by ONBOARDING_GO_LIVE_AT</span>
            )}
            {preview.onboardingCompleteFiltered > 0 && (
              <span className="text-gray-500">
                {" "}
                · {preview.onboardingCompleteFiltered} skipped (onboarding_complete !== 1)
              </span>
            )}
          </p>
        </div>
      )}

      <div className="rounded-xl border border-gray-800 bg-gray-900 p-4 space-y-3">
        <h3 className="text-sm font-semibold text-white">Check if user exists</h3>
        <p className="text-xs text-gray-500">
          Looks up the exact email on each platform. Enerflo/Terros also check noxpwr.com ↔
          solarpros.io aliases (same person, different domain).
        </p>
        <div className="flex gap-2">
          <input
            type="email"
            value={checkEmail}
            onChange={e => setCheckEmail(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter") void handleCheckExists();
            }}
            disabled={checking}
            placeholder="rep@noxpwr.com"
            className="flex-1 rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white disabled:opacity-50"
          />
          <button
            type="button"
            onClick={handleCheckExists}
            disabled={checking || !checkEmail.trim()}
            className="rounded-lg bg-cyan-700 px-4 py-2 text-sm text-white hover:bg-cyan-600 disabled:opacity-50 min-w-[100px] inline-flex items-center justify-center gap-2"
          >
            {checking ? (
              <>
                <Spinner />
                Checking…
              </>
            ) : (
              "Check"
            )}
          </button>
        </div>
        {checking && (
          <div className="flex items-center gap-3 rounded-lg border border-cyan-900/50 bg-cyan-950/20 px-4 py-3 text-sm text-cyan-200">
            <Spinner className="h-5 w-5 shrink-0" />
            <div>
              <p className="font-medium">Checking platforms…</p>
              <p className="text-xs text-cyan-300/80 mt-0.5">
                Microsoft, Enerflo, and Terros — Enerflo can take a few seconds (loads user list).
              </p>
            </div>
          </div>
        )}
        {existsResult && !checking && (
          <div className="space-y-2">
            <table className="w-full text-sm mt-2">
              <tbody>
                <tr>
                  <td className="py-1 text-gray-500">Microsoft</td>
                  <td>
                    {existsResult.microsoftStatus === "exists" && (
                      <span className="text-emerald-300">
                        ✓ exists
                        {existsResult.microsoftUpn ? ` (${existsResult.microsoftUpn})` : ""}
                      </span>
                    )}
                    {existsResult.microsoftStatus === "missing" && (
                      <span className="text-red-300">✗ missing</span>
                    )}
                    {existsResult.microsoftStatus === "unknown" && (
                      <span className="text-amber-300">? cannot verify</span>
                    )}
                  </td>
                </tr>
                <tr>
                  <td className="py-1 text-gray-500">Enerflo</td>
                  <td>
                    {existsResult.enerfloStatus === "exists" && (
                      <span className="text-emerald-300">
                        ✓ exists{existsResult.enerfloMatchedEmail ? ` (${existsResult.enerfloMatchedEmail})` : ""}
                      </span>
                    )}
                    {existsResult.enerfloStatus === "alias" && (
                      <span className="text-amber-300">
                        ~ alias match ({existsResult.enerfloMatchedEmail}) — work email not on Enerflo
                      </span>
                    )}
                    {existsResult.enerfloStatus === "missing" && (
                      <span className="text-red-300">✗ missing</span>
                    )}
                  </td>
                </tr>
                <tr>
                  <td className="py-1 text-gray-500">Terros</td>
                  <td>
                    {existsResult.terrosStatus === "exists" && (
                      <span className="text-emerald-300">
                        ✓ exists{existsResult.terrosMatchedEmail ? ` (${existsResult.terrosMatchedEmail})` : ""}
                      </span>
                    )}
                    {existsResult.terrosStatus === "alias" && (
                      <span className="text-amber-300">
                        ~ alias match ({existsResult.terrosMatchedEmail}) — work email not on Terros
                      </span>
                    )}
                    {existsResult.terrosStatus === "missing" && (
                      <span className="text-red-300">✗ missing</span>
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
            {existsResult.errors.length > 0 && (
              <div className="rounded-lg border border-amber-800 bg-amber-950/40 px-3 py-2 text-xs text-amber-200">
                {existsResult.errors.map(err => (
                  <p key={err}>{err}</p>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800">
          <h3 className="text-sm font-semibold text-white">Onboarding jobs</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            For automated Sequifi polling and retry tracking — not needed to test existence checks.
          </p>
        </div>
        {jobsTableReady === false ? (
          <p className="px-4 py-6 text-sm text-gray-500">
            Jobs table not set up yet. Run{" "}
            <code className="text-gray-400">supabase/migrations/001_onboarding_jobs.sql</code> in
            Supabase when you are ready to turn on automation.
          </p>
        ) : jobs.length === 0 ? (
          <p className="px-4 py-6 text-sm text-gray-500">No jobs yet. Run hired onboarding or provision from the gap table.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-left text-xs text-gray-500 uppercase">
                  <th className="px-4 py-2">Name</th>
                  <th className="px-4 py-2">Email</th>
                  <th className="px-4 py-2">MS</th>
                  <th className="px-4 py-2">En</th>
                  <th className="px-4 py-2">Tr</th>
                  <th className="px-4 py-2">Mail</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {jobs.map(job => (
                  <tr key={job.id} className="border-b border-gray-800/60">
                    <td className="px-4 py-2 text-gray-200 whitespace-nowrap">
                      {[job.first_name, job.last_name].filter(Boolean).join(" ") || "—"}
                    </td>
                    <td className="px-4 py-2 text-gray-400 text-xs">{job.email}</td>
                    <td className="px-4 py-2">
                      <StatusPill status={job.microsoft_status} />
                    </td>
                    <td className="px-4 py-2">
                      <StatusPill status={job.enerflo_status} />
                    </td>
                    <td className="px-4 py-2">
                      <StatusPill status={job.terros_status} />
                    </td>
                    <td className="px-4 py-2">
                      <StatusPill status={job.welcome_email_status} />
                    </td>
                    <td className="px-4 py-2">
                      <StatusPill status={job.status} />
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex flex-col gap-1">
                        {job.status !== "completed" && !config?.dryRun && (
                          <button
                            type="button"
                            onClick={() => handleRetry(job.id)}
                            className="text-xs text-violet-400 hover:text-violet-300 text-left"
                          >
                            Retry
                          </button>
                        )}
                        {job.status === "completed" &&
                          config?.empwrHubSpotConfigured &&
                          jobHasEmpwrTab(job) && (
                            <button
                              type="button"
                              onClick={() => handleEmpwrHubSpot(job.id)}
                              disabled={hubspotJobId === job.id}
                              className="text-xs text-orange-400 hover:text-orange-300 text-left disabled:opacity-50"
                            >
                              {hubspotJobId === job.id
                                ? "HubSpot…"
                                : job.step_errors.empwr_hubspot === "sent"
                                  ? "HubSpot sent"
                                  : "EMPWR HubSpot"}
                            </button>
                          )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
