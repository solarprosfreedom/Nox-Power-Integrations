"use client";

import { useState, useEffect } from "react";
import { fetchAutomations } from "@/app/actions/automations";
import AutomationCard from "@/components/middleware/AutomationCard";
import AutomationBuilder from "@/components/middleware/AutomationBuilder";
import LogsTab from "@/components/tabs/LogsTab";
import { SYSTEM_META, type Automation, type AutomationSystem } from "@/lib/automations-types";
import type { ApiLog } from "@/lib/logger";

// ── Webhook URL card (matches AutomationCard style) ───────────────────────
interface WebhookUrlDef {
  label: string;
  path: string;
  badge: string;
  badgeColor: string;
  description: string;
  defaultEnabled: boolean;
}

const WEBHOOK_URLS: WebhookUrlDef[] = [
  {
    label: "Enerflo v2 (real webhooks)",
    path: "/api/webhooks/enerflo-v2",
    badge: "Set in Enerflo → Settings → Webhooks",
    badgeColor: "text-orange-400",
    description: "Handles deal.projectSubmitted → multi-step Terros account creation.",
    defaultEnabled: true,
  },
  {
    label: "Enerflo v1 (e.g. update_customer)",
    path: "/api/webhooks/enerflo-v1",
    badge: "Company Settings → Webhooks (v1 list)",
    badgeColor: "text-amber-400",
    description:
      "Separate URL for Enerflo 1.0 hooks (update_customer, new_customer). Logs payload — use Activity Logs / Supabase to inspect.",
    defaultEnabled: true,
  },
  {
    label: "Generic event bus",
    path: "/api/webhooks/enerflo",
    badge: "Internal / testing",
    badgeColor: "text-gray-500",
    description: "POST { event, data } to trigger any matching automation.",
    defaultEnabled: false,
  },
  {
    label: "Terros → Enerflo",
    path: "/api/webhooks/terros",
    badge: "Set in Terros → Settings → Webhooks",
    badgeColor: "text-sky-400",
    description:
      "Account add/update: creates or updates an Enerflo customer (v1 create, v3 update) and links Terros externalLeadId after create.",
    defaultEnabled: true,
  },
];

