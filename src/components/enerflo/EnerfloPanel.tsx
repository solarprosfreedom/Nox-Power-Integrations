"use client";

import { useState } from "react";
import { ENERFLO_RESOURCES } from "@/lib/enerflo/resources";
import EndpointCard from "@/components/enerflo/EndpointCard";
import EnerfloDataPanel from "@/components/enerflo/EnerfloDataPanel";
import type { ApiLog } from "@/lib/logger";

type TopTab = "data" | "docs";

interface Props {
  logs: ApiLog[];
  onLog: (log: ApiLog) => void;
}

export default function EnerfloPanel({ logs, onLog }: Props) {
  const [topTab, setTopTab] = useState<TopTab>("data");
  const [selectedResourceId, setSelectedResourceId] = useState<string>(
    ENERFLO_RESOURCES[0]?.id ?? ""
  );

  const selectedResource = ENERFLO_RESOURCES.find((r) => r.id === selectedResourceId);

  return (
    <div className="flex h-full min-h-0 flex-col">

      {/* ── Top tab bar ────────────────────────────────────────── */}
      <div className="flex flex-shrink-0 border-b border-gray-800 bg-gray-900/60 px-4 pt-1 gap-1">
        {(
          [
            { id: "data" as TopTab,  label: "Data",         icon: "🗄️" },
            { id: "docs" as TopTab,  label: "API Docs",     icon: "📖" },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setTopTab(tab.id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors
              ${topTab === tab.id
                ? "border-orange-400 text-orange-300"
                : "border-transparent text-gray-500 hover:text-gray-300"
              }`}
          >
            <span>{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Tab content ────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0">

        {/* DATA TAB — Pipeline, Users, Customers, Logs */}
        {topTab === "data" && (
          <EnerfloDataPanel logs={logs} onLog={onLog} />
        )}

        {/* API DOCS TAB — pure endpoint documentation */}
        {topTab === "docs" && (
          <div className="flex flex-1 min-h-0">
            {/* Resource sidebar */}
            <nav className="flex w-48 flex-shrink-0 flex-col overflow-y-auto border-r border-gray-800 bg-gray-900/50 py-3">
              <p className="px-4 mb-2 text-[10px] font-semibold uppercase tracking-widest text-gray-600">
                Resources
              </p>
              {ENERFLO_RESOURCES.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setSelectedResourceId(r.id)}
                  className={`w-full flex items-center gap-2 px-4 py-2 text-sm text-left transition-colors
                    ${selectedResourceId === r.id
                      ? "bg-orange-500/10 text-orange-300 font-medium"
                      : "text-gray-400 hover:bg-gray-800/50 hover:text-gray-200"
                    }`}
                >
                  <span className="text-base">{r.icon}</span>
                  <span className="truncate">{r.label}</span>
                </button>
              ))}
            </nav>

            {/* Endpoint cards */}
            <div className="flex-1 overflow-y-auto px-8 py-8 min-w-0">
              {selectedResource && (
                <>
                  <div className="mb-6 flex items-center gap-3">
                    <span className="text-2xl">{selectedResource.icon}</span>
                    <div>
                      <h2 className="text-xl font-semibold text-white">{selectedResource.label}</h2>
                      <p className="text-sm text-gray-500">
                        {selectedResource.endpoints.length} endpoint
                        {selectedResource.endpoints.length !== 1 ? "s" : ""}
                        {" · "}
                        <span className="font-mono text-xs text-gray-500">api-key header</span>
                      </p>
                    </div>
                  </div>
                  <div className="space-y-3">
                    {selectedResource.endpoints.map((ep) => (
                      <EndpointCard key={ep.id} endpoint={ep} onLog={onLog} />
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
