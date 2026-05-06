"use client";

import type { ApiLog } from "@/lib/logger";

interface Props {
  logs: ApiLog[];
}

function StatusBadge({ log }: { log: ApiLog }) {
  if (log.fetchError) {
    return (
      <span className="rounded-full bg-red-900/60 px-2.5 py-0.5 text-xs font-medium text-red-300">
        Network Error
      </span>
    );
  }
  if (log.status === null) {
    return (
      <span className="rounded-full bg-gray-700 px-2.5 py-0.5 text-xs font-medium text-gray-400">
        No response
      </span>
    );
  }
  const color = log.ok
    ? "bg-green-900/60 text-green-300"
    : "bg-red-900/60 text-red-300";
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${color}`}>
      {log.status} {log.statusText}
    </span>
  );
}

function LogRow({ log }: { log: ApiLog }) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge log={log} />
        <span className="rounded bg-indigo-900/40 px-2 py-0.5 text-xs font-mono text-indigo-300">
          {log.vendor}
        </span>
        <span className="text-sm font-medium text-white">{log.operation}</span>
        <span className="ml-auto text-xs text-gray-500">
          {new Date(log.timestamp).toLocaleTimeString()}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-1 text-xs text-gray-400 sm:grid-cols-2">
        <span>
          <span className="text-gray-600">Method: </span>{log.method}
        </span>
        <span>
          <span className="text-gray-600">API Key: </span>
          {log.hadApiKey ? (
            <span className="text-green-400">provided</span>
          ) : (
            <span className="text-yellow-400">missing (expected until keys arrive)</span>
          )}
        </span>
        <span className="sm:col-span-2 break-all">
          <span className="text-gray-600">URL: </span>{log.url}
        </span>
      </div>

      {log.fetchError && (
        <p className="mt-2 rounded bg-red-950/40 px-3 py-2 text-xs text-red-300">
          {log.fetchError}
        </p>
      )}

      {log.responsePreview && !log.fetchError && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-gray-500 hover:text-gray-300">
            Response preview
          </summary>
          <pre className="mt-2 max-h-48 overflow-auto rounded bg-gray-950 p-3 text-xs text-gray-300 whitespace-pre-wrap break-all">
            {log.responsePreview}
          </pre>
        </details>
      )}
    </div>
  );
}

export default function LogsTab({ logs }: Props) {
  if (logs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-800 py-20 text-center">
        <p className="text-4xl">📋</p>
        <p className="mt-3 text-base font-medium text-gray-400">No activity yet</p>
        <p className="mt-1 text-sm text-gray-600">
          Submit a form on the other tabs — every request is logged here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">
          Activity Logs{" "}
          <span className="ml-2 text-sm font-normal text-gray-500">({logs.length})</span>
        </h2>
        <p className="text-xs text-gray-500">
          Full logs also printed to server terminal
        </p>
      </div>
      {logs.map((log) => (
        <LogRow key={log.id} log={log} />
      ))}
    </div>
  );
}