function WebhookUrlCard({ def }: { def: WebhookUrlDef }) {
  const [enabled, setEnabled] = useState(def.defaultEnabled);
  const [copied,  setCopied]  = useState(false);
  const [origin,  setOrigin]  = useState("");

  useEffect(() => { setOrigin(window.location.origin); }, []);

  const full = origin ? `${origin}${def.path}` : def.path;

  function copy() {
    navigator.clipboard.writeText(full).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }

  return (
    <div className={`rounded-xl border transition-colors overflow-hidden
      ${enabled ? "border-teal-800 bg-gray-900" : "border-gray-800 bg-gray-900/60"}`}
    >
      <div className="flex flex-wrap items-start gap-4 px-5 py-4">
        {/* Toggle */}
        <div className="flex flex-col items-center gap-1 pt-0.5">
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            onClick={() => setEnabled((v) => !v)}
            className={`relative h-6 w-11 rounded-full transition-colors focus:outline-none
              ${enabled ? "bg-teal-600" : "bg-gray-700"}`}
          >
            <span
              className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform
                ${enabled ? "translate-x-5" : "translate-x-0"}`}
            />
          </button>
          <span className="text-[10px] text-gray-600">{enabled ? "ON" : "OFF"}</span>
        </div>

        {/* Label + URL */}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
            <h3 className="text-sm font-semibold text-white">{def.label}</h3>
            <span className={`text-[10px] ${def.badgeColor}`}>{def.badge}</span>
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded bg-gray-800 px-2 py-1 text-[11px] text-teal-300 font-mono">
              {full || def.path}
            </code>
            <button
              onClick={copy}
              className="flex-shrink-0 rounded bg-gray-800 px-2 py-1 text-[11px] text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
          <p className="mt-1.5 text-[10px] text-gray-600">{def.description}</p>
        </div>
      </div>
    </div>
  );
}

function WebhookUrlsBox() {
  return (
    <div className="space-y-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-600">
        Webhook URLs
      </p>
      {WEBHOOK_URLS.map((u) => (
        <WebhookUrlCard key={u.path} def={u} />
      ))}
    </div>
  );
}

// ── Flow diagram (static) ─────────────────────────────────────────────────
function FlowDiagram() {
  const steps: { system: AutomationSystem; label: string; sublabel: string }[] = [
    { system: "sequifi", label: "Sequifi", sublabel: "Onboarding Complete" },
    { system: "enerflo", label: "Enerflo", sublabel: "Create Rep in CRM" },
    { system: "terros",  label: "Terros",  sublabel: "Stats / Leaderboard" },
  ];

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/50 px-6 py-5">
      <p className="mb-4 text-[10px] font-semibold uppercase tracking-wider text-gray-600">
        Data flow
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {steps.map((s, i) => {
          const m = SYSTEM_META[s.system];
          return (
            <div key={i} className="flex items-center gap-2">
              <div className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-center">
                <div className="flex items-center gap-1.5 justify-center">
                  <span className={`h-2 w-2 rounded-full flex-shrink-0 ${m.dot}`} />
                  <span className={`text-xs font-semibold ${m.color}`}>{s.label}</span>
                </div>
                <p className="text-[10px] text-gray-600 mt-0.5">{s.sublabel}</p>
              </div>
              {i < steps.length - 1 && (
                <span className="text-teal-700 text-lg font-bold">→</span>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-[11px] text-gray-600">
        Sequifi handles rep onboarding &amp; commissions → Enerflo is the CRM where reps manage leads → Terros receives stats &amp; competition data for leaderboards.
        Automations are triggered manually or by webhook events once API keys are configured.
      </p>
    </div>
  );
}

// ── Stats bar ─────────────────────────────────────────────────────────────
function StatsBar({ automations }: { automations: Automation[] }) {
  const total   = automations.length;
  const active  = automations.filter((a) => a.enabled).length;
  const runs    = automations.reduce((s, a) => s + a.runCount, 0);
  const ok      = automations.filter((a) => a.lastRunStatus === "success").length;
  const failed  = automations.filter((a) => a.lastRunStatus === "failed").length;

  const stats = [
    { label: "Total",   value: total,  color: "text-white" },
    { label: "Active",  value: active, color: "text-teal-400" },
    { label: "Runs",    value: runs,   color: "text-indigo-400" },
    { label: "Success", value: ok,     color: "text-green-400" },
    { label: "Failed",  value: failed, color: "text-red-400" },
  ];

  return (
    <div className="flex gap-6">
      {stats.map((s) => (
        <div key={s.label}>
          <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
          <p className="text-[11px] text-gray-600">{s.label}</p>
        </div>
      ))}
    </div>
  );
}

// ── Filter tabs ───────────────────────────────────────────────────────────
type FilterId = "all" | "active" | "inactive";
const FILTERS: { id: FilterId; label: string }[] = [
  { id: "all",      label: "All" },
  { id: "active",   label: "Active" },
  { id: "inactive", label: "Inactive" },
];

type TopTab = "automations" | "logs";

// ── Main panel ────────────────────────────────────────────────────────────
export default function MiddlewarePanel({ logs }: { logs: ApiLog[] }) {
  const [topTab, setTopTab]           = useState<TopTab>("automations");
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [loading, setLoading]         = useState(true);
  const [showBuilder, setShowBuilder] = useState(false);
  const [filter, setFilter]           = useState<FilterId>("all");

  useEffect(() => {
    fetchAutomations().then((a) => { setAutomations(a); setLoading(false); });
  }, []);

  function handleChange(updated: Automation) {
    setAutomations((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
  }

  function handleDelete(id: string) {
    setAutomations((prev) => prev.filter((a) => a.id !== id));
  }

  function handleCreated(automation: Automation) {
    setAutomations((prev) => [...prev, automation]);
    setShowBuilder(false);
  }

  const filtered = automations.filter((a) => {
    if (filter === "active")   return a.enabled;
    if (filter === "inactive") return !a.enabled;
    return true;
  });

  return (
    <div className="space-y-6">
      {/* ── Top tabs ─────────────────────────────────────────── */}
      <div className="flex gap-1 border-b border-gray-800 -mx-8 px-8 pt-0 pb-0">
        {(
          [
            { id: "automations" as TopTab, label: "Automations", icon: "⚙️" },
            { id: "logs"        as TopTab, label: "Activity Logs", icon: "📋" },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            onClick={() => setTopTab(t.id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors
              ${topTab === t.id
                ? "border-teal-400 text-teal-300"
                : "border-transparent text-gray-500 hover:text-gray-300"
              }`}
          >
            <span>{t.icon}</span>
            {t.label}
            {t.id === "logs" && logs.length > 0 && (
              <span className="ml-1 rounded-full bg-indigo-600/80 px-1.5 py-0.5 text-[10px] font-bold text-white">
                {logs.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Activity Logs tab ────────────────────────────────── */}
      {topTab === "logs" && <LogsTab logs={logs} />}

      {/* ── Automations tab ──────────────────────────────────── */}
      {topTab === "automations" && <>
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-white">Automations</h2>
          <p className="mt-0.5 text-sm text-gray-500">
            Connect Enerflo, Sequifi, and Terros with automated data flows.
          </p>
        </div>
        <button
          onClick={() => setShowBuilder((v) => !v)}
          className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white
                     hover:bg-teal-500 transition-colors"
        >
          + New Automation
        </button>
      </div>

      {/* Stats */}
      {!loading && <StatsBar automations={automations} />}

      {/* Flow diagram */}
      <FlowDiagram />

      {/* Webhook URLs */}
      <WebhookUrlsBox />

      {/* Builder */}
      {showBuilder && (
        <AutomationBuilder
          onCreated={handleCreated}
          onCancel={() => setShowBuilder(false)}
        />
      )}

      {/* Filter tabs */}
      <div className="flex gap-1 border-b border-gray-800 pb-0">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors
              ${filter === f.id
                ? "bg-gray-950 text-white border-t border-x border-gray-800"
                : "text-gray-400 hover:text-gray-200 hover:bg-gray-800/50"
              }`}
          >
            {f.label}
            {f.id === "all" && (
              <span className="ml-1.5 rounded-full bg-gray-700 px-1.5 py-0.5 text-[10px] text-gray-300">
                {automations.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Automation list */}
      {loading ? (
        <p className="text-sm text-gray-600">Loading automations…</p>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-800 py-16 text-center">
          <p className="text-3xl">⚙️</p>
          <p className="mt-3 text-base font-medium text-gray-400">No automations here</p>
          <p className="mt-1 text-sm text-gray-600">
            {filter === "all"
              ? 'Click "+ New Automation" to create one, or enable a template above.'
              : `No ${filter} automations. Switch to "All" to see all.`}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Templates first */}
          {filtered.some((a) => a.isTemplate) && (
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-600">
              Pre-built Templates
            </p>
          )}
          {filtered
            .filter((a) => a.isTemplate)
            .map((a) => (
              <AutomationCard key={a.id} automation={a} onChange={handleChange} onDelete={handleDelete} />
            ))}

          {/* Custom automations */}
          {filtered.some((a) => !a.isTemplate) && (
            <p className="mt-4 text-[10px] font-semibold uppercase tracking-wider text-gray-600">
              Custom
            </p>
          )}
          {filtered
            .filter((a) => !a.isTemplate)
            .map((a) => (
              <AutomationCard key={a.id} automation={a} onChange={handleChange} onDelete={handleDelete} />
            ))}
        </div>
      )}
      </>}
    </div>
  );
}
