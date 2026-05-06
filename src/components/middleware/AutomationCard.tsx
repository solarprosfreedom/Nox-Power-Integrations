"use client";

import { useState, useTransition } from "react";
import { setAutomationEnabled, runAutomation, removeAutomation } from "@/app/actions/automations";
import { SYSTEM_META } from "@/lib/automations-types";
import type { Automation } from "@/lib/automations-types";

// ── Webhook URL copy box ──────────────────────────────────────────────────
function WebhookUrl({ system, event }: { system: string; event: string }) {
  const [copied, setCopied] = useState(false);
  const base =
    typeof window !== "undefined"
      ? window.location.origin
      : "http://localhost:3000";
  const url = `${base}/api/webhooks/${system}`;

  function copy() {
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="rounded-lg border border-teal-800/60 bg-teal-950/30 px-4 py-3">
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-teal-600">
        Webhook URL — paste this into Make.com, Zapier, or any external system
      </p>
      <div className="flex items-center gap-2">
        <code className="flex-1 truncate rounded bg-gray-900 px-3 py-1.5 font-mono text-xs text-teal-300">
          {url}
        </code>
        <button
          onClick={copy}
          className="flex-shrink-0 rounded bg-teal-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-600 transition-colors"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <p className="mt-2 text-[11px] text-gray-600">
        POST body:{" "}
        <code className="text-gray-500">
          {`{ "event": "${event}", "data": { ...your payload } }`}
        </code>
      </p>
    </div>
  );
}

// ── Status badge ──────────────────────────────────────────────────────────
const RUN_STATUS_STYLE = {
  success: "bg-green-900/50 text-green-300 border-green-700",
  failed:  "bg-red-900/50  text-red-300  border-red-700",
  skipped: "bg-gray-800    text-gray-500 border-gray-700",
};

// ── System pill ───────────────────────────────────────────────────────────
function SystemPill({ system }: { system: keyof typeof SYSTEM_META }) {
  const m = SYSTEM_META[system];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border border-current/20 bg-current/10 px-2.5 py-0.5 text-xs font-medium ${m.color}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />
      {m.label}
    </span>
  );
}

// ── Toggle switch ─────────────────────────────────────────────────────────
function Toggle({
  enabled,
  isPending,
  onChange,
}: {
  enabled: boolean;
  isPending: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      disabled={isPending}
      onClick={() => onChange(!enabled)}
      className={`relative h-6 w-11 rounded-full transition-colors focus:outline-none
        disabled:opacity-50 disabled:cursor-not-allowed
        ${enabled ? "bg-teal-600" : "bg-gray-700"}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform
          ${enabled ? "translate-x-5" : "translate-x-0"}`}
      />
    </button>
  );
}

// ── Automation card ───────────────────────────────────────────────────────
interface Props {
  automation: Automation;
  onChange: (updated: Automation) => void;
  onDelete: (id: string) => void;
}

