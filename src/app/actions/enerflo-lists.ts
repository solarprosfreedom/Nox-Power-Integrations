"use server";

import { enerfloRequestParsed } from "@/lib/enerflo/client";

export type EnerfloListPage = {
  success: boolean;
  error?: string;
  total: number;
  page: number;
  pageSize: number;
  rows: Record<string, unknown>[];
};

function normalizeListPayload(data: unknown): { total: number; rows: Record<string, unknown>[] } {
  if (!data) return { total: 0, rows: [] };
  if (Array.isArray(data)) {
    return { total: data.length, rows: data as Record<string, unknown>[] };
  }
  if (typeof data !== "object") return { total: 0, rows: [] };
  const o = data as Record<string, unknown>;
  // Check array-valued keys first; some responses have a non-array `data` object
  const candidates = [
    o.results, o.items, o.customers, o.users,
    o.surveys, o.installs, o.install_reports, o.leads, o.deals,
    // `data` last — surveys response has data: { solar_data_panel_count: 0 } (not an array)
    o.data,
  ];
  const raw = candidates.find((c) => Array.isArray(c));
  if (!Array.isArray(raw)) return { total: 0, rows: [] };
  const total =
    typeof o.total === "number"
      ? o.total
      : typeof o.dataCount === "number"
        ? o.dataCount
        : typeof o.count === "number"
          ? o.count
          : typeof o.totalCount === "number"
            ? o.totalCount
            : raw.length;
  return { total, rows: raw as Record<string, unknown>[] };
}

// ── Users ─────────────────────────────────────────────────────────────────
export async function fetchEnerfloUsersPage(input: {
  page: number;
  pageSize: number;
  companyId?: string;
  userRole?: string;
}): Promise<EnerfloListPage> {
  const page = Math.max(1, Math.floor(input.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Math.floor(input.pageSize) || 25));

  const query: Record<string, string> = { page: String(page), pageSize: String(pageSize) };
  const cid = input.companyId?.trim();
  const role = input.userRole?.trim();
  if (cid) query.company_id = cid;
  if (role) query.user_role = role;

  const { ok, status, data, parseError, log } = await enerfloRequestParsed<unknown>({
    operation: "list_users_page",
    method: "GET",
    path: "/api/v3/users",
    query,
  });

  if (!ok) {
    return {
      success: false,
      error: log.fetchError ?? `HTTP ${status ?? "?"} — ${parseError ?? "Request failed"}`,
      total: 0, page, pageSize, rows: [],
    };
  }

  const { total, rows } = normalizeListPayload(data);
  return { success: true, total, page, pageSize, rows };
}

// ── Customers ─────────────────────────────────────────────────────────────
export async function fetchEnerfloCustomersPage(input: {
  page: number;
  pageSize: number;
  search?: string;
}): Promise<EnerfloListPage> {
  const page = Math.max(1, Math.floor(input.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Math.floor(input.pageSize) || 25));

  const query: Record<string, string> = { page: String(page), pageSize: String(pageSize) };
  const q = input.search?.trim();
  if (q) query.search = q;

  const { ok, status, data, parseError, log } = await enerfloRequestParsed<unknown>({
    operation: "list_customers_page",
    method: "GET",
    path: "/api/v1/customers",
    query,
  });

  if (!ok) {
    return {
      success: false,
      error: log.fetchError ?? `HTTP ${status ?? "?"} — ${parseError ?? "Request failed"}`,
      total: 0, page, pageSize, rows: [],
    };
  }

  const { total, rows } = normalizeListPayload(data);
  return { success: true, total, page, pageSize, rows };
}

// ── Leads (survey / door-knock entries) ───────────────────────────────────
export async function fetchEnerfloLeadsPage(input: {
  page: number;
  pageSize: number;
  search?: string;
  status?: string;
}): Promise<EnerfloListPage> {
  const page = Math.max(1, Math.floor(input.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Math.floor(input.pageSize) || 25));

  const query: Record<string, string> = { page: String(page), pageSize: String(pageSize) };
  if (input.search?.trim()) query.search = input.search.trim();
  if (input.status?.trim()) query.status = input.status.trim();

  const { ok, status, data, parseError, log } = await enerfloRequestParsed<unknown>({
    operation: "list_leads_page",
    method: "GET",
    path: "/api/v3/surveys",
    query,
  });

  if (!ok) {
    return {
      success: false,
      error: log.fetchError ?? `HTTP ${status ?? "?"} — ${parseError ?? "Request failed"}`,
      total: 0, page, pageSize, rows: [],
    };
  }

  const { total, rows } = normalizeListPayload(data);
  return { success: true, total, page, pageSize, rows };
}

// ── Deals (signed proposals — installs endpoint) ──────────────────────────
export async function fetchEnerfloDealsPage(input: {
  page: number;
  pageSize: number;
  search?: string;
  status?: string;
}): Promise<EnerfloListPage> {
  const page = Math.max(1, Math.floor(input.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Math.floor(input.pageSize) || 25));

  const query: Record<string, string> = { page: String(page), pageSize: String(pageSize) };
  if (input.search?.trim()) query.search = input.search.trim();
  if (input.status?.trim()) query.status = input.status.trim();

  const { ok, status, data, parseError, log } = await enerfloRequestParsed<unknown>({
    operation: "list_deals_page",
    method: "GET",
    path: "/api/v3/installs",
    query,
  });

  if (!ok) {
    return {
      success: false,
      error: log.fetchError ?? `HTTP ${status ?? "?"} — ${parseError ?? "Request failed"}`,
      total: 0, page, pageSize, rows: [],
    };
  }

  const { total, rows } = normalizeListPayload(data);
  return { success: true, total, page, pageSize, rows };
}

// ── Installs (all installations) ──────────────────────────────────────────
export async function fetchEnerfloInstallsPage(input: {
  page: number;
  pageSize: number;
  search?: string;
  status?: string;
}): Promise<EnerfloListPage> {
  const page = Math.max(1, Math.floor(input.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Math.floor(input.pageSize) || 25));

  const query: Record<string, string> = { page: String(page), pageSize: String(pageSize) };
  if (input.search?.trim()) query.search = input.search.trim();
  if (input.status?.trim()) query.status = input.status.trim();

  const { ok, status, data, parseError, log } = await enerfloRequestParsed<unknown>({
    operation: "list_installs_page",
    method: "GET",
    path: "/api/v3/install-reports",
    query,
  });

  if (!ok) {
    return {
      success: false,
      error: log.fetchError ?? `HTTP ${status ?? "?"} — ${parseError ?? "Request failed"}`,
      total: 0, page, pageSize, rows: [],
    };
  }

  const { total, rows } = normalizeListPayload(data);
  return { success: true, total, page, pageSize, rows };
}
