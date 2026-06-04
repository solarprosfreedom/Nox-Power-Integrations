import { postTerros } from "@/lib/sync/terros-api";
import { terrosSuccess } from "@/lib/sync/terros-accounts";
import {
  listAccountsForOwner,
  type TerrosProxyAccountsError,
} from "@/lib/terros/proxy-accounts";
import { env } from "@/lib/env";

function extractEvents(parsed: Record<string, unknown>): Record<string, unknown>[] {
  const events = parsed.events;
  if (Array.isArray(events)) return events as Record<string, unknown>[];
  return [];
}

/** List calendar events for one Terros account via POST /calendar/event/list. */
export async function fetchTerrosCalendarEventsForAccount(
  base: string,
  key: string,
  accountId: string,
  size = 200,
): Promise<Record<string, unknown>[]> {
  const { ok, text } = await postTerros(base, key, "/calendar/event/list", {
    accountId,
    size,
  });
  if (!ok || !terrosSuccess(text)) return [];
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    return extractEvents(parsed);
  } catch {
    return [];
  }
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
  notes: string;
}

export function parseTerrosProxyCalendarEvent(
  raw: Record<string, unknown>,
  accountId: string,
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
    accountId: String(raw.accountId ?? accountId).trim() || accountId,
    title: String(raw.title ?? "").trim(),
    eventType: String(raw.eventType ?? "").trim(),
    eventDate:
      typeof eventDate === "number" || typeof eventDate === "string"
        ? eventDate
        : null,
    duration: duration != null && Number.isFinite(duration) ? duration : null,
    ownerId: String(raw.ownerId ?? "").trim(),
    attendeeId: String(raw.attendeeId ?? "").trim(),
    notes: String(raw.note ?? raw.notes ?? "").trim(),
  };
}

/** Event is in scope when the rep is owner or attendee on the calendar event. */
export function calendarEventMatchesTerrosUser(
  evt: Record<string, unknown>,
  userId: string,
): boolean {
  const owner = String(evt.ownerId ?? "").trim();
  const attendee = String(evt.attendeeId ?? "").trim();
  return owner === userId || attendee === userId;
}

export interface TerrosProxyCalendarResult {
  installerId: string;
  ownerEmail: string;
  ownerId: string;
  accountCount: number;
  count: number;
  events: TerrosProxyCalendarEvent[];
}

export type TerrosProxyCalendarError = TerrosProxyAccountsError;

function terrosBaseAndKey(): { base: string; key: string } | null {
  const key = env.terrosApiKey?.trim();
  if (!key) return null;
  const base = (env.terrosApiBaseUrl ?? "https://api.terros.com").replace(/\/$/, "");
  return { base, key };
}

/**
 * Calendar events for accounts scoped to the rep (owner/closer on account list).
 * Terros lists events per accountId — no company-wide calendar list in API.
 */
export async function listCalendarEventsForOwner(
  installerId: string,
  ownerEmail: string,
): Promise<
  | { ok: true; data: TerrosProxyCalendarResult }
  | { ok: false; error: TerrosProxyCalendarError }
> {
  const creds = terrosBaseAndKey();
  if (!creds) return { ok: false, error: { code: "terros_not_configured" } };

  const accountsResult = await listAccountsForOwner(installerId, ownerEmail);
  if (!accountsResult.ok) {
    return { ok: false, error: accountsResult.error };
  }

  const { ownerId, ownerEmail: email, accounts } = accountsResult.data;
  const { base, key } = creds;

  const byEventId = new Map<string, TerrosProxyCalendarEvent>();

  for (const account of accounts) {
    const rawEvents = await fetchTerrosCalendarEventsForAccount(
      base,
      key,
      account.accountId,
    );
    for (const raw of rawEvents) {
      if (!calendarEventMatchesTerrosUser(raw, ownerId)) continue;
      const parsed = parseTerrosProxyCalendarEvent(raw, account.accountId);
      if (!parsed) continue;
      byEventId.set(parsed.eventId, parsed);
    }
  }

  const events = [...byEventId.values()];

  return {
    ok: true,
    data: {
      installerId,
      ownerEmail: email,
      ownerId,
      accountCount: accounts.length,
      count: events.length,
      events,
    },
  };
}
