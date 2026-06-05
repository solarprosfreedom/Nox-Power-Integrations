import { postTerros } from "@/lib/sync/terros-api";
import { terrosSuccess } from "@/lib/sync/terros-accounts";
import {
  resolveTeamScope,
  type TerrosProxyAccountsError,
} from "@/lib/terros/proxy-accounts";
import type { TerrosProxyAccess } from "@/lib/terros/proxy-config";
import { resolveTerrosUserIdByEmail } from "@/lib/sync/terros-users";
import { env } from "@/lib/env";

const TERROS_CALENDAR_SIZE = 1000;
const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 1000;
const SCOPE_CACHE_MS = 15 * 60_000;
const PROXY_TERROS_GAP_MS = 150;

export interface TerrosProxyCalendarQuery {
  page?: number;
  pageSize?: number;
  /** ISO date (YYYY-MM-DD) — events on or after this day (UTC midnight). */
  from?: string;
  /** ISO date (YYYY-MM-DD) — events on or before end of this day (UTC). */
  to?: string;
}

export interface TerrosProxyCalendarEvent {
  eventId: string;
  accountId: string;
  title: string;
  eventType: string;
  eventDate: string | number | null;
  duration: number | null;
  ownerId: string;
  attendeeId: string;
  setterId: string;
  closerId: string;
  notes: string;
}

export interface TerrosProxyCalendarResult {
  installerId: string;
  filter: "rep" | "team";
  ownerEmail?: string;
  ownerId?: string;
  teamId?: string;
  teamName?: string;
  memberCount?: number;
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  count: number;
  cached: boolean;
  events: TerrosProxyCalendarEvent[];
}

export type TerrosProxyCalendarError = TerrosProxyAccountsError;

interface ScopedCalendarCacheEntry {
  at: number;
  meta: Omit<
    TerrosProxyCalendarResult,
    "page" | "pageSize" | "total" | "totalPages" | "count" | "cached" | "events" | "from" | "to"
  >;
  events: TerrosProxyCalendarEvent[];
}

const scopedCalendarCache = new Map<string, ScopedCalendarCacheEntry>();

function extractEvents(parsed: Record<string, unknown>): Record<string, unknown>[] {
  const events = parsed.events;
  if (Array.isArray(events)) return events as Record<string, unknown>[];
  return [];
}

function terrosBaseAndKey(): { base: string; key: string } | null {
  const key = env.terrosApiKey?.trim();
  if (!key) return null;
  const base = (env.terrosApiBaseUrl ?? "https://api.terros.com").replace(/\/$/, "");
  return { base, key };
}

function normalizePagination(query?: TerrosProxyCalendarQuery): { page: number; pageSize: number } {
  const page = Math.max(1, Math.floor(query?.page ?? DEFAULT_PAGE));
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Math.floor(query?.pageSize ?? DEFAULT_PAGE_SIZE)),
  );
  return { page, pageSize };
}

function scopeCacheKey(access: TerrosProxyAccess): string {
  if (access.filter.kind === "team") {
    return `${access.installerId}:cal:team:${access.filter.teamId ?? ""}:${access.filter.teamName ?? ""}`;
  }
  return `${access.installerId}:cal:rep:${access.filter.ownerEmail}`;
}

function paginateEvents(
  events: TerrosProxyCalendarEvent[],
  page: number,
  pageSize: number,
): { total: number; totalPages: number; count: number; events: TerrosProxyCalendarEvent[] } {
  const total = events.length;
  const totalPages = total ? Math.ceil(total / pageSize) : 0;
  const start = (page - 1) * pageSize;
  const slice = events.slice(start, start + pageSize);
  return { total, totalPages, count: slice.length, events: slice };
}

function eventTimestamp(evt: TerrosProxyCalendarEvent): number | null {
  const raw = evt.eventDate;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim()) {
    const ms = new Date(raw).getTime();
    return Number.isNaN(ms) ? null : ms;
  }
  return null;
}

