import { NextResponse } from "next/server";

export const maxDuration = 300;
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

/** Cache for TLoc location data — avoids re-fetching the same location within a restore run */
const locationCache = new Map<string, Record<string, unknown>>();

/** Fetch full location data from Terros /location/get — cached by locationId */
async function fetchTlocLocation(
  base: string,
  headers: Record<string, string>,
  locationId: string,
): Promise<Record<string, unknown> | null> {
  if (locationCache.has(locationId)) return locationCache.get(locationId)!;
  try {
    const res = await fetch(`${base}/location/get`, {
      method: "POST",
      headers,
      body: JSON.stringify({ locationId }),
    });
    const data = await res.json() as Record<string, unknown>;
    const loc = data?.location as Record<string, unknown> | undefined;
    if (loc) locationCache.set(locationId, loc);
    return loc ?? null;
  } catch {
    return null;
  }
}

/** Build the account/add payload from a stored snapshot + optional pre-fetched location */
function buildRestorePayload(
  snapshot: Record<string, unknown>,
  tlocData?: Record<string, unknown> | null,
): Record<string, unknown> {
  // Prefer inline snapshot location → then TLoc data fetched from Terros
  const loc = (snapshot.location ?? snapshot.address ?? tlocData) as Record<string, unknown> | undefined;
  const res = snapshot.resident as Record<string, unknown> | undefined;
  const cfs = snapshot.customFields as Record<string, unknown> | undefined;

  const payload: Record<string, unknown> = {
    // Identity
    ...(snapshot.accountId      ? { accountId: snapshot.accountId }                                               : {}),
    ...(snapshot.externalLeadId ? { externalLeadId: snapshot.externalLeadId, externalId: snapshot.externalLeadId } : {}),
    // Workflow
    ...(snapshot.workflowId       ? { workflowId: snapshot.workflowId }             : {}),
    ...(snapshot.workflowStageId  ? { workflowStageId: snapshot.workflowStageId }   : {}),
    ...(snapshot.workflowActionId ? { workflowActionId: snapshot.workflowActionId } : {}),
    // Ownership
    ...(snapshot.ownerId  ? { ownerId: snapshot.ownerId, assignedUserId: snapshot.ownerId } : {}),
    ...(snapshot.closerId ? { closerId: snapshot.closerId }                                  : {}),
    // Custom fields
    ...(cfs && Object.keys(cfs).length > 0 ? { customFields: cfs } : {}),
  };

  // Location — inline location or TLoc data takes full priority; fall back to locationId only if nothing else
  if (loc && typeof loc === "object" && (loc.line1 || loc.oneLine)) {
    payload.location = {
      ...(loc.line1       ? { line1: loc.line1 }             : {}),
      ...(loc.oneLine     ? { oneLine: loc.oneLine }         : {}),
      ...(loc.locality    ? { locality: loc.locality }       : {}),
      ...(loc.countrySubd ? { countrySubd: loc.countrySubd } : {}),
      ...(loc.postal1     ? { postal1: loc.postal1 }         : {}),
      ...(loc.latlng      ? { latlng: loc.latlng }           : {}),
    };
  } else if (snapshot.locationId) {
    // Last resort: pass locationId reference (address may not show in UI)
    payload.locationId = snapshot.locationId;
  }

  if (res && typeof res === "object") {
    payload.resident = {
      ...(res.name      ? { name: res.name }           : {}),
      ...(res.firstName ? { firstName: res.firstName } : {}),
      ...(res.lastName  ? { lastName: res.lastName }   : {}),
      ...(res.email     ? { email: res.email }         : {}),
      ...(res.phone     ? { phone: res.phone }         : {}),
    };
  }

  // Contacts
  if (Array.isArray(snapshot.contacts) && snapshot.contacts.length > 0) {
    payload.contacts = snapshot.contacts;
  }

  // Notes (non-empty only)
  if (Array.isArray(snapshot.notes) && snapshot.notes.length > 0) {
    payload.notes = snapshot.notes;
  }

  return payload;
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
        // Load ALL snapshots (exported + restored) using range pagination to bypass 1,000 row limit
        send({ type: "phase", message: "Loading snapshots from Supabase…" });

        const allRows: Record<string, unknown>[] = [];
        const PAGE = 1000;
        let from = 0;

        while (true) {
          const { data, error } = await supabase
            .from("terros_account_snapshots")
            .select("*")
            .in("status", ["exported", "failed"])
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

        const rows = allRows;
        const total = rows.length;
        if (total === 0) {
          send({ type: "error", message: "No snapshots found in Supabase. Run export first." });
          controller.close();
          return;
        }

        send({ type: "phase", message: `Restoring ${total} accounts to Terros…`, total });

        let done = 0;
        let failed = 0;

        await batchedMap(rows!, 5, async (row) => {
          const accountId: string = row.account_id as string;
          try {
            const snapshot = row.snapshot as Record<string, unknown>;

            // If snapshot has no inline location but has a locationId, fetch TLoc data from Terros
            // so account/add gets a full inline location object (avoids "Unknown address" in UI)
            const hasInlineLocation = Boolean(snapshot.location ?? snapshot.address);
            const locationId = snapshot.locationId as string | undefined;
            let tlocData: Record<string, unknown> | null = null;
            if (!hasInlineLocation && locationId) {
              tlocData = await fetchTlocLocation(base, headers, locationId);
            }

            const payload = buildRestorePayload(snapshot, tlocData);

            // Use account/add (not upsert) — account/upsert ignores workflowStageId,
            // leaving accounts stageless and invisible in the Terros UI.
            const abort = new AbortController();
            const timer = setTimeout(() => abort.abort(), 15_000);
            const res = await fetch(`${base}/account/add`, {
              method: "POST",
              headers,
              body: JSON.stringify({ account: payload }),
              signal: abort.signal,
            });
            clearTimeout(timer);

            const text = await res.text();
            const ok = res.ok && terrosSuccess(text);

            let responseData: Record<string, unknown> | null = null;
            try { responseData = JSON.parse(text) as Record<string, unknown>; } catch { /* ignore */ }

            if (ok) {
              await supabase
                .from("terros_account_snapshots")
                .update({
                  status: "restored",
                  restored_at: new Date().toISOString(),
                  restore_result: responseData,
                })
                .eq("account_id", accountId);

              send({ type: "progress", done: ++done, total, failed });
            } else {
              failed++;
              const errMsg = (responseData?.message as string) ?? text.slice(0, 200);

              await supabase
                .from("terros_account_snapshots")
                .update({
                  status: "failed",
                  restore_result: { error: errMsg, status: res.status },
                })
                .eq("account_id", accountId);

              send({ type: "progress", done: ++done, total, failed, error: errMsg, accountId });
            }
          } catch (e) {
            failed++;
            const errMsg = e instanceof Error ? e.message : String(e);

            await supabase
              .from("terros_account_snapshots")
              .update({
                status: "failed",
                restore_result: { error: errMsg },
              })
              .eq("account_id", accountId);

            send({ type: "progress", done: ++done, total, failed, error: errMsg, accountId });
          }
        });

        send({ type: "complete", done: total, total, failed });
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
