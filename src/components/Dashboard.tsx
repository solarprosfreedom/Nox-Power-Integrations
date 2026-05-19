"use client";

import { useState, useEffect } from "react";
import EnerfloPanel from "@/components/enerflo/EnerfloPanel";
import MiddlewarePanel from "@/components/middleware/MiddlewarePanel";
import SyncTab from "@/components/tabs/SyncTab";
import UsersTab from "@/components/tabs/UsersTab";
import MigrationTab from "@/components/tabs/MigrationTab";
import { fetchStoredLogs } from "@/app/actions/enerflo";
import { getIntegrationEnvStatus } from "@/app/actions/env-status";
import type { ApiLog } from "@/lib/logger";

type SectionId = "enerflo" | "sequifi" | "terros" | "middleware" | "sync" | "users" | "migration";

const VENDORS: { id: SectionId; label: string; color: string; dot: string; tagline: string }[] = [
  { id: "enerflo",    label: "Enerflo",    color: "text-orange-400", dot: "bg-orange-400", tagline: "CRM & Solar Sales" },
  { id: "sequifi",    label: "Sequifi",    color: "text-violet-400", dot: "bg-violet-400", tagline: "Onboarding & Commissions" },
  { id: "terros",     label: "Terros",     color: "text-sky-400",    dot: "bg-sky-400",    tagline: "Knocking & Reporting" },
];

