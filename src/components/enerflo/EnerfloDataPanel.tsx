"use client";

import { useState } from "react";
import EnerfloResourceList, {
  LEAD_COLUMNS,
  DEAL_COLUMNS,
  INSTALL_COLUMNS,
} from "@/components/enerflo/EnerfloResourceList";
import {
  fetchEnerfloLeadsPage,
  fetchEnerfloDealsPage,
  fetchEnerfloInstallsPage,
} from "@/app/actions/enerflo-lists";
import SetterBackfillPanel from "@/components/enerflo/SetterBackfillPanel";
import AxiaImportPanel from "@/components/enerflo/AxiaImportPanel";
import type { ApiLog } from "@/lib/logger";

// ── Inline activity log (Data-tab scoped) ─────────────────────────────────

const OPERATION_LABELS: Record<string, string> = {
  create_user:         "Create User",
  create_customer:     "Create Customer",
  list_users_page:     "List Users",
  list_customers_page: "List Customers",
  list_leads_page:     "List Leads",
  list_deals_page:     "List Deals",
  list_installs_page:  "List Installs",
  submit_lead:         "Submit Lead",
  update_lead_status:  "Update Lead Status",
  delete_lead:         "Delete Lead",
  "create-lead":       "Create Lead",
};

const DATA_OPS = new Set(Object.keys(OPERATION_LABELS));

function statusBadgeClass(log: ApiLog) {
  if (log.fetchError) return "bg-red-900/60 text-red-300 border-red-800";
  if (log.status === null) return "bg-gray-700 text-gray-400 border-gray-600";
  if (log.ok) return "bg-green-900/60 text-green-300 border-green-800";
  return "bg-red-900/60 text-red-300 border-red-800";
}

function statusLabel(log: ApiLog) {
  if (log.fetchError) return "Network error";
  if (log.status === null) return "No response";
  return `${log.status} ${log.statusText ?? ""}`.trim();
}

