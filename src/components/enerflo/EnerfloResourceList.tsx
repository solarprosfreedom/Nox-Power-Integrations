"use client";

import { useEffect, useState, useTransition } from "react";
import type { EnerfloListPage } from "@/app/actions/enerflo-lists";

// ── Column definitions ────────────────────────────────────────────────────

type Column = {
  key: string;
  label: string;
  render?: (row: Record<string, unknown>) => string;
};

// Resolves dot-path like "customer.city" from a nested object
function getPath(obj: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((cur, k) => {
    if (cur && typeof cur === "object") return (cur as Record<string, unknown>)[k];
    return undefined;
  }, obj);
}

function cellValue(row: Record<string, unknown>, key: string): string {
  // Support dot-path notation for nested fields
  const v = key.includes(".") ? getPath(row, key) : row[key];
  if (v == null || v === "") return "—";
  if (Array.isArray(v)) return v.map(String).join(", ");
  if (typeof v === "object") return JSON.stringify(v).slice(0, 80);
  // Shorten ISO timestamps to just date+time without timezone
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(s)) {
    return s.replace("T", " ").replace(/\+\d{2}:\d{2}$/, "").slice(0, 16);
  }
  return s;
}

// ── Users ─────────────────────────────────────────────────────────────────
export const USER_COLUMNS: Column[] = [
  { key: "id",         label: "ID" },
  { key: "name",       label: "Name" },
  { key: "email",      label: "Email" },
  { key: "roles",      label: "Roles", render: (r) => cellValue(r, "roles") },
  { key: "company_id", label: "Company" },
  { key: "phone",      label: "Phone" },
];

// ── Customers ─────────────────────────────────────────────────────────────
export const CUSTOMER_COLUMNS: Column[] = [
  { key: "id",         label: "ID" },
  { key: "first_name", label: "First" },
  { key: "last_name",  label: "Last" },
  { key: "email",      label: "Email" },
  { key: "phone",      label: "Phone" },
  { key: "city",       label: "City" },
  { key: "state",      label: "State" },
  { key: "zip",        label: "ZIP" },
];

// ── Leads (surveys) ───────────────────────────────────────────────────────
// The /api/v3/surveys response only has IDs at top level — customer
// contact info is NOT embedded in the survey payload.
export const LEAD_COLUMNS: Column[] = [
  { key: "id",              label: "Survey ID" },
  { key: "customer_id",     label: "Customer ID" },
  { key: "agent_user_id",   label: "Agent ID" },
  { key: "company_id",      label: "Company ID" },
  { key: "epc_company_id",  label: "EPC ID" },
  {
    key: "url_path",
    label: "Link",
    render: (r) => {
      const p = getPath(r, "url_path");
      return p ? `enerflo.io${p}` : "—";
    },
  },
  { key: "created_at", label: "Created" },
];

// ── Deals (installs — nested customer + epc_company) ──────────────────────
// Real shape: { id, customer: { name, address, city, state, email },
//               epc_company: { name }, company: { name }, created_at }
export const DEAL_COLUMNS: Column[] = [
  { key: "id",                  label: "ID" },
  {
    key: "customer.name",
    label: "Customer",
    render: (r) => cellValue(r, "customer.name"),
  },
  {
    key: "customer.address",
    label: "Address",
    render: (r) => cellValue(r, "customer.address"),
  },
  {
    key: "customer.city",
    label: "City",
    render: (r) => cellValue(r, "customer.city"),
  },
  {
    key: "customer.state",
    label: "State",
    render: (r) => cellValue(r, "customer.state"),
  },
  {
    key: "epc_company.name",
    label: "Installer",
    render: (r) => cellValue(r, "epc_company.name"),
  },
  {
    key: "company.name",
    label: "Sales Co.",
    render: (r) => cellValue(r, "company.name"),
  },
  { key: "created_at", label: "Created" },
];

