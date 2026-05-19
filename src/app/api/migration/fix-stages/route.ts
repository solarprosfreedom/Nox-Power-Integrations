import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

export const maxDuration = 300;

const KNOCK_STAGE_ID = "S.hikCFaEFik5aADZDym2ee";

function getSupabase() {
  const url = env.supabaseUrl;
  const key = env.supabaseServiceRoleKey;
  if (!url || !key) return null;
  return createClient(url, key);
}

function terrosBase() {
  return (env.terrosApiBaseUrl ?? "https://api.terros.com").replace(/\/$/, "");
}

function terrosSuccess(text: string): boolean {
  try {
    const j = JSON.parse(text) as Record<string, unknown>;
    if (j.type === "error") return false;
  } catch { /* non-JSON 2xx */ }
  return true;
}

async function batchedMap<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency);
    const chunkResults = await Promise.all(chunk.map(fn));
    results.push(...chunkResults);
  }
  return results;
}

export async function POST() {
  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const base = terrosBase();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `ApiKey ${env.terrosApiKey ?? ""}`,
  };

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      };

      try {
        send({ type: "phase", message: "Loading restored rows from Supabase…" });

        // Paginate through all 'restored' rows
        const allRows: Record<string, unknown>[] = [];
        const PAGE = 1000;
        let from = 0;
        while (true) {
          const { data, error } = await supabase
            .from("terros_account_snapshots")
            .select("*")
            .eq("status", "restored")
            .range(from, from + PAGE - 1);

          if (error) {
            send({ type: "error", message: error.message });
            controller.close();
            return;
          }
          if (!data || data.length === 0) break;
          allRows.push(...data);
          if (data.length < PAGE) break;
          from += PAGE;
        }

        const total = allRows.length;
        if (total === 0) {
          send({ type: "error", message: "No restored rows found. Run restore first." });
          controller.close();
          return;
        }

        send({ type: "phase", message: `Fixing stages for ${total} accounts…`, total });

        let done = 0;
        let fixed = 0;
        let failed = 0;
        let skipped = 0;

        await batchedMap(allRows, 5, async (row) => {
          try {
            // Get new Terros accountId from the restore_result
            const restoreResult = row.restore_result as Record<string, unknown> | undefined;
            const newAccountId = (restoreResult?.account as Record<string, unknown> | undefined)?.accountId as string | undefined;

            if (!newAccountId) {
              skipped++;
              send({ type: "progress", done: ++done, total, fixed, failed, skipped, note: "no new accountId in restore_result" });
              return;
            }

            // Use original stage from snapshot, fall back to Knock
            const snapshot = row.snapshot as Record<string, unknown> | undefined;
            const originalStageId = (snapshot?.workflowStageId as string | undefined) || KNOCK_STAGE_ID;

            const abort = new AbortController();
            const timer = setTimeout(() => abort.abort(), 15_000);
            const res = await fetch(`${base}/account/update`, {
              method: "POST",
              headers,
              body: JSON.stringify({
                account: {
                  accountId: newAccountId,
                  id: newAccountId,
                  workflowStageId: originalStageId,
                },
              }),
              signal: abort.signal,
            });
            clearTimeout(timer);

            const text = await res.text();
            const ok = res.ok && terrosSuccess(text);

            if (ok) {
              fixed++;
              // Update Supabase to mark stage as fixed
              await supabase
                .from("terros_account_snapshots")
                .update({ restore_result: { ...(row.restore_result as object), stage_fixed: true, new_account_id: newAccountId } })
                .eq("account_id", row.account_id as string);
            } else {
              failed++;
              let errMsg = text.slice(0, 200);
              try { errMsg = (JSON.parse(text) as Record<string, unknown>).message as string || errMsg; } catch { /* ignore */ }
              send({ type: "progress", done: ++done, total, fixed, failed, skipped, error: errMsg });
              return;
            }

            send({ type: "progress", done: ++done, total, fixed, failed, skipped });
          } catch (e) {
            failed++;
            send({ type: "progress", done: ++done, total, fixed, failed, skipped, error: e instanceof Error ? e.message : String(e) });
          }
        });

        send({ type: "complete", done: total, total, fixed, failed, skipped });
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