function DataActivityLog({ logs }: { logs: ApiLog[] }) {
  const dataLogs = logs.filter((l) => DATA_OPS.has(l.operation));

  if (dataLogs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-800 py-20 text-center">
        <p className="text-4xl">📋</p>
        <p className="mt-3 text-base font-medium text-gray-400">No activity yet</p>
        <p className="mt-1 text-sm text-gray-600">
          Load Leads, Deals, or Installs — every request appears here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-semibold text-white">
          Activity Logs{" "}
          <span className="text-sm font-normal text-gray-500">({dataLogs.length})</span>
        </h2>
        <p className="text-xs text-gray-500">Most recent first · Data tab only</p>
      </div>
      {dataLogs.map((log) => (
        <div key={log.id} className="rounded-lg border border-gray-800 bg-gray-900 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className={`rounded border px-2.5 py-0.5 text-xs font-medium ${statusBadgeClass(log)}`}>
              {statusLabel(log)}
            </span>
            <span className="rounded bg-gray-800 px-2 py-0.5 text-xs font-mono text-gray-400">
              {log.method}
            </span>
            <span className="text-sm font-medium text-white">
              {OPERATION_LABELS[log.operation] ?? log.operation}
            </span>
            {!log.hadApiKey && (
              <span className="rounded bg-yellow-900/40 px-2 py-0.5 text-xs text-yellow-400">
                no api key
              </span>
            )}
            <span className="ml-auto text-xs text-gray-500">
              {new Date(log.timestamp).toLocaleString()}
            </span>
          </div>
          <p className="mt-2 break-all text-xs text-gray-500">
            <span className="text-gray-600">URL: </span>{log.url}
          </p>
          {log.fetchError && (
            <p className="mt-2 rounded bg-red-950/40 px-3 py-2 text-xs text-red-300">
              {log.fetchError}
            </p>
          )}
          {!log.fetchError && log.responsePreview && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-gray-500 hover:text-gray-300 select-none">
                Response preview
              </summary>
              <pre className="mt-1 max-h-48 overflow-auto rounded bg-gray-950 p-3 text-xs text-gray-300 whitespace-pre-wrap break-all">
                {log.responsePreview}
              </pre>
            </details>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Nav ───────────────────────────────────────────────────────────────────

type DataView = "leads" | "deals" | "installs" | "setter-backfill" | "axia-import" | "logs";

const VIEW_OPS: Record<DataView, string[]> = {
  leads:            ["list_leads_page"],
  deals:            ["list_deals_page"],
  installs:         ["list_installs_page"],
  "setter-backfill": [],
  "axia-import":    [],
  logs:             [],
};

const NAV: { id: DataView; label: string; icon: string }[] = [
  { id: "leads",            label: "Leads",           icon: "🎯" },
  { id: "deals",            label: "Deals",           icon: "💰" },
  { id: "installs",         label: "Installs",        icon: "🔧" },
  { id: "setter-backfill",  label: "Setter Backfill", icon: "👤" },
  { id: "axia-import",      label: "Axia Import",     icon: "📥" },
  { id: "logs",             label: "Activity Logs",   icon: "📋" },
];

// ── View configs ──────────────────────────────────────────────────────────

const VIEW_CONFIG = {
  leads: {
    title:       "Leads",
    description: "Survey / door-knock lead entries from GET /api/v3/surveys.",
    columns:     LEAD_COLUMNS,
    fetcher:     fetchEnerfloLeadsPage,
    filterMode:  "leads" as const,
    endpoint:    "GET /api/v3/surveys",
  },
  deals: {
    title:       "Deals",
    description: "Signed proposals and active deals from GET /api/v3/installs.",
    columns:     DEAL_COLUMNS,
    fetcher:     fetchEnerfloDealsPage,
    filterMode:  "deals" as const,
    endpoint:    "GET /api/v3/installs",
  },
  installs: {
    title:       "Installs",
    description: "Install reports from GET /api/v3/install-reports.",
    columns:     INSTALL_COLUMNS,
    fetcher:     fetchEnerfloInstallsPage,
    filterMode:  "installs" as const,
    endpoint:    "GET /api/v3/install-reports",
  },
} as const;

// ── Panel ─────────────────────────────────────────────────────────────────

interface Props {
  logs: ApiLog[];
  onLog: (log: ApiLog) => void;
}

export default function EnerfloDataPanel({ logs, onLog: _onLog }: Props) {
  const [view, setView] = useState<DataView>("leads");

  const dataLogCount = logs.filter((l) => DATA_OPS.has(l.operation)).length;

  return (
    <div className="flex h-full min-h-0">
      {/* ── Sub-sidebar ── */}
      <nav className="flex w-44 flex-shrink-0 flex-col overflow-y-auto border-r border-gray-800 bg-gray-900/50 py-3">
        <p className="px-4 mb-2 text-[10px] font-semibold uppercase tracking-widest text-gray-600">
          Data
        </p>
        {NAV.map((item) => {
          const count =
            item.id === "logs"
              ? dataLogCount
              : VIEW_OPS[item.id].length
                ? logs.filter((l) => VIEW_OPS[item.id].includes(l.operation)).length
                : 0;

          return (
            <button
              key={item.id}
              onClick={() => setView(item.id)}
              className={`w-full flex items-center gap-2 px-4 py-2.5 text-sm text-left transition-colors
                ${view === item.id
                  ? "bg-orange-500/10 text-orange-300 font-medium"
                  : "text-gray-400 hover:bg-gray-800/50 hover:text-gray-200"
                }`}
            >
              <span className="text-base">{item.icon}</span>
              <span className="truncate">{item.label}</span>
              {count > 0 && (
                <span className={`ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-bold
                  ${item.id === "logs"
                    ? "bg-indigo-600/80 text-white"
                    : "bg-gray-800 text-gray-500"
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* ── Main content ── */}
      <div className="flex-1 overflow-y-auto min-w-0">

        {/* Leads / Deals / Installs */}
        {(view === "leads" || view === "deals" || view === "installs") && (() => {
          const cfg = VIEW_CONFIG[view];
          return (
            <div className="px-8 py-8">
              <div className="mb-6">
                <h2 className="text-xl font-semibold text-white">{cfg.title}</h2>
                <p className="text-sm text-gray-500 mt-1">{cfg.description}</p>
              </div>
              <EnerfloResourceList
                title={cfg.title}
                description={`Paginated list from ${cfg.endpoint}.`}
                columns={cfg.columns}
                fetchPage={cfg.fetcher}
                filterMode={cfg.filterMode}
              />
            </div>
          );
        })()}

        {view === "setter-backfill" && <SetterBackfillPanel />}

        {view === "axia-import" && <AxiaImportPanel />}

        {/* Activity Logs */}
        {view === "logs" && (
          <div className="px-8 py-8">
            <DataActivityLog logs={logs} />
          </div>
        )}
      </div>
    </div>
  );
}