// ── Installs (install reports) ────────────────────────────────────────────
export const INSTALL_COLUMNS: Column[] = [
  { key: "id",          label: "ID" },
  { key: "status",      label: "Status" },
  {
    key: "customer.name",
    label: "Customer",
    render: (r) => cellValue(r, "customer.name"),
  },
  {
    key: "customer.city",
    label: "City",
    render: (r) => cellValue(r, "customer.city"),
  },
  {
    key: "customer.state",
    label: "State",
    render: (r) => cellValue(r, "customer.state"),
  },
  {
    key: "epc_company.name",
    label: "Installer",
    render: (r) => cellValue(r, "epc_company.name"),
  },
  { key: "created_at", label: "Created" },
];

// ── Pagination helper ─────────────────────────────────────────────────────

function buildPageWindows(current: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | "…")[] = [1];
  const lo = Math.max(2, current - 2);
  const hi = Math.min(total - 1, current + 2);
  if (lo > 2) pages.push("…");
  for (let p = lo; p <= hi; p++) pages.push(p);
  if (hi < total - 1) pages.push("…");
  pages.push(total);
  return pages;
}

// ── Types ─────────────────────────────────────────────────────────────────

type FetchArgs = {
  page: number;
  pageSize: number;
  companyId?: string;
  userRole?: string;
  search?: string;
  status?: string;
};

type Fetcher = (args: FetchArgs) => Promise<EnerfloListPage>;

type FilterMode = "users" | "customers" | "leads" | "deals" | "installs";

interface Props {
  title: string;
  description: string;
  columns: Column[];
  fetchPage: Fetcher;
  filterMode?: FilterMode;
}

// ── Component ─────────────────────────────────────────────────────────────