export default function AutomationCard({ automation: initial, onChange, onDelete }: Props) {
  const [automation, setAutomation] = useState(initial);
  const [expanded, setExpanded]     = useState(false);
  const [runResult, setRunResult]   = useState<{ ok: boolean; status: number | null; response: string; hadApiKey: boolean } | null>(null);
  const [togglePending, startToggle] = useTransition();
  const [runPending,    startRun]    = useTransition();
  const [deletePending, startDelete] = useTransition();

  function handleToggle(enabled: boolean) {
    startToggle(async () => {
      const updated = await setAutomationEnabled(automation.id, enabled);
      if (updated) { setAutomation(updated); onChange(updated); }
    });
  }

  function handleRun() {
    startRun(async () => {
      const result = await runAutomation(automation.id);
      setRunResult({
        ok: result.ok,
        status: result.httpStatus,
        response: result.response,
        hadApiKey: result.hadApiKey,
      });
      if (result.automation) { setAutomation(result.automation); onChange(result.automation); }
    });
  }

  function handleDelete() {
    if (!confirm(`Delete "${automation.name}"? This cannot be undone.`)) return;
    startDelete(async () => {
      await removeAutomation(automation.id);
      onDelete(automation.id);
    });
  }

  const triggerMeta = SYSTEM_META[automation.trigger.system];
  const actionMeta  = SYSTEM_META[automation.action.system];

  return (
    <div className={`rounded-xl border transition-colors overflow-hidden
      ${automation.enabled ? "border-teal-800 bg-gray-900" : "border-gray-800 bg-gray-900/60"}`}
    >
      {/* ── Top row ── */}
      <div className="flex flex-wrap items-start gap-4 px-5 py-4">
        {/* Toggle */}
        <div className="flex flex-col items-center gap-1 pt-0.5">
          <Toggle enabled={automation.enabled} isPending={togglePending} onChange={handleToggle} />
          <span className="text-[10px] text-gray-600">{automation.enabled ? "ON" : "OFF"}</span>
        </div>

        {/* Name + description */}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-white">{automation.name}</h3>
            {automation.isTemplate && (
              <span className="rounded bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-500">template</span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-gray-500 line-clamp-2">{automation.description}</p>

          {/* Trigger → Action flow */}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <SystemPill system={automation.trigger.system} />
            <span className="text-gray-600 font-mono text-[10px]">{automation.trigger.eventLabel}</span>
            <span className="text-gray-600">→</span>
            <SystemPill system={automation.action.system} />
            <span className="text-gray-600 font-mono text-[10px]">{automation.action.operationLabel}</span>
          </div>
        </div>

        {/* Stats + actions */}
        <div className="flex flex-col items-end gap-2 flex-shrink-0">
          {/* Last run status */}
          {automation.lastRunStatus && (
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${RUN_STATUS_STYLE[automation.lastRunStatus]}`}>
              {automation.lastRunStatus}
            </span>
          )}
          <span className="text-[10px] text-gray-600">
            {automation.runCount} run{automation.runCount !== 1 ? "s" : ""}
          </span>

          <div className="flex items-center gap-2 mt-1">
            <button
              onClick={handleRun}
              disabled={runPending}
              className="rounded-lg border border-teal-700 bg-teal-900/30 px-3 py-1.5 text-xs font-medium
                         text-teal-300 hover:bg-teal-800/40 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {runPending ? "Running…" : "▶ Run"}
            </button>
            <button
              onClick={() => setExpanded((v) => !v)}
              className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
            >
              {expanded ? "▲" : "▼"}
            </button>
          </div>
        </div>
      </div>

      {/* ── Run result banner ── */}
      {runResult && (
        <div className={`mx-5 mb-3 rounded-lg border px-4 py-2.5 text-xs
          ${runResult.ok
            ? "border-green-700 bg-green-900/30 text-green-300"
            : "border-yellow-700 bg-yellow-900/20 text-yellow-300"
          }`}
        >
          <div className="flex items-center gap-2 font-semibold mb-1">
            {runResult.ok ? "✓ Success" : "⚠ Sent (no API key or error)"}
            {runResult.status && (
              <span className="rounded bg-black/20 px-1.5 py-0.5 font-mono text-[10px]">
                HTTP {runResult.status}
              </span>
            )}
            {!runResult.hadApiKey && (
              <span className="rounded bg-yellow-900/40 px-1.5 py-0.5 text-[10px] text-yellow-400">
                No API key set
              </span>
            )}
          </div>
          <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-all text-[11px] opacity-80">
            {runResult.response || "(empty response)"}
          </pre>
        </div>
      )}

      {/* ── Expanded detail ── */}
      {expanded && (
        <div className="border-t border-gray-800 px-5 py-4 space-y-4">

          {/* Webhook URL */}
          <WebhookUrl system={automation.trigger.system} event={automation.trigger.event} />

          {/* Trigger */}
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-600">Trigger</p>
            <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-xs">
              <Detail label="System" value={triggerMeta.label} />
              <Detail label="Event"  value={automation.trigger.event} mono />
              {automation.trigger.conditions?.map((c, i) => (
                <Detail key={i} label={`Condition ${i + 1}`} value={`${c.field} ${c.operator} "${c.value}"`} />
              ))}
            </div>
          </div>

          {/* Action */}
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-600">Action</p>
            <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-xs">
              <Detail label="System"    value={actionMeta.label} />
              <Detail label="Operation" value={automation.action.operation} mono />
              <Detail label="Endpoint"  value={`${automation.action.method} ${automation.action.endpoint}`} mono />
            </div>
          </div>

          {/* Field mapping */}
          {Object.keys(automation.action.fieldMapping).length > 0 && (
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-600">Field Mapping</p>
              <div className="space-y-0.5">
                {Object.entries(automation.action.fieldMapping).map(([src, tgt]) => (
                  <p key={src} className="font-mono text-[11px] text-gray-400">
                    <span className={triggerMeta.color}>{src}</span>
                    <span className="text-gray-600"> → </span>
                    <span className={actionMeta.color}>{tgt}</span>
                  </p>
                ))}
              </div>
            </div>
          )}

          {/* Sample payload */}
          {automation.action.samplePayload && (
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-600">
                Sample Payload (used for manual run)
              </p>
              <pre className="rounded-lg bg-gray-950 p-3 text-[11px] text-gray-300 overflow-auto max-h-40 whitespace-pre-wrap">
                {JSON.stringify(automation.action.samplePayload, null, 2)}
              </pre>
            </div>
          )}

          {/* Last run info */}
          {automation.lastRunAt && (
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-600">Last Run</p>
              <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-xs">
                <Detail label="At"     value={new Date(automation.lastRunAt).toLocaleString()} />
                <Detail label="Status" value={automation.lastRunStatus ?? "—"} />
                {automation.lastRunHttpStatus != null && (
                  <Detail label="HTTP" value={String(automation.lastRunHttpStatus)} />
                )}
              </div>
              {automation.lastRunResponse && (
                <pre className="mt-2 rounded bg-gray-950 p-2 text-[11px] text-gray-400 overflow-auto max-h-24 whitespace-pre-wrap break-all">
                  {automation.lastRunResponse}
                </pre>
              )}
            </div>
          )}

          {/* Delete */}
          {!automation.isTemplate && (
            <div className="flex justify-end pt-1">
              <button
                onClick={handleDelete}
                disabled={deletePending}
                className="text-xs text-red-500 hover:text-red-400 disabled:opacity-50 transition-colors"
              >
                {deletePending ? "Deleting…" : "Delete automation"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Detail({ label, value, mono }: { label: string; value?: string; mono?: boolean }) {
  return (
    <div>
      <span className="text-gray-600">{label}: </span>
      <span className={`text-gray-300 ${mono ? "font-mono" : ""}`}>{value || "—"}</span>
    </div>
  );
}