function ComingSoon({ id }: { id: SectionId }) {
  const v = VENDORS.find((x) => x.id === id)!;
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center">
        <p className={`text-5xl font-bold ${v.color}`}>{v.label}</p>
        <p className="mt-2 text-gray-500">{v.tagline}</p>
        <p className="mt-4 text-sm text-gray-600 max-w-sm mx-auto">
          Integration skeleton is ready. Paste your API keys once access is granted and this
          section will populate with endpoints.
        </p>
        <span className="mt-6 inline-block rounded-full border border-gray-700 bg-gray-800 px-4 py-1.5 text-xs text-gray-500">
          Coming soon
        </span>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [section, setSection] = useState<SectionId>("enerflo");
  const [logs, setLogs] = useState<ApiLog[]>([]);
  const [envStatus, setEnvStatus] = useState<{
    enerflo: boolean;
    terros: boolean;
    sequifi: boolean;
  } | null>(null);

  useEffect(() => {
    fetchStoredLogs().then(setLogs);
    getIntegrationEnvStatus().then(setEnvStatus);
  }, []);

  function addLog(log: ApiLog) {
    setLogs((prev) => [log, ...prev]);
  }

  const activeVendor = VENDORS.find((v) => v.id === section);

  return (
    <div className="flex h-screen overflow-hidden bg-gray-950 text-gray-100">

      {/* ── Left Sidebar ─────────────────────────────────────────── */}
      <aside className="flex w-52 flex-shrink-0 flex-col border-r border-gray-800 bg-gray-900">
        {/* Logo */}
        <div className="px-5 py-5 border-b border-gray-800">
          <p className="text-sm font-bold text-white">Integration</p>
          <p className="text-xs text-gray-500">Middleware</p>
        </div>

        <nav className="flex-1 px-2 py-4 space-y-1 overflow-y-auto">
          {/* Integrations section */}
          <p className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-widest text-gray-600">
            Integrations
          </p>

          {VENDORS.map((v) => {
            const isActive = section === v.id;
            return (
              <button
                key={v.id}
                onClick={() => setSection(v.id)}
                className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors
                  ${isActive
                    ? "bg-gray-800 text-white"
                    : "text-gray-400 hover:bg-gray-800/50 hover:text-gray-200"
                  }`}
              >
                <span className={`h-2 w-2 flex-shrink-0 rounded-full ${v.dot}`} />
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{v.label}</p>
                  <p className="text-[10px] text-gray-600 truncate">{v.tagline}</p>
                </div>
                {v.id === "enerflo" && logs.length > 0 && (
                  <span className="ml-auto rounded-full bg-indigo-600/80 px-1.5 py-0.5 text-[10px] font-bold text-white flex-shrink-0">
                    {logs.length}
                  </span>
                )}
              </button>
            );
          })}

          {/* Divider */}
          <div className="mx-3 my-3 border-t border-gray-800" />

          {/* Automations section */}
          <p className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-widest text-gray-600">
            Automations
          </p>

          <button
            onClick={() => setSection("middleware")}
            className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors
              ${section === "middleware"
                ? "bg-teal-900/40 text-teal-200"
                : "text-gray-400 hover:bg-gray-800/50 hover:text-gray-200"
              }`}
          >
            <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center text-teal-500">
              ⚙
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">Middleware</p>
              <p className="text-[10px] text-gray-600 truncate">Connect & automate</p>
            </div>
          </button>

          <button
            onClick={() => setSection("sync")}
            className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors
              ${section === "sync"
                ? "bg-violet-900/40 text-violet-200"
                : "text-gray-400 hover:bg-gray-800/50 hover:text-gray-200"
              }`}
          >
            <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center text-violet-400">
              ⇄
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">Bulk Sync</p>
              <p className="text-[10px] text-gray-600 truncate">Backfill historical data</p>
            </div>
          </button>

          <button
            onClick={() => setSection("users")}
            className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors
              ${section === "users"
                ? "bg-cyan-900/40 text-cyan-200"
                : "text-gray-400 hover:bg-gray-800/50 hover:text-gray-200"
              }`}
          >
            <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center text-cyan-400">
              👥
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">Users</p>
              <p className="text-[10px] text-gray-600 truncate">Compare across systems</p>
            </div>
          </button>

          <button
            onClick={() => setSection("migration")}
            className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors
              ${section === "migration"
                ? "bg-amber-900/40 text-amber-200"
                : "text-gray-400 hover:bg-gray-800/50 hover:text-gray-200"
              }`}
          >
            <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center text-amber-400">
              ⬆
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">Migration</p>
              <p className="text-[10px] text-gray-600 truncate">Export &amp; restore accounts</p>
            </div>
          </button>
        </nav>

        {/* Footer — reflects server env (.env.local), not .env.local.example */}
        <div className="px-4 py-4 border-t border-gray-800">
          {envStatus == null ? (
            <span className="block rounded-md bg-gray-800/80 px-3 py-2 text-center text-[11px] text-gray-500">
              Checking configuration…
            </span>
          ) : envStatus.enerflo || envStatus.terros || envStatus.sequifi ? (
            <div className="space-y-1 rounded-md bg-emerald-950/40 border border-emerald-900/50 px-3 py-2 text-[10px] text-emerald-200/90 leading-snug">
              <p className="font-semibold text-emerald-300/95">API keys (server)</p>
              <p>Enerflo: {envStatus.enerflo ? "set" : "missing"}</p>
              <p>Terros: {envStatus.terros ? "set" : "missing"}</p>
              <p>Sequifi: {envStatus.sequifi ? "set" : "missing"}</p>
            </div>
          ) : (
            <span className="block rounded-md bg-yellow-500/10 px-3 py-2 text-center text-[11px] font-medium text-yellow-500 leading-snug">
              No keys in .env.local — copy .env.local.example to .env.local and add your keys
            </span>
          )}
        </div>
      </aside>

      {/* ── Main content ─────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col min-w-0">

        {/* Top bar */}
        <header className="flex flex-shrink-0 items-center gap-3 border-b border-gray-800 bg-gray-900/50 px-6 py-3.5">
          {section === "middleware" ? (
            <>
              <span className="text-teal-500">⚙</span>
              <h1 className="text-base font-semibold text-teal-300">Middleware</h1>
              <span className="text-xs text-gray-600">Automated data flows between integrations</span>
            </>
          ) : section === "sync" ? (
            <>
              <span className="text-violet-400">⇄</span>
              <h1 className="text-base font-semibold text-violet-300">Bulk Sync</h1>
              <span className="text-xs text-gray-600">Backfill historical data between Enerflo and Terros</span>
            </>
          ) : section === "users" ? (
            <>
              <span className="text-cyan-400">👥</span>
              <h1 className="text-base font-semibold text-cyan-300">Users</h1>
              <span className="text-xs text-gray-600">Compare users between Enerflo and Terros</span>
            </>
          ) : section === "migration" ? (
            <>
              <span className="text-amber-400">⬆</span>
              <h1 className="text-base font-semibold text-amber-300">Migration</h1>
              <span className="text-xs text-gray-600">Export Terros accounts to Supabase and restore after fix</span>
            </>
          ) : activeVendor ? (
            <>
              <span className={`h-3 w-3 rounded-full ${activeVendor.dot}`} />
              <h1 className={`text-base font-semibold ${activeVendor.color}`}>{activeVendor.label}</h1>
              <span className="text-xs text-gray-600">{activeVendor.tagline}</span>
            </>
          ) : null}
        </header>

        {/* Panel content */}
        <div className="flex flex-1 min-h-0">
          {section === "enerflo" && (
            <EnerfloPanel logs={logs} onLog={addLog} />
          )}
          {section === "sequifi" && (
            <div className="flex-1 overflow-y-auto">
              <ComingSoon id="sequifi" />
            </div>
          )}
          {section === "terros" && (
            <div className="flex-1 overflow-y-auto">
              <ComingSoon id="terros" />
            </div>
          )}
          {section === "middleware" && (
            <div className="flex-1 overflow-y-auto px-8 py-8">
              <MiddlewarePanel logs={logs} />
            </div>
          )}
          {section === "sync" && (
            <div className="flex-1 overflow-y-auto px-8 py-8">
              <SyncTab />
            </div>
          )}
          {section === "users" && (
            <div className="flex-1 overflow-y-auto px-8 py-8">
              <UsersTab />
            </div>
          )}
          {section === "migration" && (
            <div className="flex-1 overflow-y-auto px-8 py-8">
              <MigrationTab />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
