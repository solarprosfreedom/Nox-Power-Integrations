import { env } from "@/lib/env";
import { enerfloRequest } from "@/lib/enerflo/client";

const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_CONCURRENCY = 3;
const DEFAULT_PUT_GAP_MS = 150;
const MAX_OWNER_SCAN_PAGES = 200;

export interface EnerfloSetterBackfillOptions {
  dryRun?: boolean;
  /** Process one customer by numeric id (skips list pagination). */
  customerId?: string;
  /** Only leads owned by this Enerflo user id (Lead Owner). */
  ownerUserId?: number;
  /** Resolve owner via GET /api/v3/users when ownerUserId omitted. */
  ownerEmail?: string;
  /** Pre-scanned customer ids (missing setter on v1). Skips list pagination. */
  customerIds?: string[];
  /** Total leads for this owner from a prior scan (for result stats). */
  ownerTotalLeads?: number;
  limit?: number;
  startPage?: number;
  concurrency?: number;
  putGapMs?: number;
  /** Fired while paginating customers to find this owner's leads. */
  onScanPage?: (page: number, pagesFetched: number) => void;
}

export interface EnerfloSetterBackfillSample {
  customerId: string;
  agentUserId: number;
  previousSetterUserId: number | null;
  action: "updated" | "would_update" | "skipped";
  reason?: string;
}

export interface EnerfloSetterBackfillResult {
  dryRun: boolean;
  customerId?: string;
  ownerUserId?: number;
  ownerEmail?: string;
  startPage: number;
  pagesFetched: number;
  scanned: number;
  eligible: number;
  updated: number;
  skipped: number;
  errors: string[];
  samples: EnerfloSetterBackfillSample[];
}

export interface OwnerSetterSummary {
  ownerUserId: number;
  ownerName: string;
  ownerEmail: string | null;
  totalLeads: number;
  missingSetter: number;
  hasSetter: number;
}

export interface ScanOwnerSetterSummariesResult {
  summaries: OwnerSetterSummary[];
  /** Customer ids per owner where setter is empty on v1 (key = ownerUserId). */
  eligibleByOwner: Record<number, string[]>;
  pagesFetched: number;
  rowsScanned: number;
}

function enerfloBase(): string {
  return (env.enerfloV1BaseUrl ?? "https://enerflo.io").replace(/\/$/, "");
}

function enerfloKey(): string {
  const key = env.enerfloV1ApiKey?.trim();
  if (!key) throw new Error("ENERFLO_V1_API_KEY is not configured");
  return key;
}

function extractList(parsed: Record<string, unknown>, keys: string[]): Record<string, unknown>[] {
  for (const key of keys) {
    const value = parsed[key];
    if (Array.isArray(value)) return value as Record<string, unknown>[];
  }
  return [];
}

function extractCustomerList(parsed: Record<string, unknown>): Record<string, unknown>[] {
  return extractList(parsed, ["data", "customers", "results", "items"]);
}

function customerNumericId(row: Record<string, unknown>): string | null {
  const id = row.id ?? row.customer_id;
  if (id == null || id === "") return null;
  return String(id);
}