function dayBoundsUtc(isoDate: string, endOfDay: boolean): number | null {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]) - 1;
  const d = Number(match[3]);
  if (endOfDay) {
    return Date.UTC(y, m, d, 23, 59, 59, 999);
  }
  return Date.UTC(y, m, d, 0, 0, 0, 0);
}

function filterEventsByDateRange(
  events: TerrosProxyCalendarEvent[],
  from?: string,
  to?: string,
): TerrosProxyCalendarEvent[] {
  if (!from && !to) return events;
  const fromMs = from ? dayBoundsUtc(from, false) : null;
  const toMs = to ? dayBoundsUtc(to, true) : null;
  return events.filter(evt => {
    const ms = eventTimestamp(evt);
    if (ms == null) return false;
    if (fromMs != null && ms < fromMs) return false;
    if (toMs != null && ms > toMs) return false;
    return true;
  });
}

export function parseTerrosProxyCalendarEvent(
  raw: Record<string, unknown>,
  fallbackAccountId = "",
): TerrosProxyCalendarEvent | null {
  const eventId = String(raw.eventId ?? raw.id ?? "").trim();
  if (!eventId) return null;

  const eventDate = raw.eventDate ?? raw.startDate ?? null;
  const durationRaw = raw.duration;
  const duration =
    typeof durationRaw === "number"
      ? durationRaw
      : durationRaw != null && durationRaw !== ""
        ? Number(durationRaw)
        : null;

  return {
    eventId,
    accountId: String(raw.accountId ?? fallbackAccountId).trim() || fallbackAccountId,
    title: String(raw.title ?? "").trim(),
    eventType: String(raw.eventType ?? "").trim(),
    eventDate:
      typeof eventDate === "number" || typeof eventDate === "string"
        ? eventDate
        : null,
    duration: duration != null && Number.isFinite(duration) ? duration : null,
    ownerId: String(raw.ownerId ?? "").trim(),
    attendeeId: String(raw.attendeeId ?? "").trim(),
    setterId: String(raw.setterId ?? "").trim(),
    closerId: String(raw.closerId ?? "").trim(),
    notes: String(raw.note ?? raw.notes ?? "").trim(),
  };
}

/** Event matches when a scoped user is owner, attendee (setter), or closer. */
export function calendarEventMatchesTerrosUsers(
  evt: Record<string, unknown>,
  userIds: ReadonlySet<string>,
): boolean {
  const owner = String(evt.ownerId ?? "").trim();
  const attendee = String(evt.attendeeId ?? "").trim();
  const setter = String(evt.setterId ?? "").trim();
  const closer = String(evt.closerId ?? "").trim();
  return (
    (owner.length > 0 && userIds.has(owner)) ||
    (attendee.length > 0 && userIds.has(attendee)) ||
    (setter.length > 0 && userIds.has(setter)) ||
    (closer.length > 0 && userIds.has(closer))
  );
}

async function fetchTerrosCalendarList(
  base: string,
  key: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>[]> {
  const { ok, text } = await postTerros(base, key, "/calendar/event/list", body, {
    minGapMs: PROXY_TERROS_GAP_MS,
  });
  if (!ok || !terrosSuccess(text)) return [];
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    return extractEvents(parsed);
  } catch {
    return [];
  }
}

function mergeRawEvents(
  batches: Record<string, unknown>[][],
  userIds: ReadonlySet<string>,
): TerrosProxyCalendarEvent[] {
  const byId = new Map<string, TerrosProxyCalendarEvent>();
  for (const rawList of batches) {
    for (const raw of rawList) {
      if (!calendarEventMatchesTerrosUsers(raw, userIds)) continue;
      const parsed = parseTerrosProxyCalendarEvent(raw);
      if (!parsed) continue;
      byId.set(parsed.eventId, parsed);
    }
  }
  return [...byId.values()];
}