export default function EnerfloResourceList({
  title,
  description,
  columns,
  fetchPage,
  filterMode,
}: Props) {
  const [page, setPage]               = useState(1);
  const [pageSize, setPageSize]       = useState(25);
  const [data, setData]               = useState<EnerfloListPage | null>(null);
  const [companyId, setCompanyId]     = useState("");
  const [userRole, setUserRole]       = useState("");
  const [search, setSearch]           = useState("");
  const [statusFilter, setStatus]     = useState("");
  const [reloadNonce, setReloadNonce] = useState(0);
  const [isPending, startTransition]  = useTransition();

  useEffect(() => {
    let cancelled = false;
    startTransition(async () => {
      const res = await fetchPage({
        page,
        pageSize,
        companyId: companyId.trim() || undefined,
        userRole:  userRole.trim()  || undefined,
        search:    search.trim()    || undefined,
        status:    statusFilter.trim() || undefined,
      });
      if (!cancelled) setData(res);
    });
    return () => { cancelled = true; };
  }, [page, pageSize, companyId, userRole, search, statusFilter, filterMode, reloadNonce, fetchPage]);

  const totalPages = data?.success ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;
  const pageWindows = buildPageWindows(page, totalPages);

  const hasSearch   = filterMode !== "users";
  const hasCompany  = filterMode === "users";
  const hasRole     = filterMode === "users";
  const hasStatus   = filterMode === "leads" || filterMode === "deals" || filterMode === "installs";

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/40 overflow-hidden">

      {/* ── Header + filters ── */}
      <div className="border-b border-gray-800 px-5 py-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-white">{title}</h3>
          <p className="text-sm text-gray-500 mt-1 max-w-2xl">{description}</p>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          {hasSearch && (
            <label className="flex flex-col gap-1 text-xs text-gray-500">
              Search
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { setPage(1); setReloadNonce((n) => n + 1); }}}
                placeholder="name, email…"
                className="w-44 rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-sm text-white placeholder:text-gray-600"
              />
            </label>
          )}
          {hasStatus && (
            <label className="flex flex-col gap-1 text-xs text-gray-500">
              Status
              <input
                value={statusFilter}
                onChange={(e) => setStatus(e.target.value)}
                placeholder="optional"
                className="w-28 rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-sm text-white placeholder:text-gray-600"
              />
            </label>
          )}
          {hasCompany && (
            <label className="flex flex-col gap-1 text-xs text-gray-500">
              Company ID
              <input
                value={companyId}
                onChange={(e) => setCompanyId(e.target.value)}
                placeholder="optional"
                className="w-28 rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-sm text-white placeholder:text-gray-600"
              />
            </label>
          )}
          {hasRole && (
            <label className="flex flex-col gap-1 text-xs text-gray-500">
              Role
              <input
                value={userRole}
                onChange={(e) => setUserRole(e.target.value)}
                placeholder="e.g. agent"
                className="w-28 rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-sm text-white placeholder:text-gray-600"
              />
            </label>
          )}
          <button
            type="button"
            onClick={() => { setPage(1); setReloadNonce((n) => n + 1); }}
            disabled={isPending}
            className="self-end rounded-lg bg-orange-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-orange-500 disabled:opacity-50"
          >
            Apply
          </button>
          <button
            type="button"
            onClick={() => setReloadNonce((n) => n + 1)}
            disabled={isPending}
            className="self-end rounded-lg border border-gray-600 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-800 disabled:opacity-50"
          >
            ↺ Reload
          </button>
        </div>
      </div>

      {/* ── Error banner ── */}
      {data && !data.success && (
        <div className="mx-5 my-4 rounded-lg border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-200">
          {data.error ?? "Failed to load"}
        </div>
      )}

      {/* ── Table ── */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="border-b border-gray-800 bg-gray-950/80 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              {columns.map((c) => (
                <th key={c.key} className="px-4 py-3 font-medium whitespace-nowrap">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/80">
            {isPending && !data?.rows?.length ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-10 text-center text-gray-500">
                  Loading…
                </td>
              </tr>
            ) : data?.rows?.length ? (
              data.rows.map((row, i) => {
                const rk = String(row.id ?? row.customer_id ?? i);
                return (
                  <tr key={rk} className={`text-gray-300 hover:bg-gray-800/30 ${isPending ? "opacity-50" : ""}`}>
                    {columns.map((c) => (
                      <td key={c.key} className="px-4 py-2.5 whitespace-nowrap max-w-[220px] truncate">
                        {c.render ? c.render(row) : cellValue(row, c.key)}
                      </td>
                    ))}
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={columns.length} className="px-4 py-10 text-center text-gray-500">
                  {data?.success ? "No records on this page." : "—"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Pagination footer ── */}
      <div className="border-t border-gray-800 px-5 py-3 flex flex-wrap items-center justify-between gap-3">

        {/* Left: total count */}
        <span className="text-sm text-gray-500">
          {data?.success ? (
            <>
              <span className="text-white font-mono">{data.total}</span> total
              {data.total > 0 && (
                <span className="ml-2 text-gray-600">
                  (showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, data.total)})
                </span>
              )}
            </>
          ) : "—"}
        </span>

        {/* Centre: page buttons */}
        <div className="flex items-center gap-1">
          {/* Prev */}
          <button
            type="button"
            disabled={isPending || page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded border border-gray-700 px-2.5 py-1 text-xs text-gray-300 hover:bg-gray-800 disabled:opacity-40"
          >
            ←
          </button>

          {/* Numbered pages */}
          {pageWindows.map((w, i) =>
            w === "…" ? (
              <span key={`ellipsis-${i}`} className="px-1 text-xs text-gray-600 select-none">…</span>
            ) : (
              <button
                key={w}
                type="button"
                disabled={isPending}
                onClick={() => setPage(w)}
                className={`rounded border px-2.5 py-1 text-xs transition-colors
                  ${w === page
                    ? "border-orange-600 bg-orange-600/20 text-orange-300 font-semibold"
                    : "border-gray-700 text-gray-400 hover:bg-gray-800 hover:text-gray-200"
                  }`}
              >
                {w}
              </button>
            )
          )}

          {/* Next */}
          <button
            type="button"
            disabled={isPending || page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="rounded border border-gray-700 px-2.5 py-1 text-xs text-gray-300 hover:bg-gray-800 disabled:opacity-40"
          >
            →
          </button>
        </div>

        {/* Right: per page */}
        <label className="flex items-center gap-2 text-xs text-gray-500">
          Per page
          <select
            value={pageSize}
            onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
            className="rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-white"
          >
            {[10, 25, 50, 100].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
