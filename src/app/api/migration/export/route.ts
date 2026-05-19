import { NextResponse } from "next/server";

export const maxDuration = 300;

import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import { fetchFullAccount } from "@/app/actions/migration";

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
  return { "Content-Type": "application/json", Authorization: `ApiKey ${env.terrosApiKey ?? ""}` };
}
function terrosOk(text: string) {
  try { const j = JSON.parse(text) as Record<string, unknown>; if (j.type === "error") return false; } catch { /* ok */ }
  return true;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function batchedMap<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    results.push(...await Promise.all(items.slice(i, i + concurrency).map(fn)));
    if (i + concurrency < items.length) await sleep(300);
  }
  return results;
}

type ListRow = Record<string, unknown>;

/** Fetch all workflow stage IDs from workflow/list */
async function fetchAllStageIds(): Promise<{ id: string; name: string }[]> {
  const base = terrosBase();
  const headers = terrosHeaders();
  try {
    const res = await fetch(`${base}/workflow/list`, {
      method: "POST", headers, body: JSON.stringify({ size: 100 }),
    });
    if (!res.ok) return [];
    const text = await res.text();
    if (!terrosOk(text)) return [];
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const workflows = (parsed.workflows ?? []) as Record<string, unknown>[];
    const stages: { id: string; name: string }[] = [];
    for (const wf of workflows) {
      for (const s of (wf.stages ?? []) as Record<string, unknown>[]) {
        const id = String(s.stageId ?? s.id ?? "").trim();
        const name = String(s.name ?? s.label ?? id).trim();
        if (id) stages.push({ id, name });
      }
    }
    return stages;
  } catch { return []; }
}

/**
 * Paginate through all accounts in a stage using sortTimestamp cursor.
 * Confirmed: each page returns completely different accounts (0 overlap).
 * searchByCurrentStage: true ensures each account is counted in exactly one stage.
 */
async function* paginateStage(stageId: string): AsyncGenerator<string[]> {
  const base = terrosBase();
  const headers = terrosHeaders();
  let sortTimestamp: number | undefined;

  while (true) {
    const body: Record<string, unknown> = {
      size: 1000,
      searchInput: {
        stageIds: [stageId],
        searchByCurrentStage: true,
        sortBy: "lastActionDate",
        sortOrder: "asc",
        ...(sortTimestamp !== undefined ? { sortTimestamp } : {}),
      },
    };

    try {
      const res = await fetch(`${base}/account/list`, { method: "POST", headers, body: JSON.stringify(body) });
      if (!res.ok) break;
      const text = await res.text();
      if (!terrosOk(text)) break;
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const rows = (parsed.accounts ?? parsed.data ?? []) as ListRow[];
      if (!Array.isArray(rows) || rows.length === 0) break;

      const ids = rows.map(r => String(r.accountId ?? r.id ?? "").trim()).filter(Boolean);
      yield ids;

      if (rows.length < 1000) break;
      const nextCursor = rows[rows.length - 1]?.lastActionDate;
      if (typeof nextCursor !== "number") break;
      sortTimestamp = nextCursor;
      await sleep(200);
    } catch { break; }
  }
}

/**
 * Collect ALL unique account IDs.
 * Strategy: workflow/list → all stage IDs → paginate each with sortTimestamp cursor.
 * searchByCurrentStage: true ensures no duplicates across stages.
 * Reaches all ~10,283 accounts.
 */
async function collectAccountIds(
  onProgress: (n: number, label: string) => void,
): Promise<string[]> {
  const seen = new Set<string>();

  onProgress(0, "fetching workflow stages…");
  const stages = await fetchAllStageIds();
  onProgress(0, `${stages.length} stages found — paginating each…`);

  for (const stage of stages) {
    let page = 0;
    for await (const ids of paginateStage(stage.id)) {
      page++;
      const before = seen.size;
      ids.forEach(id => seen.add(id));
      const gained = seen.size - before;
      onProgress(seen.size, `${stage.name} p${page} → +${gained} new (total ${seen.size})`);
    }
  }

  return [...seen];
}

export async function POST() {
  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      };

      try {
        send({ type: "phase", message: "Collecting account IDs from Terros…" });

        const allIds = await collectAccountIds((n, label) => {
          send({ type: "list_progress", collected: n, label });
        });

        if (allIds.length === 0) {
          send({ type: "error", message: "No accounts found — check Terros API key." });
          controller.close();
          return;
        }

        send({ type: "phase", message: `Found ${allIds.length.toLocaleString()} accounts. Saving to Supabase…` });

        let done = 0;
        let failed = 0;

        await batchedMap(allIds, 2, async (accountId) => {
          try {
            const acc = await fetchFullAccount(accountId);
            if (!acc) {
              failed++;
              send({ type: "progress", done: ++done, total: allIds.length, failed, skipped: true });
              return;
            }

            const resident = acc.resident as Record<string, unknown> | undefined;
            const loc = (acc.location ?? acc.address) as Record<string, unknown> | undefined;
            const owner = acc.owner as Record<string, unknown> | undefined;

            const resName =
              String(resident?.name ?? "").trim() ||
              [resident?.firstName, resident?.lastName].filter(Boolean).join(" ").trim() ||
              String(acc.name ?? "").trim() || null;
            const resEmail = String(resident?.email ?? "").toLowerCase().trim() || null;
            const resPhone = String(resident?.phone ?? "").trim() || null;
            const locLine1 = String(loc?.line1 ?? "").trim();
            const locCity  = String(loc?.locality ?? "").trim();
            const locState = String(loc?.countrySubd ?? "").trim();
            const locZip   = String(loc?.postal1 ?? "").trim();
            const addressStr =
              String(loc?.oneLine ?? "").trim() ||
              [locLine1, locCity, locState, locZip].filter(Boolean).join(", ") || null;

            const row = {
              account_id:        String(acc.accountId ?? accountId),
              external_lead_id:  String(acc.externalLeadId ?? "").trim() || null,
              owner_id:          String(acc.ownerId ?? owner?.id ?? "").trim() || null,
              workflow_stage_id: String(acc.workflowStageId ?? "").trim() || null,
              name:              resName,
              email:             resEmail,
              phone:             resPhone,
              address:           addressStr,
              custom_fields:     (acc.customFields ?? null) as Record<string, unknown> | null,
              snapshot:          acc,
              source:            "account/get",
              exported_at:       new Date().toISOString(),
              status:            "exported",
            };

            const { error: insertError } = await supabase
              .from("terros_account_snapshots")
              .upsert(row, { onConflict: "account_id", ignoreDuplicates: false });

            if (insertError) {
              failed++;
              send({ type: "progress", done: ++done, total: allIds.length, failed, error: insertError.message });
            } else {
              send({ type: "progress", done: ++done, total: allIds.length, failed });
            }
          } catch (e) {
            failed++;
            send({ type: "progress", done: ++done, total: allIds.length, failed, error: e instanceof Error ? e.message : String(e) });
          }
        });

        send({ type: "complete", done: allIds.length, total: allIds.length, failed });
      } catch (e) {
        send({ type: "error", message: e instanceof Error ? e.message : String(e) });
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}
