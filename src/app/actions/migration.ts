"use server";

import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

function getSupabase() {
  const url = env.supabaseUrl;
  const key = env.supabaseServiceRoleKey;
  if (!url || !key) return null;
  return createClient(url, key);
}

function terrosBase() {
  return (env.terrosApiBaseUrl ?? "https://api.terros.com").replace(/\/$/, "");
}

function terrosHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `ApiKey ${env.terrosApiKey ?? ""}`,
  };
}

function terrosSuccess(text: string): boolean {
  try {
    const j = JSON.parse(text) as Record<string, unknown>;
    if (j.type === "error") return false;
  } catch { /* non-JSON 2xx — treat as success */ }
  return true;
}

/** Fetch accounts from Terros account/list. Documented params: size, nearby, searchInput. No page param. */
export async function fetchAccountListPage(
  size = 100,
  searchInput?: Record<string, unknown>,
): Promise<{ ids: string[]; raw: Record<string, unknown>[]; apiTotal: number | null }> {
  const base = terrosBase();
  const headers = terrosHeaders();
  try {
    const body: Record<string, unknown> = { size };
    if (searchInput) body.searchInput = searchInput;
    const res = await fetch(`${base}/account/list`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) return { ids: [], raw: [], apiTotal: null };
    const text = await res.text();
    if (!terrosSuccess(text)) return { ids: [], raw: [], apiTotal: null };
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const rows = (
      parsed.accounts ?? parsed.data ?? parsed.results ?? parsed.items
    ) as Record<string, unknown>[] | undefined;
    if (!Array.isArray(rows)) return { ids: [], raw: [], apiTotal: null };
    const ids = rows
      .map((r) => String(r.accountId ?? r.id ?? "").trim())
      .filter(Boolean);
    const apiTotal =
      typeof parsed.total === "number" ? parsed.total :
      typeof parsed.count === "number" ? parsed.count :
      typeof parsed.totalCount === "number" ? parsed.totalCount :
      typeof parsed.totalResults === "number" ? parsed.totalResults :
      null;
    return { ids, raw: rows, apiTotal };
  } catch {
    return { ids: [], raw: [], apiTotal: null };
  }
}

