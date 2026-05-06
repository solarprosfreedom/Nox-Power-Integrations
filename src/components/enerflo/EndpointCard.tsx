"use client";

import { useState, useTransition } from "react";
import { callEnerfloEndpoint } from "@/app/actions/enerflo";
import type { EndpointDef, ParamDef } from "@/lib/enerflo/resources";
import type { ApiLog } from "@/lib/logger";

const METHOD_COLOR: Record<string, string> = {
  GET:    "bg-sky-900/60 text-sky-300 border-sky-700",
  POST:   "bg-green-900/60 text-green-300 border-green-700",
  PATCH:  "bg-yellow-900/60 text-yellow-300 border-yellow-700",
  PUT:    "bg-orange-900/60 text-orange-300 border-orange-700",
  DELETE: "bg-red-900/60 text-red-300 border-red-700",
};

function ParamField({ param }: { param: ParamDef }) {
  const base =
    "w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors";

  if (param.type === "select" && param.options) {
    return (
      <select name={param.name} className={base}>
        {param.options.map((o) => (
          <option key={o} value={o}>{o || "— any —"}</option>
        ))}
      </select>
    );
  }

  if (param.type === "textarea") {
    return (
      <textarea
        name={param.name}
        rows={3}
        placeholder={param.placeholder}
        required={param.required}
        className={`${base} resize-none`}
      />
    );
  }

  const inputType =
    param.type === "number" ? "number"
    : param.type === "email" ? "email"
    : param.type === "tel" ? "tel"
    : param.type === "password" ? "password"
    : "text";

  return (
    <input
      type={inputType}
      name={param.name}
      placeholder={param.placeholder}
      required={param.required}
      className={base}
    />
  );
}

interface Props {
  endpoint: EndpointDef;
  onLog: (log: ApiLog) => void;
}

export default function EndpointCard({ endpoint, onLog }: Props) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<ApiLog | null>(null);
  const [isPending, startTransition] = useTransition();

  const pathParams = endpoint.params.filter((p) => p.location === "path");
  const queryParams = endpoint.params.filter((p) => p.location === "query");
  const bodyParams  = endpoint.params.filter((p) => p.location === "body");

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);

    const pathObj: Record<string, string> = {};
    pathParams.forEach((p) => { const v = fd.get(p.name) as string; if (v) pathObj[p.name] = v; });

    const queryObj: Record<string, string> = {};
    queryParams.forEach((p) => { const v = fd.get(p.name) as string; if (v) queryObj[p.name] = v; });

    const bodyObj: Record<string, unknown> = {};
    bodyParams.forEach((p) => {
      const v = fd.get(p.name) as string;
      if (v) bodyObj[p.name] = p.type === "number" ? Number(v) : v;
    });

    startTransition(async () => {
      const { log } = await callEnerfloEndpoint({
        operation: endpoint.id,
        method: endpoint.method,
        path: endpoint.path,
        pathParams: Object.keys(pathObj).length ? pathObj : undefined,
        query: Object.keys(queryObj).length ? queryObj : undefined,
        body: Object.keys(bodyObj).length ? bodyObj : undefined,
      });
      setResult(log);
      onLog(log);
    });
  }

  const mc = METHOD_COLOR[endpoint.method] ?? "bg-gray-700 text-gray-300 border-gray-600";

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
      {/* Header row */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-5 py-4 text-left hover:bg-gray-800/40 transition-colors"
      >
        <span className={`rounded border px-2 py-0.5 text-[11px] font-bold tracking-wide flex-shrink-0 ${mc}`}>
          {endpoint.method}
        </span>
        <span className="font-mono text-xs text-gray-400 flex-shrink-0">{endpoint.path}</span>
        <span className="ml-2 text-sm font-medium text-white">{endpoint.label}</span>
        {!endpoint.verified && (
          <span className="ml-auto rounded bg-yellow-900/30 px-2 py-0.5 text-[10px] text-yellow-500">
            verify path
          </span>
        )}
        <svg
          className={`ml-auto h-4 w-4 text-gray-500 transition-transform flex-shrink-0 ${open ? "rotate-180" : ""}`}
          viewBox="0 0 20 20" fill="currentColor"
        >
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>

      {/* Expanded form */}
      {open && (
        <div className="border-t border-gray-800 px-5 py-5">
          <p className="mb-4 text-sm text-gray-400">{endpoint.description}</p>

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Path params */}
            {pathParams.length > 0 && (
              <ParamGroup label="Path Parameters" params={pathParams} />
            )}
            {/* Query params */}
            {queryParams.length > 0 && (
              <ParamGroup label="Query Parameters" params={queryParams} />
            )}
            {/* Body params */}
            {bodyParams.length > 0 && (
              <ParamGroup label="Body" params={bodyParams} />
            )}

            {endpoint.params.length === 0 && (
              <p className="text-sm text-gray-500 italic">No parameters required.</p>
            )}

            <div className="flex items-center gap-3 pt-1">
              <button
                type="submit"
                disabled={isPending}
                className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white
                           hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isPending ? "Sending…" : "Send Request"}
              </button>
              {result && (
                <span className={`text-sm font-medium ${result.ok ? "text-green-400" : "text-red-400"}`}>
                  {result.ok ? "✓" : "✗"} HTTP {result.status ?? "—"}
                  {!result.hadApiKey && (
                    <span className="ml-2 text-xs text-yellow-500">(no API key)</span>
                  )}
                </span>
              )}
            </div>
          </form>

          {/* Response preview */}
          {result && (
            <div className="mt-4">
              <p className="mb-1 text-xs font-semibold text-gray-500 uppercase tracking-wider">Response</p>
              <pre className="max-h-56 overflow-auto rounded-lg bg-gray-950 p-4 text-xs text-gray-300 whitespace-pre-wrap break-all">
                {result.fetchError ?? (result.responsePreview || "(empty)")}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ParamGroup({ label, params }: { label: string; params: ParamDef[] }) {
  return (
    <div>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-600">{label}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {params.map((p) => (
          <div key={p.name} className={p.type === "textarea" ? "sm:col-span-2" : ""}>
            <label className="mb-1 block text-xs font-medium text-gray-400">
              {p.label}
              {p.required && <span className="ml-1 text-red-400">*</span>}
              <span className="ml-1 font-mono text-gray-600">{p.name}</span>
            </label>
            <ParamField param={p} />
            {p.description && (
              <p className="mt-0.5 text-[11px] text-gray-600">{p.description}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