function parseUserId(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

function ownerIdFromV1Row(row: Record<string, unknown>): number | null {
  const owner = row.owner as Record<string, unknown> | undefined;
  return parseUserId(owner?.id ?? row.agent_id);
}

function ownerNameFromV1Row(row: Record<string, unknown>): string {
  const owner = row.owner as Record<string, unknown> | undefined;
  const first = String(owner?.first_name ?? owner?.firstName ?? "").trim();
  const last = String(owner?.last_name ?? owner?.lastName ?? "").trim();
  const full = `${first} ${last}`.trim();
  if (full) return full;
  const email = String(owner?.email ?? "").trim();
  if (email) return email;
  const agentId = ownerIdFromV1Row(row);
  return agentId != null ? `User ${agentId}` : "Unknown";
}

function ownerEmailFromV1Row(row: Record<string, unknown>): string | null {
  const owner = row.owner as Record<string, unknown> | undefined;
  const email = String(owner?.email ?? "").trim();
  return email || null;
}

function userNameFromV3Row(row: Record<string, unknown>): string {
  const first = String(row.first_name ?? row.firstName ?? "").trim();
  const last = String(row.last_name ?? row.lastName ?? "").trim();
  const full = `${first} ${last}`.trim();
  if (full) return full;
  const email = String(row.email ?? row.user_email ?? "").trim();
  if (email) return email;
  const id = parseUserId(row.id ?? row.user_id);
  return id != null ? `User ${id}` : "Unknown";
}

function userEmailFromV3Row(row: Record<string, unknown>): string | null {
  const email = String(row.email ?? row.user_email ?? "").trim();
  return email || null;
}

export function sortOwnerSetterSummariesAlphabetical(
  summaries: OwnerSetterSummary[],
): OwnerSetterSummary[] {
  return [...summaries].sort((a, b) =>
    a.ownerName.localeCompare(b.ownerName, undefined, { sensitivity: "base" }),
  );
}

type OwnerCountEntry = {
  ownerName: string;
  ownerEmail: string | null;
  totalLeads: number;
  missingSetter: number;
  hasSetter: number;
  eligibleIds: string[];
};

function mergeRepsWithCounts(
  baseReps: OwnerSetterSummary[],
  byOwner: Map<number, OwnerCountEntry>,
): OwnerSetterSummary[] {
  const merged = new Map(baseReps.map(rep => [rep.ownerUserId, { ...rep }]));

  for (const [ownerUserId, entry] of byOwner) {
    const existing = merged.get(ownerUserId);
    if (existing) {
      existing.totalLeads = entry.totalLeads;
      existing.missingSetter = entry.missingSetter;
      existing.hasSetter = entry.hasSetter;
      if (!existing.ownerEmail && entry.ownerEmail) {
        existing.ownerEmail = entry.ownerEmail;
      }
    } else {
      merged.set(ownerUserId, {
        ownerUserId,
        ownerName: entry.ownerName,
        ownerEmail: entry.ownerEmail,
        totalLeads: entry.totalLeads,
        missingSetter: entry.missingSetter,
        hasSetter: entry.hasSetter,
      });
    }
  }

  return sortOwnerSetterSummariesAlphabetical([...merged.values()]);
}

/** All Enerflo users (sales reps), sorted A–Z, with zero counts until customer scan runs. */
export async function fetchAllEnerfloUsersForBackfill(): Promise<OwnerSetterSummary[]> {
  const base = enerfloBase();
  const key = enerfloKey();
  const reps: OwnerSetterSummary[] = [];

  for (let page = 1; page <= 50; page++) {
    const res = await fetch(`${base}/api/v3/users?page=${page}&pageSize=100`, {
      method: "GET",
      headers: { "api-key": key, "Content-Type": "application/json" },
    });
    if (!res.ok) {
      throw new Error(`Enerflo GET /api/v3/users page ${page} failed (${res.status})`);
    }
    const parsed = JSON.parse(await res.text()) as Record<string, unknown>;
    const rows = extractList(parsed, ["results", "data", "users", "items"]);
    if (!rows.length) break;

    for (const row of rows) {
      const ownerUserId = parseUserId(row.id ?? row.user_id);
      if (ownerUserId == null) continue;
      reps.push({
        ownerUserId,
        ownerName: userNameFromV3Row(row),
        ownerEmail: userEmailFromV3Row(row),
        totalLeads: 0,
        missingSetter: 0,
        hasSetter: 0,
      });
    }

    if (rows.length < 100) break;
  }

  return sortOwnerSetterSummariesAlphabetical(reps);
}

function v1HasSetter(row: Record<string, unknown>): boolean {
  const setter = row.setter as Record<string, unknown> | undefined;
  return parseUserId(row.setter_id) != null || parseUserId(setter?.id) != null;
}

function parseV3CustomerIds(parsed: Record<string, unknown>): {
  agentUserId: number | null;
  setterUserId: number | null;
} {
  const nested = (parsed.customer ?? parsed.data) as Record<string, unknown> | undefined;
  const source = nested && typeof nested === "object" ? nested : parsed;
  return {
    agentUserId: parseUserId(source.agent_user_id),
    setterUserId: parseUserId(source.setter_user_id),
  };
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchCustomerListPage(page: number, pageSize: number): Promise<Record<string, unknown>[]> {
  const base = enerfloBase();
  const key = enerfloKey();
  const res = await fetch(`${base}/api/v1/customers?page=${page}&pageSize=${pageSize}`, {
    method: "GET",
    headers: { "api-key": key, "Content-Type": "application/json" },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Enerflo GET /api/v1/customers page ${page} failed (${res.status}): ${text.slice(0, 200)}`);
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`Enerflo customers page ${page} returned invalid JSON`);
  }
  return extractCustomerList(parsed);
}

async function resolveOwnerUserId(options: {
  ownerUserId?: number;
  ownerEmail?: string;
}): Promise<number> {
  const direct = parseUserId(options.ownerUserId);
  if (direct) return direct;

  const email = options.ownerEmail?.trim().toLowerCase();
  if (!email) {
    throw new Error("ownerUserId or ownerEmail is required for owner-scoped backfill");
  }

  const base = enerfloBase();
  const key = enerfloKey();

  for (let page = 1; page <= 50; page++) {
    const res = await fetch(`${base}/api/v3/users?page=${page}&pageSize=100`, {
      method: "GET",
      headers: { "api-key": key, "Content-Type": "application/json" },
    });
    if (!res.ok) break;
    const parsed = JSON.parse(await res.text()) as Record<string, unknown>;
    const rows = extractList(parsed, ["results", "data", "users", "items"]);
    if (!rows.length) break;

    const match = rows.find(row => {
      const rowEmail = String(row.email ?? row.user_email ?? "").trim().toLowerCase();
      return rowEmail === email;
    });
    if (match) {
      const id = parseUserId(match.id ?? match.user_id);
      if (id) return id;
    }

    if (rows.length < 100) break;
  }

  throw new Error(`Could not resolve Enerflo user id for ownerEmail: ${email}`);
}

async function fetchV3CustomerIds(customerId: string): Promise<{
  agentUserId: number | null;
  setterUserId: number | null;
}> {
  const log = await enerfloRequest({
    operation: "migration:enerflo-setter-backfill:get-customer",
    method: "GET",
    path: `/api/v3/customers/${encodeURIComponent(customerId)}`,
  });
  if (!log.ok) {
    throw new Error(`GET v3 customer ${customerId} failed (${log.status ?? "?"}): ${log.responsePreview}`);
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(log.rawResponseText) as Record<string, unknown>;
  } catch {
    throw new Error(`GET v3 customer ${customerId} returned invalid JSON`);
  }
  return parseV3CustomerIds(parsed);
}

async function updateSetterFromOwner(
  customerId: string,
  agentUserId: number,
  dryRun: boolean,
): Promise<void> {
  if (dryRun) return;
  const log = await enerfloRequest({
    operation: "migration:enerflo-setter-backfill:update-setter",
    method: "PUT",
    path: `/api/v3/customers/${encodeURIComponent(customerId)}`,
    body: { setter_user_id: agentUserId },
  });
  if (!log.ok) {
    throw new Error(`PUT v3 customer ${customerId} failed (${log.status ?? "?"}): ${log.responsePreview}`);
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    results.push(...(await Promise.all(batch.map(fn))));
  }
  return results;
}

function recordSkip(
  result: EnerfloSetterBackfillResult,
  sample: EnerfloSetterBackfillSample,
  maxSamples: number,
): void {
  result.skipped++;
  if (result.samples.length < maxSamples) {
    result.samples.push(sample);
  }
}

async function processCustomer(
  customerId: string,
  dryRun: boolean,
  putGapMs: number,
  result: EnerfloSetterBackfillResult,
  maxSamples: number,
): Promise<void> {
  result.scanned++;
  try {
    const { agentUserId, setterUserId } = await fetchV3CustomerIds(customerId);

    if (!agentUserId) {
      recordSkip(result, {
        customerId,
        agentUserId: 0,
        previousSetterUserId: setterUserId,
        action: "skipped",
        reason: "no_agent_user_id",
      }, maxSamples);
      return;
    }

    if (setterUserId != null) {
      recordSkip(result, {
        customerId,
        agentUserId,
        previousSetterUserId: setterUserId,
        action: "skipped",
        reason: "setter_already_exists",
      }, maxSamples);
      return;
    }

    result.eligible++;
    await updateSetterFromOwner(customerId, agentUserId, dryRun);
    result.updated++;
    if (!dryRun) await sleep(putGapMs);

    if (result.samples.length < maxSamples) {
      result.samples.push({
        customerId,
        agentUserId,
        previousSetterUserId: setterUserId,
        action: dryRun ? "would_update" : "updated",
      });
    }
  } catch (e) {
    const msg = `Customer ${customerId}: ${e instanceof Error ? e.message : String(e)}`;
    result.errors.push(msg);
    recordSkip(result, {
      customerId,
      agentUserId: 0,
      previousSetterUserId: null,
      action: "skipped",
      reason: msg,
    }, maxSamples);
  }
}

async function collectCustomerIdsForOwner(
  ownerUserId: number,
  startPage: number,
  limit: number | undefined,
  result: EnerfloSetterBackfillResult,
  maxSamples: number,
  onScanPage?: (page: number, pagesFetched: number) => void,
): Promise<string[]> {
  const customerIds: string[] = [];
  let page = startPage;

  while (page < startPage + MAX_OWNER_SCAN_PAGES) {
    const rows = await fetchCustomerListPage(page, DEFAULT_PAGE_SIZE);
    result.pagesFetched++;
    onScanPage?.(page, result.pagesFetched);
    if (!rows.length) break;

    for (const row of rows) {
      if (ownerIdFromV1Row(row) !== ownerUserId) continue;

      const id = customerNumericId(row);
      if (!id) continue;

      result.scanned++;

      if (v1HasSetter(row)) {
        recordSkip(result, {
          customerId: id,
          agentUserId: ownerUserId,
          previousSetterUserId: parseUserId(row.setter_id ?? (row.setter as Record<string, unknown> | undefined)?.id),
          action: "skipped",
          reason: "setter_already_exists_v1",
        }, maxSamples);
        continue;
      }

      customerIds.push(id);
      if (limit != null && customerIds.length >= limit) {
        return customerIds;
      }
    }

    if (rows.length < DEFAULT_PAGE_SIZE) break;
    page++;
  }

  return customerIds;
}

/** Paginate v1 customers and aggregate lead counts per owner. */
export async function scanOwnerSetterSummaries(options?: {
  onPage?: (page: number, rowsScanned: number) => void;
  onPartial?: (summaries: OwnerSetterSummary[]) => void;
  /** Reps to merge counts into (e.g. current batch of 5). */
  baseReps?: OwnerSetterSummary[];
  /** When set, only count leads owned by these Enerflo user ids. */
  ownerUserIds?: number[];
}): Promise<ScanOwnerSetterSummariesResult> {
  const baseReps = options?.baseReps ?? [];
  const ownerFilter =
    options?.ownerUserIds?.length != null && options.ownerUserIds.length > 0
      ? new Set(options.ownerUserIds)
      : null;

  const byOwner = new Map<number, OwnerCountEntry>();

  if (ownerFilter) {
    for (const rep of baseReps) {
      if (!ownerFilter.has(rep.ownerUserId)) continue;
      byOwner.set(rep.ownerUserId, {
        ownerName: rep.ownerName,
        ownerEmail: rep.ownerEmail,
        totalLeads: 0,
        missingSetter: 0,
        hasSetter: 0,
        eligibleIds: [],
      });
    }
  }

  let pagesFetched = 0;
  let rowsScanned = 0;

  const emitPartial = () => {
    options?.onPartial?.(mergeRepsWithCounts(baseReps, byOwner));
  };

  for (let page = 1; page <= MAX_OWNER_SCAN_PAGES; page++) {
    const rows = await fetchCustomerListPage(page, DEFAULT_PAGE_SIZE);
    pagesFetched++;
    if (!rows.length) break;

    for (const row of rows) {
      rowsScanned++;
      const ownerUserId = ownerIdFromV1Row(row);
      if (ownerUserId == null) continue;
      if (ownerFilter && !ownerFilter.has(ownerUserId)) continue;

      let entry = byOwner.get(ownerUserId);
      if (!entry) {
        entry = {
          ownerName: ownerNameFromV1Row(row),
          ownerEmail: ownerEmailFromV1Row(row),
          totalLeads: 0,
          missingSetter: 0,
          hasSetter: 0,
          eligibleIds: [],
        };
        byOwner.set(ownerUserId, entry);
      }

      entry.totalLeads++;
      if (v1HasSetter(row)) {
        entry.hasSetter++;
      } else {
        entry.missingSetter++;
        const id = customerNumericId(row);
        if (id) entry.eligibleIds.push(id);
      }
    }

    options?.onPage?.(page, rowsScanned);
    emitPartial();

    if (rows.length < DEFAULT_PAGE_SIZE) break;
  }

  const summaries = mergeRepsWithCounts(baseReps, byOwner);
  const eligibleByOwner: Record<number, string[]> = {};
  for (const [ownerUserId, entry] of byOwner) {
    if (entry.eligibleIds.length) {
      eligibleByOwner[ownerUserId] = entry.eligibleIds;
    }
  }

  return { summaries, eligibleByOwner, pagesFetched, rowsScanned };
}

/** Backfill Enerflo Setter (setter_user_id) from Lead Owner (agent_user_id). */
export async function backfillEnerfloSetterFromOwner(
  options: EnerfloSetterBackfillOptions = {},
): Promise<EnerfloSetterBackfillResult> {
  const dryRun = options.dryRun ?? false;
  const limitRaw = options.limit;
  const limit = limitRaw != null ? Math.max(1, Math.floor(limitRaw)) : undefined;
  const startPage = Math.max(1, Math.floor(options.startPage ?? 1));
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? DEFAULT_CONCURRENCY));
  const putGapMs = Math.max(0, Math.floor(options.putGapMs ?? DEFAULT_PUT_GAP_MS));
  const singleId = options.customerId?.trim();
  const ownerEmail = options.ownerEmail?.trim() || undefined;
  const ownerScoped = Boolean(singleId == null && (options.ownerUserId != null || ownerEmail));

  let resolvedOwnerId: number | undefined;
  if (ownerScoped) {
    resolvedOwnerId = await resolveOwnerUserId({
      ownerUserId: options.ownerUserId,
      ownerEmail,
    });
  }

  const result: EnerfloSetterBackfillResult = {
    dryRun,
    customerId: singleId || undefined,
    ownerUserId: resolvedOwnerId,
    ownerEmail,
    startPage,
    pagesFetched: 0,
    scanned: 0,
    eligible: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    samples: [],
  };

  const maxSamples = 25;

  if (singleId) {
    await processCustomer(singleId, dryRun, putGapMs, result, maxSamples);
    return result;
  }

  let customerIds: string[];

  if (ownerScoped && resolvedOwnerId != null) {
    if (options.customerIds != null) {
      const preloadedIds = options.customerIds.map(id => id.trim()).filter(Boolean);
      customerIds = limit != null ? preloadedIds.slice(0, limit) : preloadedIds;
      result.scanned = options.ownerTotalLeads ?? customerIds.length;
    } else {
      customerIds = await collectCustomerIdsForOwner(
        resolvedOwnerId,
        startPage,
        limit,
        result,
        maxSamples,
        options.onScanPage,
      );
    }

    await mapWithConcurrency(customerIds, concurrency, async customerId => {
      try {
        const { agentUserId, setterUserId } = await fetchV3CustomerIds(customerId);

        if (!agentUserId) {
          recordSkip(result, {
            customerId,
            agentUserId: 0,
            previousSetterUserId: setterUserId,
            action: "skipped",
            reason: "no_agent_user_id",
          }, maxSamples);
          return;
        }

        if (setterUserId != null) {
          recordSkip(result, {
            customerId,
            agentUserId,
            previousSetterUserId: setterUserId,
            action: "skipped",
            reason: "setter_already_exists",
          }, maxSamples);
          return;
        }

        result.eligible++;
        await updateSetterFromOwner(customerId, agentUserId, dryRun);
        result.updated++;
        if (!dryRun) await sleep(putGapMs);

        if (result.samples.length < maxSamples) {
          result.samples.push({
            customerId,
            agentUserId,
            previousSetterUserId: setterUserId,
            action: dryRun ? "would_update" : "updated",
          });
        }
      } catch (e) {
        const msg = `Customer ${customerId}: ${e instanceof Error ? e.message : String(e)}`;
        result.errors.push(msg);
        recordSkip(result, {
          customerId,
          agentUserId: 0,
          previousSetterUserId: null,
          action: "skipped",
          reason: msg,
        }, maxSamples);
      }
    });
    return result;
  }

  customerIds = [];
  let page = startPage;
  const bulkLimit = limit ?? 500;

  while (customerIds.length < bulkLimit) {
    const rows = await fetchCustomerListPage(page, DEFAULT_PAGE_SIZE);
    result.pagesFetched++;
    if (!rows.length) break;

    for (const row of rows) {
      const id = customerNumericId(row);
      if (id) customerIds.push(id);
      if (customerIds.length >= bulkLimit) break;
    }

    if (rows.length < DEFAULT_PAGE_SIZE) break;
    page++;
  }

  await mapWithConcurrency(customerIds.slice(0, bulkLimit), concurrency, customerId =>
    processCustomer(customerId, dryRun, putGapMs, result, maxSamples),
  );

  return result;
}