/** Fetch full account data via account/get */
export async function fetchFullAccount(
  accountId: string,
): Promise<Record<string, unknown> | null> {
  const base = terrosBase();
  const headers = terrosHeaders();
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 15_000); // 15s timeout — prevents hung requests from freezing export
  try {
    const res = await fetch(`${base}/account/get`, {
      method: "POST",
      headers,
      body: JSON.stringify({ accountId }),
      signal: abort.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const text = await res.text();
    if (!terrosSuccess(text)) return null;
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const acc = parsed.account as Record<string, unknown> | undefined;
    return acc ?? null;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

// ── Debug: raw account/get response ────────────────────────────────────────

export type DebugAccountResult = {
  accountId: string;
  attempts: { body: string; status: number; ok: boolean; raw: string }[];
  parsed: Record<string, unknown> | null;
  error?: string;
};

/**
 * Returns the raw HTTP response from every account/get body variant for one account.
 * Use this to diagnose what fields Terros actually returns.
 */
export async function debugAccount(accountId: string): Promise<DebugAccountResult> {
  const base = terrosBase();
  const headers = terrosHeaders();
  const attempts: DebugAccountResult["attempts"] = [];

  let parsed: Record<string, unknown> | null = null;

  try {
    const body = { accountId };
    const res = await fetch(`${base}/account/get`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const text = await res.text();
    attempts.push({
      body: JSON.stringify(body),
      status: res.status,
      ok: res.ok,
      raw: text.slice(0, 8000),
    });

    if (res.ok && terrosSuccess(text)) {
      try {
        const j = JSON.parse(text) as Record<string, unknown>;
        parsed = (j.account as Record<string, unknown> | undefined) ?? null;
      } catch { /* ignore */ }
    }
  } catch (e) {
    attempts.push({
      body: JSON.stringify({ accountId }),
      status: 0,
      ok: false,
      raw: e instanceof Error ? e.message : String(e),
    });
  }

  return { accountId, attempts, parsed };
}

// ── Test Export ─────────────────────────────────────────────────────────────

export type TestExportResult = {
  accounts: Record<string, unknown>[];
  totalIds: number;
  error?: string;
};

/**
 * Fetch a small sample of accounts (no Supabase write).
 * Used to validate the data structure before committing to a full export.
 */
export async function testExport(limit = 10): Promise<TestExportResult> {
  try {
    // account/list has no pagination — just use size param (max 1000)
    const firstPage = await fetchAccountListPage(Math.max(limit, 100));
    if (firstPage.ids.length === 0) {
      return { accounts: [], totalIds: 0, error: "No accounts returned from Terros. Check API key." };
    }

    const totalIds = firstPage.apiTotal ?? firstPage.ids.length;

    const sample = firstPage.ids.slice(0, limit);
    const accounts: Record<string, unknown>[] = [];
    for (const id of sample) {
      const acc = await fetchFullAccount(id);
      if (acc) accounts.push(acc);
    }

    return { accounts, totalIds };
  } catch (e) {
    return {
      accounts: [],
      totalIds: 0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// ── Filter Test ─────────────────────────────────────────────────────────────

export type FilterTestResult = {
  unfiltered: number;
  userId: { id: string; total: number; newIds: number; raw: string } | null;
  stageId: { stageId: string; total: number; newIds: number; raw: string } | null;
  zipCode: { zip: string; total: number; newIds: number; raw: string } | null;
  lastActionDate: { window: string; total: number; newIds: number; raw: string } | null;
  error?: string;
};

async function callListRaw(body: Record<string, unknown>): Promise<{ ids: string[]; rows: Record<string, unknown>[]; raw: string }> {
  const base = terrosBase();
  const headers = terrosHeaders();
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 10_000); // 10s timeout
  try {
    const res = await fetch(`${base}/account/list`, { method: "POST", headers, body: JSON.stringify(body), signal: abort.signal });
    clearTimeout(timer);
    const text = await res.text();
    const raw = text.slice(0, 600);
    if (!res.ok || !terrosSuccess(text)) return { ids: [], rows: [], raw };
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const rows = (parsed.accounts ?? parsed.data ?? parsed.results ?? parsed.items ?? []) as Record<string, unknown>[];
    const ids = rows.map(r => String(r.accountId ?? r.id ?? "").trim()).filter(Boolean);
    return { ids, rows, raw };
  } catch (e) {
    clearTimeout(timer);
    return { ids: [], rows: [], raw: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Tests whether each searchInput filter actually returns DIFFERENT accounts.
 * Also returns the raw API response for debugging when filters return 0.
 */
export async function testFilters(overrideZip?: string): Promise<FilterTestResult> {
  try {
    // Step 1: unfiltered baseline
    const { ids: baseIds, rows: baseRows } = await callListRaw({ size: 1000 });
    const baseSet = new Set(baseIds);

    // Step 2: pick first user from user/list (single call, no loop)
    let userResult: FilterTestResult["userId"] = null;
    try {
      const uAbort = new AbortController();
      const uTimer = setTimeout(() => uAbort.abort(), 10_000);
      const uRes = await fetch(`${terrosBase()}/user/list`, {
        method: "POST", headers: terrosHeaders(), body: JSON.stringify({ size: 1 }), signal: uAbort.signal,
      });
      clearTimeout(uTimer);
      const uText = await uRes.text();
      const uParsed = JSON.parse(uText) as Record<string, unknown>;
      const users = (uParsed.users ?? uParsed.data ?? []) as Record<string, unknown>[];
      const firstUser = users[0];
      const userId = firstUser ? String(firstUser.userId ?? firstUser.id ?? "").trim() : "";
      if (userId) {
        const { ids, raw } = await callListRaw({ size: 100, searchInput: { userId } });
        const newIds = ids.filter(id => !baseSet.has(id)).length;
        userResult = { id: userId, total: ids.length, newIds, raw };
      }
    } catch { /* skip */ }

    // Step 2b: stageIds filter — extract a stage from baseline rows and test it
    let stageResult: { stageId: string; total: number; newIds: number; raw: string } | null = null;
    for (const r of baseRows) {
      const stageId = String(r.workflowStageId ?? r.stageId ?? "").trim();
      if (stageId) {
        const { ids, raw } = await callListRaw({ size: 100, searchInput: { stageIds: [stageId] } });
        const newIds = ids.filter(id => !baseSet.has(id)).length;
        stageResult = { stageId, total: ids.length, newIds, raw };
        break;
      }
    }

    // Step 3: zip code filter — use override if provided, else extract from baseline rows
    let zipResult: FilterTestResult["zipCode"] = null;
    const zipToTest = overrideZip?.trim() ||
      (() => {
        for (const r of baseRows) {
          const loc = (r.location ?? r.address) as Record<string, unknown> | undefined;
          const zip = String(loc?.postal1 ?? loc?.zip ?? loc?.postalCode ?? r.zipCode ?? "").trim().slice(0, 5);
          if (zip && /^\d{5}$/.test(zip)) return zip;
        }
        return "";
      })();

    if (zipToTest) {
      const { ids, raw } = await callListRaw({ size: 100, searchInput: { zipCodes: [zipToTest] } });
      const newIds = ids.filter(id => !baseSet.has(id)).length;
      zipResult = { zip: zipToTest, total: ids.length, newIds, raw };
    } else {
      zipResult = { zip: "none", total: 0, newIds: 0, raw: "No zip found in account/list rows — try entering one manually" };
    }

    // Step 4: lastActionDate — single call, all time (gte: 0)
    const now = Date.now();
    const { ids: dateIds, raw: dateRaw } = await callListRaw({
      size: 100,
      searchInput: { lastActionDate: { gte: 0, lte: now } },
    });
    const dateNewIds = dateIds.filter(id => !baseSet.has(id)).length;
    const dateResult: FilterTestResult["lastActionDate"] = {
      window: "all time (gte: 0)",
      total: dateIds.length,
      newIds: dateNewIds,
      raw: dateRaw,
    };

    return {
      unfiltered: baseIds.length,
      userId: userResult,
      stageId: stageResult,
      zipCode: zipResult,
      lastActionDate: dateResult,
    };
  } catch (e) {
    return {
      unfiltered: 0,
      userId: null,
      stageId: null,
      zipCode: null,
      lastActionDate: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// ── Export Status ───────────────────────────────────────────────────────────

export type ExportStatusResult = {
  total: number;
  exported: number;
  restored: number;
  failed: number;
  error?: string;
};

export async function getExportStatus(): Promise<ExportStatusResult> {
  const supabase = getSupabase();
  if (!supabase) {
    return { total: 0, exported: 0, restored: 0, failed: 0, error: "Supabase not configured" };
  }
  try {
    const { data, error } = await supabase
      .from("terros_account_snapshots")
      .select("status");
    if (error) {
      return { total: 0, exported: 0, restored: 0, failed: 0, error: error.message };
    }
    const rows = data ?? [];
    return {
      total: rows.length,
      exported: rows.filter((r) => r.status === "exported").length,
      restored: rows.filter((r) => r.status === "restored").length,
      failed: rows.filter((r) => r.status === "failed").length,
    };
  } catch (e) {
    return {
      total: 0,
      exported: 0,
      restored: 0,
      failed: 0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
