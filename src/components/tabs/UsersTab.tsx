"use client";

import { useState } from "react";
import { previewUsers } from "@/app/actions/sync";
import type { UserRow } from "@/lib/sync/preview";

function exportCsv(rows: UserRow[], filename: string, includeStatus: boolean) {
  const headers = includeStatus ? ["Name", "Email", "Role", "Status"] : ["Name", "Email", "Role"];
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines = [
    headers.join(","),
    ...rows.map(r =>
      [
        escape(r.name || ""),
        escape(r.email),
        escape(r.role || ""),
        ...(includeStatus ? [escape(r.status || "")] : []),
      ].join(",")
    ),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function TableShell({
  title,
  dot,
  count,
  headers,
  onExport,
  children,
}: {
  title: string;
  dot: string;
  count: number;
  headers: string[];
  onExport?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
      <div className="flex items-center justify-between gap-4 px-5 py-3.5 border-b border-gray-800">
        <div className="flex items-center gap-2.5">
          <span className={`h-2.5 w-2.5 rounded-full flex-shrink-0 ${dot}`} />
          <span className="font-semibold text-white text-sm">{title}</span>
          <span className="rounded-full bg-gray-800 px-2 py-0.5 text-xs text-gray-400">
            {count} users
          </span>
        </div>
        {count > 0 && onExport && (
          <button
            onClick={onExport}
            className="flex items-center gap-1.5 rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
            Export CSV
          </button>
        )}
      </div>
      {count === 0 ? (
        <p className="px-5 py-4 text-sm text-gray-500">No users missing.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-left text-xs text-gray-500 uppercase tracking-wide">
                {headers.map((h) => (
                  <th key={h} className="px-4 py-2.5 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/60">{children}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status?: string }) {
  if (!status) return null;
  const isInactive = status.toLowerCase() === "inactive";
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
      isInactive
        ? "bg-gray-800 text-gray-500"
        : "bg-emerald-900/50 text-emerald-300"
    }`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function UserTable({
  title,
  dot,
  rows,
  showStatus = false,
  filename,
}: {
  title: string;
  dot: string;
  rows: UserRow[];
  showStatus?: boolean;
  filename: string;
}) {
  const headers = showStatus ? ["Name", "Email", "Role", "Status"] : ["Name", "Email", "Role"];
  return (
    <TableShell
      title={title}
      dot={dot}
      count={rows.length}
      headers={headers}
      onExport={() => exportCsv(rows, filename, showStatus)}
    >
      {rows.map((row, i) => (
        <tr
          key={`${i}-${row.email}`}
          className={`hover:bg-gray-800/40 transition-colors ${
            row.status?.toLowerCase() === "inactive" ? "opacity-60" : ""
          }`}
        >
          <td className="px-4 py-3 text-gray-200 whitespace-nowrap">{row.name || "—"}</td>
          <td className="px-4 py-3 text-gray-400 whitespace-nowrap">{row.email}</td>
          <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{row.role || "—"}</td>
          {showStatus && (
            <td className="px-4 py-3 whitespace-nowrap">
              <StatusBadge status={row.status} />
            </td>
          )}
        </tr>
      ))}
    </TableShell>
  );
}

export default function UsersTab() {
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [e2tRows, setE2tRows] = useState<UserRow[]>([]);
  const [t2eRows, setT2eRows] = useState<UserRow[]>([]);
  const [errors, setErrors] = useState<string[]>([]);

  async function loadPreview() {
    setLoading(true);
    setErrors([]);
    try {
      const result = await previewUsers();
      if ("fetchError" in result && result.fetchError) {
        setErrors([result.fetchError]);
      } else {
        setE2tRows(result.enerfloToTerros);
        setT2eRows(result.terrosToEnerflo);
        if (result.errors.length > 0) setErrors(result.errors);
        setLoaded(true);
      }
    } catch (e) {
      setErrors([e instanceof Error ? e.message : String(e)]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Users Comparison</h2>
          <p className="text-sm text-gray-400 mt-0.5">
            Read-only view — shows which users are missing in each system (matched by email).
          </p>
        </div>
        <button
          onClick={loadPreview}
          disabled={loading}
          className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? (
            <>
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Loading…
            </>
          ) : (
            "Load Preview"
          )}
        </button>
      </div>

      {errors.length > 0 && (
        <div className="rounded-lg border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-300 space-y-1">
          {errors.map((e, i) => (
            <p key={i}>{e}</p>
          ))}
        </div>
      )}

      {loaded && (
        <div className="space-y-6">
          <UserTable
            title="In Enerflo — missing from Terros"
            dot="bg-blue-400"
            rows={e2tRows}
            showStatus
            filename="enerflo-missing-from-terros.csv"
          />
          <UserTable
            title="In Terros — missing from Enerflo"
            dot="bg-purple-400"
            rows={t2eRows}
            filename="terros-missing-from-enerflo.csv"
          />
        </div>
      )}
    </div>
  );
}