async function collectScopedCalendarEvents(
  access: TerrosProxyAccess,
): Promise<
  | { ok: true; meta: ScopedCalendarCacheEntry["meta"]; events: TerrosProxyCalendarEvent[]; cached: boolean }
  | { ok: false; error: TerrosProxyCalendarError }
> {
  const cacheKey = scopeCacheKey(access);
  const cached = scopedCalendarCache.get(cacheKey);
  if (cached && Date.now() - cached.at < SCOPE_CACHE_MS) {
    return { ok: true, meta: cached.meta, events: cached.events, cached: true };
  }

  const creds = terrosBaseAndKey();
  if (!creds) return { ok: false, error: { code: "terros_not_configured" } };

  const { base, key } = creds;

  if (access.filter.kind === "rep") {
    const email = access.filter.ownerEmail.trim().toLowerCase();
    const resolved = await resolveTerrosUserIdByEmail(base, key, email);
    const ownerId = resolved.userId?.trim() ?? "";
    if (!ownerId) {
      return { ok: false, error: { code: "owner_not_found", ownerEmail: email } };
    }

    const userIds = new Set([ownerId]);
    const batches: Record<string, unknown>[][] = [];
    for (const roleKey of ["ownerId", "attendeeId", "setterId", "closerId"] as const) {
      const raw = await fetchTerrosCalendarList(base, key, {
        [roleKey]: ownerId,
        size: TERROS_CALENDAR_SIZE,
      });
      if (raw.length) batches.push(raw);
    }

    const events = mergeRawEvents(batches, userIds);
    const meta = {
      installerId: access.installerId,
      filter: "rep" as const,
      ownerEmail: email,
      ownerId,
    };
    scopedCalendarCache.set(cacheKey, { at: Date.now(), meta, events });
    return { ok: true, meta, events, cached: false };
  }

  const teamScope = await resolveTeamScope(base, key, access.filter);
  if (!teamScope.ok) return teamScope;

  const { teamId, teamName, userIds } = teamScope;
  const userIdSet = new Set(userIds);
  const raw = await fetchTerrosCalendarList(base, key, {
    teamId,
    size: TERROS_CALENDAR_SIZE,
  });
  const events = mergeRawEvents([raw], userIdSet);
  const meta = {
    installerId: access.installerId,
    filter: "team" as const,
    teamId,
    teamName,
    memberCount: userIds.length,
  };
  scopedCalendarCache.set(cacheKey, { at: Date.now(), meta, events });
  return { ok: true, meta, events, cached: false };
}

/** @deprecated Use listCalendarEventsForProxy. */
export async function listCalendarEventsForOwner(
  installerId: string,
  ownerEmail: string,
  query?: TerrosProxyCalendarQuery,
): Promise<
  | { ok: true; data: TerrosProxyCalendarResult }
  | { ok: false; error: TerrosProxyCalendarError }
> {
  return listCalendarEventsForProxy(
    { installerId, filter: { kind: "rep", ownerEmail } },
    query,
  );
}

export async function listCalendarEventsForProxy(
  access: TerrosProxyAccess,
  query?: TerrosProxyCalendarQuery,
): Promise<
  | { ok: true; data: TerrosProxyCalendarResult }
  | { ok: false; error: TerrosProxyCalendarError }
> {
  const { page, pageSize } = normalizePagination(query);
  const from = query?.from?.trim() || undefined;
  const to = query?.to?.trim() || undefined;

  const collected = await collectScopedCalendarEvents(access);
  if (!collected.ok) return collected;

  const filtered = filterEventsByDateRange(collected.events, from, to);
  const paged = paginateEvents(filtered, page, pageSize);

  return {
    ok: true,
    data: {
      ...collected.meta,
      from,
      to,
      page,
      pageSize,
      total: paged.total,
      totalPages: paged.totalPages,
      count: paged.count,
      cached: collected.cached,
      events: paged.events,
    },
  };
}
