import type { ApiLog } from "@/lib/logger";

interface Props {
  log: ApiLog | null;
}

export default function ResultBanner({ log }: Props) {
  if (!log) return null;

  const isOk = log.ok;
  const color = isOk
    ? "border-green-700 bg-green-900/30 text-green-300"
    : "border-red-700 bg-red-900/30 text-red-300";

  return (
    <div className={`mt-6 rounded-lg border px-4 py-3 text-sm ${color}`}>
      <div className="flex items-center gap-2 font-semibold">
        {isOk ? "✓ Success" : "✗ Request sent (check logs)"}
        {log.status && (
          <span className="rounded bg-black/20 px-2 py-0.5 text-xs font-mono">
            HTTP {log.status} {log.statusText}
          </span>
        )}
        {!log.hadApiKey && (
          <span className="rounded bg-yellow-900/40 px-2 py-0.5 text-xs text-yellow-400">
            No API key
          </span>
        )}
      </div>
      {log.fetchError && (
        <p className="mt-1 text-xs opacity-75">{log.fetchError}</p>
      )}
      <p className="mt-1 text-xs opacity-60 break-all">{log.url}</p>
    </div>
  );
}
