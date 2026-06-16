import { NextRequest, NextResponse, after } from "next/server";
import { env } from "@/lib/env";
import { enerfloRequest, enerfloRequestParsed } from "@/lib/enerflo/client";
import {
  writeApiLog,
  getEnerfloAppointmentIdByTerrosEventId,
  getCalendarEventMappingMeta,
  acquireTerrosEventCreateLock,
  saveCalendarEventMapping,
  saveCustomerAccountMapping,
  getEnerfloCustomerIdByTerrosAccountId,
  findEnerfloCustomerIdFromHistoricalLogs,
  normalizeTerrosAccountId,
} from "@/lib/logger";

/**
 * Window after a calendar-event mapping is written during which a Terros
 * event-update carrying the [Enerflo:ID] marker is treated as the note-stamp /
 * sync echo and skipped. Updates after this window are genuine reschedules and
 * are pushed to Enerflo. Echoes are automated and arrive within seconds; humans
 * reschedule minutes/hours later.
 */
const EVENT_ECHO_WINDOW_MS = 2 * 60 * 1000;
import { findUserByEmailInList } from "@/lib/sync/user-email-match";

// Give background work (via after()) enough headroom to finish the Enerflo
// round-trips. Terros itself gets an instant 200, so this only bounds the
// async processing, not the webhook response.
export const maxDuration = 60;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Terros often uses HTTP 200 even when the JSON body is `{ "type": "error", ... }`. */
function terrosJsonBodyIndicatesSuccess(responseText: string): boolean {
  try {
    const j = JSON.parse(responseText) as Record<string, unknown>;
    if (j.type === "error") return false;
  } catch {
    /* non-JSON — leave to HTTP status */
  }
  return true;
}

interface TerrosLatLng {
  latitude?: number;
  longitude?: number;
}

interface TerrosAddress {
  line1?: string;
  line2?: string;
  locality?: string;
  countrySubd?: string;
  postal1?: string;
  latlng?: TerrosLatLng;
}

interface TerrosResident {
  name?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
}

interface TerrosOwner {
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  /** Terros user ID — present when the webhook sends only an ID rather than a full user object. */
  id?: string;
  userId?: string;
}

interface TerrosAccountWebhookData {
  id?: string;
  address?: TerrosAddress;
  resident?: TerrosResident;
  owner?: TerrosOwner;
  externalLeadId?: string;
}

interface TerrosWebhookBody {
  action?: string;
  entity?: string;
  data?: TerrosAccountWebhookData;
}

interface TerrosEventData {
  id?: string;
  /** Some Terros event payloads use "eventId" instead of "id". */
  eventId?: string;
  title?: string;
  eventDate?: string | number;
  duration?: number;
  eventType?: string;
  /** Terros webhook sends the dedup marker as "note" (singular) */
  note?: string;
  /** Some older payloads may use "notes" (plural) — check both */
  notes?: string;
  account?: { accountId?: string; externalLeadId?: string };
  owner?: { email?: string; userId?: string; firstName?: string; lastName?: string };
  attendee?: { email?: string; userId?: string; firstName?: string; lastName?: string };
  resident?: { email?: string; firstName?: string; lastName?: string; phone?: string };
  address?: TerrosAddress;
}

interface TerrosEventWebhookBody {
  action?: string;
  entity?: string;
  data?: TerrosEventData;
}

function logPreview(body: string, max = 2000): string {
  if (body.length <= max) return body;
  return `${body.slice(0, max)}…`;
}

function splitName(full: string): { first_name: string; last_name: string } {
  const t = full.trim();
  if (!t) return { first_name: "Terros", last_name: "Account" };
  const parts = t.split(/\s+/);
  if (parts.length === 1) return { first_name: parts[0]!, last_name: "." };
  return { first_name: parts[0]!, last_name: parts.slice(1).join(" ") };
}

/**
 * Strip a +alias suffix from an email address so it matches the canonical
 * Enerflo login email.
 * e.g. "charlielespier+axia@solarpros.io" → "charlielespier@solarpros.io"
 * Safe to call on any email; returns the input unchanged when no alias is present.
 */
function stripEmailAlias(email: string): string {
  return email.replace(/\+[^@]*(@)/, "$1");
}

/**
 * Resolve the canonical Enerflo-compatible email for a Terros account owner.
 *
 * Strategy:
 *  1. If `owner.email` is present → call Terros `/user/get` with that email to
 *     get the canonical registered email, then strip any +alias suffix so it
 *     matches the rep's Enerflo login email.
 *  2. If only `owner.id` / `owner.userId` is present → call `/user/get` by ID.
 *  3. Falls back to the raw email (alias-stripped) if the API call fails.
 */
async function resolveTerrosOwnerEmail(
  terrosBase: string,
  terrosKey: string,
  owner: TerrosOwner | undefined
): Promise<string | undefined> {
  if (!owner) return undefined;

  const rawEmail = owner.email?.trim();
  const ownerId = (owner.id ?? owner.userId)?.trim();

  if (!rawEmail && !ownerId) return undefined;

  // If the owner already has a valid email, use it directly — no Terros API call needed.
  // The API call only adds latency and returns the same value. We only need the API call
  // when the owner has only a userId (no email) to resolve the canonical email.
  if (rawEmail && rawEmail.includes("@")) return stripEmailAlias(rawEmail);

  const url = `${terrosBase}/user/get`;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `ApiKey ${terrosKey}`,
  };

  // No email available — resolve from userId via Terros API
  const bodies: Record<string, unknown>[] = [];
  if (ownerId) {
    bodies.push({ userId: ownerId });
    bodies.push({ id: ownerId });
  }

  for (const reqBody of bodies) {
    try {
      const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(reqBody) });
      const text = await res.text();
      if (!res.ok || !terrosJsonBodyIndicatesSuccess(text)) continue;
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const user = (parsed.user as Record<string, unknown> | undefined) ?? parsed;
      const email =
        (user.email as string | undefined) ??
        (user.loginEmail as string | undefined) ??
        (parsed.email as string | undefined);
      if (typeof email === "string" && email.trim().includes("@")) {
        return stripEmailAlias(email.trim());
      }
    } catch {
      continue;
    }
  }

  return undefined;
}

function mapAddress(a?: TerrosAddress): {
  address: string;
  city: string;
  state: string;
  zip: string;
} {
  if (!a) return { address: "", city: "", state: "", zip: "" };
  const line1 = (a.line1 ?? "").trim();
  const city = (a.locality ?? "").trim();
  const state = (a.countrySubd ?? "").trim();
  const zip = a.postal1 != null ? String(a.postal1).trim() : "";
  return { address: line1, city, state, zip };
}

/** POST /account/get — request shape varies; try common variants. */
async function fetchTerrosAccountById(
  terrosBase: string,
  terrosKey: string,
  accountId: string
): Promise<Record<string, unknown> | null> {
  const url = `${terrosBase}/account/get`;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `ApiKey ${terrosKey}`,
  };
  const bodies: Record<string, unknown>[] = [
    { accountId },
    { id: accountId },
    { account: { accountId, id: accountId } },
  ];

  for (const body of bodies) {
    let responseText = "";
    try {
      const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
      responseText = await res.text();
      if (!res.ok || !terrosJsonBodyIndicatesSuccess(responseText)) continue;
      const parsed = JSON.parse(responseText) as Record<string, unknown>;
      const acc = (parsed.account ?? parsed.data) as Record<string, unknown> | undefined;
      if (acc && typeof acc === "object") return acc;
    } catch {
      continue;
    }
  }
  return null;
}

async function terrosAccountUpdateExternalLeadId(
  terrosBase: string,
  terrosKey: string,
  accountId: string,
  externalLeadId: string
): Promise<{ ok: boolean; status: number | null; preview: string }> {
  const url = `${terrosBase}/account/update`;
  let status: number | null = null;
  let preview = "";
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `ApiKey ${terrosKey}`,
      },
      body: JSON.stringify({
        account: { accountId, id: accountId, externalLeadId },
      }),
    });
    status = res.status;
    preview = await res.text();
    const ok = res.ok && terrosJsonBodyIndicatesSuccess(preview);
    await writeApiLog({
      operation: "webhook:terros:link-external-lead-id",
      vendor: "terros",
      method: "POST",
      url,
      hadApiKey: Boolean(terrosKey),
      status,
      ok,
      responsePreview: logPreview(preview),
    });
    return { ok, status, preview };
  } catch (e) {
    preview = e instanceof Error ? e.message : String(e);
    return { ok: false, status, preview };
  }
}

function pickExternalLeadId(account: Record<string, unknown>): string | null {
  const raw = account.externalLeadId;
  if (typeof raw === "string" && UUID_RE.test(raw.trim())) return raw.trim();
  return null;
}

/**
 * After POST /api/v1/partner/action/lead/add, Enerflo returns:
 *   { status: "success", customer_id: 12345 }
 * The ID is a numeric Enerflo v1 customer id (not a UUID). We store it as a string.
 */
function parseEnerfloCreateCustomerId(responseText: string): string | null {
  try {
    const j = JSON.parse(responseText) as Record<string, unknown>;
    // lead/add: customer_id is a number
    const numericId = j.customer_id ?? j.customerId;
    if (numericId != null) return String(numericId);
    // fallback: UUID from customer create endpoints
    const c = (j.customer ?? j.data ?? j) as Record<string, unknown>;
    // lead/add returns { data: { lead: { id: 12345 } } } — check data.lead.id too
    const leadObj = c.lead as Record<string, unknown> | undefined;
    const id = j.id ?? c.id ?? c.uuid ?? leadObj?.id;
    if (typeof id === "string" && UUID_RE.test(id)) return id;
    if (typeof id === "number") return String(id);
  } catch {
    /* ignore */
  }
  return null;
}

// Cross-platform email matching (domain aliases, middle initial, env alias map).
/**
 * Collect ALL Enerflo users (shared by email/id lookup helpers).
 * Paginates until every user is fetched — the account count has grown past
 * 1200, so a fixed page cap would silently miss reps and leave the Terros
 * owner/setter unmatched (lead lands with no Lead Owner / Setter).
 * A high safety cap prevents an infinite loop if the API misbehaves.
 */
async function fetchAllEnerfloUsers(): Promise<Record<string, unknown>[]> {
  const allUsers: Record<string, unknown>[] = [];
  // Enerflo ignores `pageSize` (caps at 100) but respects `per_page`.
  // With per_page=500 the API returns all users in a single request (tested up
  // to 1232 users). Keep the loop as a safety net for future growth.
  const PAGE_SIZE = 500;
  const MAX_PAGES = 100;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { ok, data } = await enerfloRequestParsed<unknown>({
      operation: "webhook:terros:lookup-enerflo-user-by-email",
      method: "GET",
      path: "/api/v3/users",
      query: { page: String(page), per_page: String(PAGE_SIZE) },
    });
    if (!ok || !data || typeof data !== "object") break;
    const o = data as Record<string, unknown>;
    const rows = (["results", "items", "users", "data"] as const)
      .map((k) => o[k])
      .find((v) => Array.isArray(v)) as Record<string, unknown>[] | undefined;
    if (!Array.isArray(rows) || rows.length === 0) break;
    allUsers.push(...rows);
    const total = typeof o.dataCount === "number" ? o.dataCount : undefined;
    if (total != null && allUsers.length >= total) break;
    if (rows.length < PAGE_SIZE) break;
  }
  return allUsers;
}

/**
 * Find the full Enerflo user row matching rawEmail.
 */
async function findEnerfloUserRowByEmail(
  rawEmail: string
): Promise<Record<string, unknown> | undefined> {
  const allUsers = await fetchAllEnerfloUsers();
  return findUserByEmailInList(rawEmail, allUsers, (row) =>
    typeof row.email === "string" ? row.email : undefined,
  );
}

/**
 * Verify that `email` belongs to an active Enerflo user.
 * Returns the exact Enerflo-registered email on match, or undefined.
 */
async function findEnerfloUserByEmail(rawEmail: string): Promise<string | undefined> {
  const row = await findEnerfloUserRowByEmail(rawEmail);
  return row && typeof row.email === "string" ? row.email.trim() : undefined;
}

/**
 * Find the numeric Enerflo user ID for the given email.
 * Returns null if the user is not found or has no numeric id.
 */
async function findEnerfloUserIdByEmail(rawEmail: string): Promise<number | null> {
  if (!rawEmail || !rawEmail.includes("@")) return null;
  const row = await findEnerfloUserRowByEmail(rawEmail);
  if (!row) return null;
  const rawId = row.id ?? row.user_id;
  if (rawId == null) return null;
  const numId = Number(rawId);
  return isNaN(numId) ? null : numId;
}

function parseEnerfloCustomerRows(data: unknown): Record<string, unknown>[] {
  if (!data || typeof data !== "object") return [];
  const o = data as Record<string, unknown>;
  const rows = (["results", "items", "customers", "data"] as const)
    .map((k) => o[k])
    .find((v) => Array.isArray(v)) as Record<string, unknown>[] | undefined;
  return Array.isArray(rows) ? rows : [];
}

/** Terros account id from Partner.Lead.integration_record_id or Enerflo V2 integration_maps. */
function getTerrosAccountIdFromCustomerRow(row: Record<string, unknown>): string | null {
  const partnerLead = ((row.integrations as Record<string, unknown> | undefined)
    ?.Partner as Record<string, unknown> | undefined)
    ?.Lead as Record<string, unknown> | undefined;
  const fromPartner = partnerLead?.integration_record_id;
  if (typeof fromPartner === "string" && fromPartner.trim()) return fromPartner.trim();

  for (const key of ["integration_record_id", "integrationRecordId", "external_id", "externalId"] as const) {
    const raw = row[key];
    if (typeof raw !== "string" || !raw.trim()) continue;
    const value = raw.trim();
    if (value.startsWith("Account.")) return value.slice("Account.".length);
    if (!UUID_RE.test(value)) return value;
  }

  const maps = row.integration_maps as Record<string, unknown>[] | undefined;
  if (Array.isArray(maps)) {
    for (const map of maps) {
      const extId = map.external_id as string | undefined;
      if (!extId?.trim()) continue;
      const value = extId.trim();
      if (value.startsWith("Account.")) return value.slice("Account.".length);
      if (!UUID_RE.test(value)) return value;
    }
  }
  return null;
}

function getEnerfloV2UuidFromCustomerRow(row: Record<string, unknown>): string | null {
  for (const key of ["uuid", "external_id"] as const) {
    const raw = row[key];
    if (typeof raw === "string" && UUID_RE.test(raw.trim())) return raw.trim();
  }
  const maps = row.integration_maps as Record<string, unknown>[] | undefined;
  if (Array.isArray(maps)) {
    for (const map of maps) {
      const extId = map.external_id as string | undefined;
      if (extId && UUID_RE.test(extId.trim())) return extId.trim();
    }
  }
  return null;
}

function getEnerfloNumericIdFromCustomerRow(row: Record<string, unknown>): string | null {
  const id = row.id ?? row.customer_id;
  return id != null ? String(id) : null;
}

function terrosAccountIdsMatch(a: string, b: string): boolean {
  return normalizeTerrosAccountId(a) === normalizeTerrosAccountId(b);
}

function pickBestEnerfloCustomerRow(
  rows: Record<string, unknown>[],
  terrosAccountId: string,
  customerUuidHint?: string | null
): Record<string, unknown> | null {
  const byTerros = rows.find((r) =>
    terrosAccountIdsMatch(getTerrosAccountIdFromCustomerRow(r) ?? "", terrosAccountId)
  );
  if (byTerros) return byTerros;

  if (customerUuidHint && UUID_RE.test(customerUuidHint)) {
    const byUuid = rows.find((r) => getEnerfloV2UuidFromCustomerRow(r) === customerUuidHint);
    if (byUuid) return byUuid;
  }

  if (rows.length === 1) return rows[0] ?? null;

  // Shared test emails: prefer the highest numeric id (usually the newest record).
  const withNumeric = rows
    .map((row) => ({ row, numeric: Number(getEnerfloNumericIdFromCustomerRow(row)) }))
    .filter((entry) => Number.isFinite(entry.numeric));
  if (withNumeric.length === 0) return null;
  withNumeric.sort((a, b) => b.numeric - a.numeric);
  return withNumeric[0]?.row ?? null;
}

async function findEnerfloCustomerUuidByIntegrationSearch(
  terrosAccountId: string
): Promise<string | null> {
  for (const searchTerm of [terrosAccountId, `Account.${terrosAccountId}`]) {
    const { ok, data } = await enerfloRequestParsed<unknown>({
      operation: "webhook:terros:search-customer-by-integration",
      method: "GET",
      path: "/api/v1/customers",
      query: { search: searchTerm, page: "1", pageSize: "50" },
    });
    if (!ok) continue;
    const rows = parseEnerfloCustomerRows(data);
    for (const row of rows) {
      const linked = getTerrosAccountIdFromCustomerRow(row);
      if (!linked || !terrosAccountIdsMatch(linked, terrosAccountId)) continue;
      return getEnerfloV2UuidFromCustomerRow(row) ?? getEnerfloNumericIdFromCustomerRow(row);
    }
  }
  return null;
}

/**
 * Search Enerflo v1 customers by email and return the customer ID (numeric string).
 * Disambiguates by Terros account ID when multiple customers share the same email.
 * Falls back to the sole match when there's only one result and no integration_record_id set.
 *
 * The v1 API returns numeric IDs only — handleUpdate uses v1 PATCH for non-UUID IDs.
 */
async function findEnerfloCustomerIdByEmail(
  email: string,
  terrosAccountId: string,
  customerUuidHint?: string | null
): Promise<string | null> {
  if (!email || !email.includes("@")) return null;
  const { ok, data } = await enerfloRequestParsed<unknown>({
    operation: "webhook:terros:search-customer-by-email",
    method: "GET",
    path: "/api/v1/customers",
    query: { search: email, page: "1", pageSize: "50" },
  });
  if (!ok) return null;
  const rows = parseEnerfloCustomerRows(data);

  const emailLower = email.trim().toLowerCase();
  const matched = rows.filter(
    (r) => typeof r.email === "string" && r.email.trim().toLowerCase() === emailLower
  );
  if (matched.length === 0) return null;

  const best = pickBestEnerfloCustomerRow(matched, terrosAccountId, customerUuidHint);
  return best ? getEnerfloNumericIdFromCustomerRow(best) : null;
}

async function findEnerfloNumericIdByCustomerUuid(customerUuid: string): Promise<string | null> {
  if (!UUID_RE.test(customerUuid)) return null;
  const { ok, data } = await enerfloRequestParsed<unknown>({
    operation: "webhook:terros:search-customer-by-uuid",
    method: "GET",
    path: "/api/v1/customers",
    query: { search: customerUuid, page: "1", pageSize: "50" },
  });
  if (!ok) return null;
  const rows = parseEnerfloCustomerRows(data);
  const exact = rows.find((r) => getEnerfloV2UuidFromCustomerRow(r) === customerUuid);
  if (exact) return getEnerfloNumericIdFromCustomerRow(exact);
  if (rows.length === 1) return getEnerfloNumericIdFromCustomerRow(rows[0]!);
  return null;
}

async function resolveEnerfloNumericCustomerId(
  customerUuid: string,
  terrosAccountId: string,
  residentEmail: string
): Promise<string | null> {
  if (/^\d+$/.test(customerUuid)) return customerUuid;

  if (residentEmail) {
    const byEmail = await findEnerfloCustomerIdByEmail(residentEmail, terrosAccountId, customerUuid);
    if (byEmail) return byEmail;
  }

  if (UUID_RE.test(customerUuid)) {
    const byUuid = await findEnerfloNumericIdByCustomerUuid(customerUuid);
    if (byUuid) return byUuid;
  }

  const byIntegration = await findEnerfloCustomerUuidByIntegrationSearch(terrosAccountId);
  if (byIntegration && /^\d+$/.test(byIntegration)) return byIntegration;

  return null;
}

function buildEnerfloPayloadFromTerros(
  account: TerrosAccountWebhookData,
  terrosAccountId: string,
  resolvedOwnerEmail?: string
): Record<string, unknown> {
  const r = account.resident ?? {};
  // Resident name: prefer combined first+last, fall back to full name string
  const residentFirst = (r.firstName ?? "").trim();
  const residentLast = (r.lastName ?? "").trim();
  const nameFromResident =
    (residentFirst || residentLast)
      ? [residentFirst, residentLast].filter(Boolean).join(" ")
      : (r.name ?? "").trim();
  const { address, city, state, zip } = mapAddress(account.address);
  // Customer name comes only from resident — owner is the sales rep, not the homeowner
  // If no resident name is available, use N/A as required by Enerflo's required fields
  const fullName = nameFromResident;

  // Email/phone from resident only — owner fields belong to the sales rep
  const email = (r.email ?? "").trim();
  const phone = (r.phone ?? "").trim();

  const first_name = fullName ? splitName(fullName).first_name : "N/A";
  const last_name  = fullName ? splitName(fullName).last_name  : "N/A";

  // Enerflo lead/add wraps fields under a "lead" key
  const lead: Record<string, unknown> = {
    first_name,
    last_name,
    address: address || "Unknown",
    city: city || "Unknown",
    state: state || "XX",
    zip: zip || "00000",
    integration_record_id: terrosAccountId,
    // Always use "manual" so Enerflo never falls back to the office default rep
    // (Jonas Lim) via zip routing. assign_to_email handles the explicit assignment;
    // if it doesn't match any Enerflo user the Lead Owner is left blank.
    office_match: "manual",
  };
  if (email) lead.email = email;
  if (phone) lead.mobile = phone;
  if (resolvedOwnerEmail) {
    lead.assign_to_email = resolvedOwnerEmail;
    // Account create only — same rep as Terros owner; updates do not touch setter.
    lead.setter_email = resolvedOwnerEmail;
  }
  return { lead };
}

function buildEnerfloUpdatePayload(
  account: TerrosAccountWebhookData,
  resolvedOwnerEmail?: string
): Record<string, unknown> {
  const r = account.resident ?? {};
  // Prefer combined firstName+lastName (sent by Terros update payloads);
  // fall back to the flat name string for older/add payloads.
  const residentFirst = (r.firstName ?? "").trim();
  const residentLast = (r.lastName ?? "").trim();
  const fullName = (residentFirst || residentLast)
    ? [residentFirst, residentLast].filter(Boolean).join(" ")
    : (r.name ?? "").trim();
  const email = (r.email ?? "").trim();
  const phone = (r.phone ?? "").trim();
  const { address, city, state, zip } = mapAddress(account.address);

  const body: Record<string, unknown> = {};
  if (fullName) {
    const { first_name, last_name } = splitName(fullName);
    body.first_name = first_name;
    body.last_name = last_name;
    body.name = fullName;
  }
  if (email) body.email = email;
  if (phone) body.phone = phone;
  if (address) body.address = address;
  if (city) body.city = city;
  if (state) body.state = state;
  if (zip) body.zip = zip;
  if (resolvedOwnerEmail) body.assign_to_email = resolvedOwnerEmail;
  return body;
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    description:
      "Inbound Terros webhooks (Settings → Webhooks → Entity Account + Entity Event). POST JSON from Terros here.",
    path: "/api/webhooks/terros",
    handles: [
      { entity: "Account", actions: ["add", "update"] },
      { entity: "Event",   actions: ["add"] },
    ],
    outbound: [
      "Account add: Creates an Enerflo customer via lead/add; sets assign_to_email and setter_email from the Terros account owner. Account update: assign_to_email only (does not overwrite setter). Links Terros externalLeadId after create.",
      "Event add: Creates an Enerflo appointment via POST /api/v1/appointments; resolves numeric customer ID from externalLeadId and numeric user ID from owner.email. Stamps [Enerflo:ID] back onto the Terros event notes.",
    ],
  });
}

export async function POST(req: NextRequest) {
  const secret = env.terrosWebhookSecret?.trim();
  if (secret) {
    const got =
      req.headers.get("x-terros-webhook-secret") ??
      req.headers.get("x-webhook-secret") ??
      "";
    if (got !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  let body: TerrosWebhookBody;
  try {
    body = (await req.json()) as TerrosWebhookBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const entity = (body.entity ?? "").trim();
  const action = (body.action ?? "").trim().toLowerCase();
  const data = body.data;

  const terrosKey = env.terrosApiKey ?? "";
  const terrosBase = (env.terrosApiBaseUrl ?? "https://api.terros.com").replace(/\/$/, "");

  if (!(env.enerfloV1ApiKey ?? "").trim()) {
    return NextResponse.json({
      received: true,
      skipped: true,
      reason: "ENERFLO_V1_API_KEY is not configured",
    });
  }

  // ── Terros calendar Event entity ──────────────────────────────────────────
  if (entity === "Event") {
    if (action !== "add" && action !== "update") {
      return NextResponse.json({
        received: true,
        skipped: true,
        reason: `Unsupported Event action: ${action || "(missing)"}`,
      });
    }
    const eventData = (body as unknown as TerrosEventWebhookBody).data;
    if (!eventData) {
      return NextResponse.json({
        received: true,
        skipped: true,
        reason: "Missing data for Event webhook",
      });
    }
    try {
      if (action === "update") {
        return await handleEventUpdate(terrosBase, terrosKey, eventData);
      }
      return await handleEventAdd(terrosBase, terrosKey, eventData);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await writeApiLog({
        operation: "webhook:terros:event-unhandled-error",
        vendor: "terros",
        method: "POST",
        url: `/api/webhooks/terros`,
        hadApiKey: false,
        status: 500,
        ok: false,
        responsePreview: logPreview(msg),
      });
      return NextResponse.json({ received: true, success: false, error: msg }, { status: 200 });
    }
  }

  // ── Terros Account entity ─────────────────────────────────────────────────
  if (entity !== "Account") {
    return NextResponse.json({
      received: true,
      skipped: true,
      reason: `Unsupported entity: ${entity || "(missing)"}`,
    });
  }

  if (action !== "add" && action !== "update") {
    return NextResponse.json({
      received: true,
      skipped: true,
      reason: `Unsupported action: ${action || "(missing)"}`,
    });
  }

  const terrosAccountId = (data?.id ?? "").trim();
  if (!terrosAccountId) {
    return NextResponse.json(
      { received: true, skipped: true, reason: "Missing data.id (Terros account id)" },
      { status: 200 }
    );
  }

  if (!data || typeof data !== "object") {
    return NextResponse.json({ received: true, skipped: true, reason: "Missing data object" });
  }

  // Respond to Terros immediately and do the Enerflo work in the background.
  // Terros aborts webhook delivery after ~10s; the create→update sequence plus
  // the race-condition wait and Enerflo round-trips can exceed that. Using
  // after() removes all timeout pressure: Terros gets an instant 200 while the
  // actual processing runs (bounded by maxDuration above).
  const pathname = req.nextUrl.pathname;
  after(async () => {
    try {
      if (action === "add") {
        await handleAdd(terrosBase, terrosKey, terrosAccountId, data);
      } else {
        await handleUpdate(terrosBase, terrosKey, terrosAccountId, data);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await writeApiLog({
        operation: "webhook:terros:unhandled-error",
        vendor: "terros",
        method: "POST",
        url: pathname,
        hadApiKey: false,
        status: 500,
        ok: false,
        responsePreview: logPreview(msg),
      });
    }
  });

  return NextResponse.json({ received: true, queued: true, action });
}

async function handleAdd(
  terrosBase: string,
  terrosKey: string,
  terrosAccountId: string,
  data: TerrosAccountWebhookData
): Promise<NextResponse> {
  // Fetch the full account from Terros (for resident name) in parallel with the
  // Enerflo user lookup (for owner/setter). Running them concurrently halves
  // the latency before we can create the lead and save the Supabase mapping,
  // which reduces the race-condition window for the follow-up update webhook.
  const rawOwnerEmail = data.owner?.email?.trim();
  const ownerEmailForLookup = rawOwnerEmail
    ?? (terrosKey ? await resolveTerrosOwnerEmail(terrosBase, terrosKey, data.owner) : undefined);

  const [full, verifiedOwnerEmailResult] = await Promise.all([
    terrosKey ? fetchTerrosAccountById(terrosBase, terrosKey, terrosAccountId) : Promise.resolve(null),
    ownerEmailForLookup ? findEnerfloUserByEmail(ownerEmailForLookup) : Promise.resolve(undefined),
  ]);

  let verifiedOwnerEmail: string | undefined = verifiedOwnerEmailResult ?? undefined;
  // Fall back to default owner (X Lead) if no owner could be resolved
  if (!verifiedOwnerEmail && env.defaultOwnerEmail) {
    verifiedOwnerEmail = await findEnerfloUserByEmail(env.defaultOwnerEmail) ?? env.defaultOwnerEmail;
  }

  const enrichedData: TerrosAccountWebhookData = {
    ...data,
    ...(full
      ? {
          resident: {
            ...terrosResidentFromAccount(full),
            ...data.resident, // webhook data takes precedence if it has values
          },
        }
      : {}),
  };

  const createBody = buildEnerfloPayloadFromTerros(enrichedData, terrosAccountId, verifiedOwnerEmail);

  const log = await enerfloRequest({
    operation: "webhook:terros:create-enerflo-customer",
    method: "POST",
    path: "/api/v1/partner/action/lead/add",
    body: createBody,
  });

  // Use rawResponseText (full body) not responsePreview (truncated to 500 chars) —
  // the Enerflo lead/add response is >500 chars, so the preview is not valid JSON
  // and parseEnerfloCreateCustomerId would always return null from it.
  const newId = log.rawResponseText ? parseEnerfloCreateCustomerId(log.rawResponseText) : null;

  // Save the Terros→Enerflo mapping IMMEDIATELY after the create so handleUpdate
  // (which fires within seconds) can find it via the Supabase lookup. Previously
  // this was saved at the very end (~4.5 s after the webhook arrived), causing
  // the follow-up update webhook to hit the race window and be skipped.
  if (log.ok && newId) {
    const numericIdEarly = Number(newId);
    if (Number.isFinite(numericIdEarly)) {
      await saveCustomerAccountMapping(terrosAccountId, numericIdEarly);
    }
  }

  // Resolve the Enerflo UUID from the numeric customer_id so externalLeadId on Terros
  // stores the UUID, not the numeric id. This lets deal.created / customer.created
  // find the account by UUID via account/upsert later.
  let enerfloUuid: string | null = null;
  if (log.ok && newId) {
    const residentEmail = typeof enrichedData.resident === "object" && enrichedData.resident !== null
      ? (enrichedData.resident as Record<string, unknown>).email as string | undefined
      : undefined;
    if (residentEmail) {
      const { ok: searchOk, data: searchData } = await enerfloRequestParsed<unknown>({
        operation: "webhook:terros:resolve-enerflo-uuid-after-create",
        method: "GET",
        path: "/api/v1/customers",
        query: { search: residentEmail, pageSize: "20" },
      });
      if (searchOk && searchData && typeof searchData === "object") {
        const rows = (searchData as Record<string, unknown>).data as Record<string, unknown>[] | undefined;
        if (Array.isArray(rows)) {
          const match = rows.find((r) => String(r.id) === String(newId));
          const integV2 = ((match?.integrations as Record<string, unknown> | undefined)?.["Enerflo V2"] as Record<string, unknown> | undefined)?.EnerfloV2Customer as Record<string, unknown> | undefined;
          enerfloUuid = (integV2?.integration_record_id as string | undefined) ?? null;
        }
      }
    }
  }

  const idToStore = enerfloUuid ?? newId;

  let linked: { ok: boolean; status: number | null; preview: string } | null = null;
  if (log.ok && idToStore && terrosKey) {
    linked = await terrosAccountUpdateExternalLeadId(terrosBase, terrosKey, terrosAccountId, idToStore);
  }

  return NextResponse.json({
    received: true,
    action: "add",
    terrosAccountId,
    success: log.ok,
    enerfloCustomerId: newId,
    enerfloCustomerUuid: enerfloUuid,
    externalLeadIdStored: idToStore,
    enerfloStatus: log.status,
    terrosLink: linked,
    skipped: false,
    debug: {
      rawOwnerEmail: rawOwnerEmail ?? null,
      emailForLookup: ownerEmailForLookup ?? null,
      verifiedOwnerEmail: verifiedOwnerEmail ?? null,
    },
  });
}

async function handleUpdate(
  terrosBase: string,
  terrosKey: string,
  terrosAccountId: string,
  webhookData: TerrosAccountWebhookData
): Promise<NextResponse> {
  await writeApiLog({
    operation: "webhook:terros:received-update",
    vendor: "terros",
    method: "POST",
    url: `/api/webhooks/terros`,
    hadApiKey: Boolean(terrosKey),
    status: 200,
    ok: true,
    responsePreview: JSON.stringify({ terrosAccountId, resident: webhookData.resident, externalLeadId: webhookData.externalLeadId }).slice(0, 300),
  });

  // Fast-path: Supabase mapping lookup (milliseconds, no HTTP to Terros).
  // We intentionally NEVER call fetchTerrosAccountById here — it makes up to 3
  // serial HTTP calls. The webhook payload already carries the resident and
  // address data we need.
  //
  // Race-condition guard: Terros fires the "update" webhook immediately after
  // "add", so handleAdd may still be in-flight (creating the lead + saving the
  // mapping). Poll the mapping a few times with short delays until it appears.
  // This runs in the background (after()), so there's no Terros timeout pressure
  // — we can afford to wait for a slow Enerflo create under bulk load.
  let mappedNumericId =
    (await getEnerfloCustomerIdByTerrosAccountId(terrosAccountId)) ??
    (await findEnerfloCustomerIdFromHistoricalLogs(terrosAccountId));

  const MAX_MAPPING_RETRIES = 8;
  const MAPPING_RETRY_DELAY_MS = 2000;
  for (let attempt = 0; mappedNumericId == null && attempt < MAX_MAPPING_RETRIES; attempt++) {
    await new Promise<void>(resolve => setTimeout(resolve, MAPPING_RETRY_DELAY_MS));
    mappedNumericId =
      (await getEnerfloCustomerIdByTerrosAccountId(terrosAccountId)) ??
      (await findEnerfloCustomerIdFromHistoricalLogs(terrosAccountId));
  }

  // Use webhook data directly — no Terros API fetch needed.
  const merged: TerrosAccountWebhookData = webhookData;

  let customerUuid: string | null = mappedNumericId != null ? String(mappedNumericId) : null;

  if (!customerUuid) {
    customerUuid =
      (merged.externalLeadId && UUID_RE.test(merged.externalLeadId) ? merged.externalLeadId : null) ??
      (webhookData.externalLeadId && UUID_RE.test(webhookData.externalLeadId)
        ? webhookData.externalLeadId
        : null);
  }

  if (!customerUuid) {
    customerUuid = await findEnerfloCustomerUuidByIntegrationSearch(terrosAccountId);
  }

  // Last-resort: match by resident email so manually-created records can be linked
  const residentEmail = (merged.resident?.email ?? webhookData.resident?.email ?? "").trim();
  if (!customerUuid && residentEmail) {
    customerUuid = await findEnerfloCustomerIdByEmail(residentEmail, terrosAccountId);
  }

  // Final fallback: use the raw numeric externalLeadId stored by handleAdd.
  // When an account is created in Terros without a resident (no email to resolve UUID),
  // handleAdd stores the Enerflo numeric ID directly. UUID_RE rejects it above, so we
  // pick it up here so subsequent resident-add updates can still reach Enerflo.
  if (!customerUuid) {
    const rawId = merged.externalLeadId ?? webhookData.externalLeadId ?? null;
    if (rawId && /^\d+$/.test(rawId.trim())) customerUuid = rawId.trim();
  }

  if (!customerUuid) {
    // No mapping found via any lookup. For leads created before the mapping-save fix,
    // try a lead/add upsert: Enerflo matches existing leads by integration_record_id
    // and returns "Lead Updated" with the existing ID — no duplicate is created.
    // This self-heals old unmapped accounts on their next Terros update.
    const upsertBody = buildEnerfloPayloadFromTerros(merged, terrosAccountId);
    const upsertLog = await enerfloRequest({
      operation: "webhook:terros:update-enerflo-customer",
      method: "POST",
      path: "/api/v1/partner/action/lead/add",
      body: upsertBody,
    });

    const upsertId = upsertLog.rawResponseText
      ? parseEnerfloCreateCustomerId(upsertLog.rawResponseText)
      : null;

    if (upsertLog.ok && upsertId) {
      const numericId = Number(upsertId);
      if (Number.isFinite(numericId)) {
        await saveCustomerAccountMapping(terrosAccountId, numericId);
      }
      if (terrosKey) {
        await terrosAccountUpdateExternalLeadId(terrosBase, terrosKey, terrosAccountId, upsertId);
      }
      return NextResponse.json({
        received: true,
        action: "update",
        terrosAccountId,
        enerfloCustomerId: upsertId,
        success: true,
        enerfloStatus: upsertLog.status,
        updatePath: "v1-lead-add-upsert-fallback",
      });
    }

    // Upsert also failed — truly no matching lead in Enerflo.
    await writeApiLog({
      operation: "webhook:terros:update-enerflo-customer-skipped",
      vendor: "terros",
      method: "POST",
      url: `/api/webhooks/terros`,
      hadApiKey: Boolean(terrosKey),
      status: 200,
      ok: true,
      responsePreview: JSON.stringify({
        terrosAccountId,
        reason: "no-customer-id",
        residentEmail,
        externalLeadId: merged.externalLeadId ?? webhookData.externalLeadId ?? null,
        upsertStatus: upsertLog.status,
      }).slice(0, 400),
    });
    return NextResponse.json({
      received: true,
      action: "update",
      terrosAccountId,
      skipped: true,
      reason: "No Enerflo customer found via mapping, externalLeadId, email, or lead/add upsert.",
    });
  }

  // Opportunistic UUID backfill: if the stored externalLeadId is not a UUID,
  // upgrade it when customerUuid is a real UUID (not a numeric v1 ID).
  const storedExternalLeadId = webhookData.externalLeadId ?? null;
  const customerIdIsUuid = UUID_RE.test(customerUuid);
  const needsUuidBackfill =
    terrosKey &&
    customerIdIsUuid &&
    (!storedExternalLeadId || !UUID_RE.test(storedExternalLeadId));
  if (needsUuidBackfill) {
    await terrosAccountUpdateExternalLeadId(terrosBase, terrosKey, terrosAccountId, customerUuid);
  }

  // Resolve canonical owner email (handles +alias mismatches and ID-only owner payloads)
  const ownerData = merged.owner ?? webhookData.owner;
  let resolvedOwnerEmail = terrosKey
    ? await resolveTerrosOwnerEmail(terrosBase, terrosKey, ownerData)
    : undefined;
  // Fall back to default owner (X Lead) if no owner could be resolved
  if (!resolvedOwnerEmail && env.defaultOwnerEmail) {
    resolvedOwnerEmail = await findEnerfloUserByEmail(env.defaultOwnerEmail) ?? env.defaultOwnerEmail;
  }
  const updateBody = buildEnerfloUpdatePayload(merged, resolvedOwnerEmail);
  if (Object.keys(updateBody).length === 0) {
    await writeApiLog({
      operation: "webhook:terros:update-enerflo-customer-skipped",
      vendor: "terros",
      method: "POST",
      url: `/api/webhooks/terros`,
      hadApiKey: Boolean(terrosKey),
      status: 200,
      ok: true,
      responsePreview: JSON.stringify({
        terrosAccountId,
        reason: "no-fields",
        enerfloCustomerId: customerUuid,
      }).slice(0, 400),
    });
    return NextResponse.json({
      received: true,
      action: "update",
      terrosAccountId,
      enerfloCustomerId: customerUuid,
      skipped: true,
      reason: "No address or resident fields to push after merge",
    });
  }

  // v3 PUT only accepts numeric IDs — UUIDs return 403.
  const enerfloNumericId = await resolveEnerfloNumericCustomerId(
    customerUuid,
    terrosAccountId,
    residentEmail
  );
  if (!enerfloNumericId) {
    await writeApiLog({
      operation: "webhook:terros:update-enerflo-customer-skipped",
      vendor: "terros",
      method: "POST",
      url: `/api/webhooks/terros`,
      hadApiKey: Boolean(terrosKey),
      status: 200,
      ok: true,
      responsePreview: JSON.stringify({
        terrosAccountId,
        reason: "no-numeric-customer-id",
        enerfloCustomerId: customerUuid,
        residentEmail,
      }).slice(0, 400),
    });
    return NextResponse.json({
      received: true,
      action: "update",
      terrosAccountId,
      enerfloCustomerId: customerUuid,
      skipped: true,
      reason:
        "Found Enerflo customer reference but could not resolve numeric id for v3 PUT (email/integration/UUID search).",
    });
  }

  // Try v3 customers PUT first. If Enerflo returns 403 it means this record is
  // still an unconverted lead (created via lead/add) — v3/customers only covers
  // records that have progressed to a full customer/deal. In that case fall back
  // to re-posting lead/add with the same integration_record_id, which acts as an
  // upsert and returns "Lead Updated" without creating a duplicate.
  const v3Path = `/api/v3/customers/${encodeURIComponent(enerfloNumericId)}`;
  let log = await enerfloRequest({
    operation: "webhook:terros:update-enerflo-customer",
    method: "PUT" as const,
    path: v3Path,
    body: updateBody,
  });

  let updatePath = "v3-customer-put";
  if (!log.ok && log.status === 403) {
    // Record is still a lead — use lead/add upsert via integration_record_id.
    const leadUpsertBody = buildEnerfloPayloadFromTerros(
      merged,
      terrosAccountId,
      resolvedOwnerEmail
    );
    log = await enerfloRequest({
      operation: "webhook:terros:update-enerflo-customer",
      method: "POST" as const,
      path: "/api/v1/partner/action/lead/add",
      body: leadUpsertBody,
    });
    updatePath = "v1-lead-upsert";
  }

  if (log.ok) {
    const numericId = Number(enerfloNumericId);
    if (Number.isFinite(numericId)) {
      await saveCustomerAccountMapping(terrosAccountId, numericId);
    }
  }

  return NextResponse.json({
    received: true,
    action: "update",
    terrosAccountId,
    enerfloCustomerId: customerUuid,
    enerfloNumericId,
    customerLookupSource: mappedNumericId != null ? "account-id-map" : "search",
    success: log.ok,
    enerfloStatus: log.status,
    updatePath,
    fieldsSent: Object.keys(updateBody),
    uuidBackfill: needsUuidBackfill ? "attempted" : "not-needed",
  });
}

function terrosLocationToAddress(loc: Record<string, unknown>): TerrosAddress {
  const latlng = loc.latlng as Record<string, unknown> | undefined;
  return {
    line1: typeof loc.line1 === "string" ? loc.line1 : undefined,
    line2: typeof loc.line2 === "string" ? loc.line2 : undefined,
    locality: typeof loc.locality === "string" ? loc.locality : undefined,
    countrySubd: typeof loc.countrySubd === "string" ? loc.countrySubd : undefined,
    postal1: loc.postal1 != null ? String(loc.postal1) : undefined,
    latlng:
      latlng && typeof latlng.latitude === "number" && typeof latlng.longitude === "number"
        ? { latitude: latlng.latitude, longitude: latlng.longitude }
        : undefined,
  };
}

function terrosResidentFromAccount(full: Record<string, unknown>): TerrosResident {
  const res = full.resident as Record<string, unknown> | undefined;
  if (!res) return {};
  return {
    name: typeof res.name === "string" ? res.name : undefined,
    firstName: typeof res.firstName === "string" ? res.firstName : undefined,
    lastName: typeof res.lastName === "string" ? res.lastName : undefined,
    email: typeof res.email === "string" ? res.email : undefined,
    phone: typeof res.phone === "string" ? res.phone : undefined,
  };
}

// ── handleEventAdd ────────────────────────────────────────────────────────────
/**
 * Called when Terros fires entity:"Event" action:"add".
 *
 * Flow:
 *  1. Fetch Terros account (by data.account.accountId) to get externalLeadId.
 *  2. Resolve the numeric Enerflo customer ID (POST /api/v1/appointments requires
 *     a numeric id, not a UUID). Falls back to email search when externalLeadId is a UUID.
 *  3. Resolve the numeric Enerflo user ID from data.owner.email for assigned_to.
 *  4. POST /api/v1/appointments to create the appointment in Enerflo.
 *  5. Stamp [Enerflo:{id}] back onto the Terros event notes so the reverse webhook
 *     (new_appointment coming back from Enerflo) can detect the duplicate and skip.
 */
/**
 * Convert a Terros eventDate to the format Enerflo's REST API expects:
 *   "yyyy-mm-dd hh:mm:ss"  (UTC, no timezone suffix)
 *
 * Terros sends eventDate as an ISO 8601 string with timezone offset, e.g.
 *   "2026-05-20T18:00:00.000-05:00"
 * We parse it, convert to UTC, and reformat.
 * Fallback: if the value looks like a ms timestamp we also handle that.
 */
function terrosEventDateToEnerflo(raw: string | number | undefined): string | null {
  if (raw == null || raw === "") return null;
  let d: Date;
  const n = Number(raw);
  if (!isNaN(n) && n > 1_000_000_000_000) {
    d = new Date(n);
  } else if (!isNaN(n) && n > 1_000_000_000) {
    d = new Date(n * 1000);
  } else {
    d = new Date(String(raw));
  }
  if (isNaN(d.getTime())) return null;
  // Format as "yyyy-mm-dd hh:mm:ss" UTC
  const pad = (x: number) => String(x).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    ` ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
  );
}

/**
 * Add `durationMinutes` to an Enerflo-formatted date string and return
 * the new "yyyy-mm-dd hh:mm:ss" UTC string.
 */
function addMinutesToEnerfloDate(enerfloDate: string, durationMinutes: number): string {
  const d = new Date(enerfloDate.replace(" ", "T") + "Z");
  d.setUTCMinutes(d.getUTCMinutes() + durationMinutes);
  const pad = (x: number) => String(x).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    ` ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
  );
}

/**
 * Map a Terros eventType / title to an Enerflo appointment_type ID.
 * 9164 = In-Home, 9166 = Virtual
 */
function resolveEnerfloAppointmentType(title?: string, eventType?: string): number {
  const text = `${title ?? ""} ${eventType ?? ""}`.toLowerCase();
  if (text.includes("virtual")) return 9166;
  return 9164; // default to In-Home
}

/** Extract the [Enerflo:ID] dedup marker from a Terros event payload.
 *  Terros sends the field as "note" (singular) in webhook payloads.
 */
function extractEventNoteMarker(data: TerrosEventData): string {
  return data.note ?? data.notes ?? "";
}

/**
 * Clean an email address for use as the Enerflo `user` field.
 *
 * Enerflo users are registered under @noxpwr.com. Terros may store aliases
 * with the same username but a different domain (@solarpros.io) or with
 * a +alias suffix (e.g. user+axia@solarpros.io). Strip the alias and
 * normalise the domain so Enerflo can resolve the user.
 *
 * Examples:
 *   "claytongranch+axia@solarpros.io"  → "claytongranch@noxpwr.com"
 *   "xanderdavis@solarpros.io"          → "xanderdavis@noxpwr.com"
 *   "xanderdavis@noxpwr.com"            → "xanderdavis@noxpwr.com"  (unchanged)
 */
/** Parse Enerflo POST /v1/appointments id — works even when log preview truncates JSON. */
function parseEnerfloCreateAppointmentId(responseText: string): string | null {
  if (!responseText) return null;
  const aptId = responseText.match(/"enerflo_apt_id"\s*:\s*(\d+)/)?.[1];
  if (aptId) return aptId;
  try {
    const j = JSON.parse(responseText) as Record<string, unknown>;
    const appt = (j.appointment ?? j.data ?? j) as Record<string, unknown>;
    const rawId =
      appt.id ??
      appt.appointment_id ??
      appt.enerflo_apt_id ??
      j.id ??
      j.appointment_id ??
      j.enerflo_apt_id;
    if (rawId != null) return String(rawId);
  } catch {
    const idMatch = responseText.match(/"id"\s*:\s*(\d+)/);
    if (idMatch?.[1]) return idMatch[1];
  }
  return null;
}

function cleanEmailForEnerflo(raw: string): string {
  if (!raw) return raw;
  // Strip +alias portion before @
  let email = raw.replace(/\+[^@]+(?=@)/, "");
  // Normalise domain: solarpros.io → noxpwr.com
  email = email.replace(/@solarpros\.io$/i, "@noxpwr.com");
  return email.toLowerCase().trim();
}

async function handleEventAdd(
  terrosBase: string,
  terrosKey: string,
  data: TerrosEventData
): Promise<NextResponse> {
  const terrosEventId  = (data.id ?? data.eventId ?? "").trim();
  const accountId      = (data.account?.accountId ?? "").trim();
  // Prefer attendee (Closer) email for Enerflo `user`; fall back to owner
  const assigneeEmail  = (data.attendee?.email ?? data.owner?.email ?? "").trim();
  const residentEmail  = (data.resident?.email ?? "").trim();
  const enerfloStart   = terrosEventDateToEnerflo(data.eventDate);
  const enerfloEnd     = enerfloStart
    ? addMinutesToEnerfloDate(enerfloStart, data.duration ?? 60)
    : null;
  const appointmentType = resolveEnerfloAppointmentType(data.title, data.eventType);

  // ── Dedup guard ──────────────────────────────────────────────────────────
  // Terros sends the dedup marker in "note" (singular). Check both "note" and
  // "notes" in case of payload variation, then fall back to fetching the full event.
  let eventNote = extractEventNoteMarker(data);

  if (!eventNote && terrosEventId && accountId && terrosKey) {
    try {
      const listRes = await fetch(`${terrosBase}/calendar/event/list`, {
        method:  "POST",
        headers: { "Content-Type": "application/json", Authorization: `ApiKey ${terrosKey}` },
        // size:200 — accounts with many events can otherwise truncate the list
        // before our event appears, making the dedup note check silently fail.
        body:    JSON.stringify({ accountId, size: 200 }),
      });
      const listText = await listRes.text();
      if (listRes.ok && terrosJsonBodyIndicatesSuccess(listText)) {
        const parsed = JSON.parse(listText) as Record<string, unknown>;
        const evts   = parsed.events as Record<string, unknown>[] | undefined;
        if (Array.isArray(evts)) {
          const thisEvt = evts.find(e => (e.eventId ?? e.id) === terrosEventId);
          if (thisEvt) {
            // API may return "note" or "notes"
            eventNote = String(thisEvt.note ?? thisEvt.notes ?? "");
          }
        }
      }
    } catch { /* best-effort */ }
  }

  if (/\[Enerflo:\d+\]/i.test(eventNote)) {
    await writeApiLog({
      operation: "webhook:terros:received-event-add",
      vendor: "terros",
      method: "POST",
      url: `/api/webhooks/terros`,
      hadApiKey: Boolean(terrosKey),
      status: 200,
      ok: true,
      responsePreview: JSON.stringify({
        terrosEventId, accountId, eventType: data.eventType,
        skipped: true, reason: "Event already originated from Enerflo — dedup marker found",
        notePreview: eventNote.slice(0, 100),
      }).slice(0, 400),
    });
    return NextResponse.json({ received: true, action: "event-add", skipped: true, reason: "dedup:enerflo-marker-in-note" });
  }

  // Already created Enerflo appointment for this Terros event (prior webhook or round-trip).
  if (terrosEventId) {
    const mappedId = await getEnerfloAppointmentIdByTerrosEventId(terrosEventId);
    if (mappedId != null) {
      await writeApiLog({
        operation: "webhook:terros:received-event-add",
        vendor: "terros",
        method: "POST",
        url: `/api/webhooks/terros`,
        hadApiKey: Boolean(terrosKey),
        status: 200,
        ok: true,
        responsePreview: JSON.stringify({
          terrosEventId,
          accountId,
          skipped: true,
          reason: "dedup:existing-terros-event-map",
          enerfloAppointmentId: mappedId,
        }).slice(0, 400),
      });
      return NextResponse.json({
        received: true,
        action: "event-add",
        skipped: true,
        reason: "dedup:existing-terros-event-map",
        enerfloAppointmentId: mappedId,
        terrosEventId,
      });
    }
  }

  await writeApiLog({
    operation: "webhook:terros:received-event-add",
    vendor: "terros",
    method: "POST",
    url: `/api/webhooks/terros`,
    hadApiKey: Boolean(terrosKey),
    status: 200,
    ok: true,
    responsePreview: JSON.stringify({
      terrosEventId,
      accountId,
      eventType: data.eventType,
      enerfloStart,
      enerfloEnd,
      assigneeEmail,
      assigneeEmailCleaned: assigneeEmail ? cleanEmailForEnerflo(assigneeEmail) : "",
      appointmentType,
    }).slice(0, 400),
  });

  // ── Step 1: resolve Enerflo customer (numeric ID or email) ───────────────
  // Enerflo POST /v1/appointments accepts `customer` as numeric ID or email.
  // Prefer the numeric externalLeadId from Terros; fall back to resident email.
  let enerfloCustomer: string | null = null;

  // Check inline externalLeadId in the webhook payload first (update payloads include it)
  const inlineExtId = (data.account?.externalLeadId ?? "").trim();
  if (inlineExtId && !UUID_RE.test(inlineExtId)) {
    enerfloCustomer = inlineExtId;
  } else if (accountId && terrosKey) {
    const acc = await fetchTerrosAccountById(terrosBase, terrosKey, accountId);
    if (acc) {
      const eid =
        pickExternalLeadId(acc) ??
        (typeof acc.externalLeadId === "string" ? acc.externalLeadId.trim() : null);
      if (eid && !UUID_RE.test(eid)) {
        enerfloCustomer = eid;
      }
    }
  }

  // Fall back to resident email — Enerflo accepts email as `customer` value
  if (!enerfloCustomer && residentEmail) {
    enerfloCustomer = residentEmail;
  }

  if (!enerfloCustomer) {
    return NextResponse.json({
      received: true,
      action: "event-add",
      skipped: true,
      reason: "Could not resolve Enerflo customer (no externalLeadId or resident email).",
      terrosEventId,
      accountId,
    });
  }

  // ── Step 2: POST /v1/appointments (with lock — prevent concurrent duplicates) ──
  if (terrosEventId) {
    const wonLock = await acquireTerrosEventCreateLock(terrosEventId);
    if (!wonLock) {
      for (let i = 0; i < 8; i++) {
        await new Promise<void>(resolve => setTimeout(resolve, 500));
        const mappedId = await getEnerfloAppointmentIdByTerrosEventId(terrosEventId);
        if (mappedId != null) {
          return NextResponse.json({
            received: true,
            action: "event-add",
            skipped: true,
            reason: "dedup:lock-lost-existing-map",
            enerfloAppointmentId: mappedId,
            terrosEventId,
          });
        }
      }
      return NextResponse.json({
        received: true,
        action: "event-add",
        skipped: true,
        reason: "dedup:lock-lost",
        terrosEventId,
      });
    }

    const mappedAfterLock = await getEnerfloAppointmentIdByTerrosEventId(terrosEventId);
    if (mappedAfterLock != null) {
      return NextResponse.json({
        received: true,
        action: "event-add",
        skipped: true,
        reason: "dedup:existing-terros-event-map-after-lock",
        enerfloAppointmentId: mappedAfterLock,
        terrosEventId,
      });
    }
  }

  // Required: customer, appointment_type, start, end
  // Optional: user (email of assigned closer), creator
  const cleanedAssigneeEmail = assigneeEmail ? cleanEmailForEnerflo(assigneeEmail) : "";
  const appointmentBody: Record<string, unknown> = {
    customer:         enerfloCustomer,
    appointment_type: appointmentType,
    start:            enerfloStart ?? "",
    end:              enerfloEnd ?? "",
  };
  if (cleanedAssigneeEmail) appointmentBody.user = cleanedAssigneeEmail;

  const createLog = await enerfloRequest({
    operation: "webhook:terros:create-enerflo-appointment",
    method:    "POST",
    path:      "/api/v1/appointments",
    body:      appointmentBody,
  });

  // ── Step 5: parse appointment ID from response ───────────────────────────
  const enerfloAppointmentId = parseEnerfloCreateAppointmentId(
    createLog.rawResponseText || createLog.responsePreview,
  );

  if (createLog.ok && enerfloAppointmentId && terrosEventId) {
    const numericId = Number(enerfloAppointmentId);
    if (Number.isFinite(numericId)) {
      await saveCalendarEventMapping(numericId, terrosEventId);
    }
  }

  // ── Step 6: stamp [Enerflo:ID] back onto the Terros event ───────────────
  // This lets handleNewAppointment (Enerflo → Terros direction) detect the
  // duplicate when Enerflo fires new_appointment back at us and skip creation.
  let stampOk     = false;
  let stampStatus: number | null = null;
  if (createLog.ok && enerfloAppointmentId && terrosEventId && terrosKey) {
    try {
      const r = await fetch(`${terrosBase}/calendar/event/update`, {
        method:  "POST",
        headers: { "Content-Type": "application/json", Authorization: `ApiKey ${terrosKey}` },
        body:    JSON.stringify({
          event: {
            eventId: terrosEventId,
            // Use "note" (singular) — that is the field name Terros sends back
            // in its webhook payloads, which is what our dedup guard reads.
            note:    `[Enerflo:${enerfloAppointmentId}]`,
          },
        }),
      });
      stampStatus    = r.status;
      const stampText = await r.text();
      stampOk        = r.ok && terrosJsonBodyIndicatesSuccess(stampText);
      await writeApiLog({
        operation:       "webhook:terros:stamp-enerflo-appointment-id",
        vendor:          "terros",
        method:          "POST",
        url:             `${terrosBase}/calendar/event/update`,
        hadApiKey:       Boolean(terrosKey),
        status:          stampStatus,
        ok:              stampOk,
        responsePreview: logPreview(stampText),
      });
    } catch { /* best-effort */ }
  }

  return NextResponse.json({
    received:             true,
    action:               "event-add",
    terrosEventId,
    accountId,
    enerfloCustomer,
    assigneeEmail,
    appointmentType,
    enerfloStart,
    enerfloEnd,
    appointmentCreated:   createLog.ok,
    enerfloStatus:        createLog.status,
    enerfloAppointmentId,
    stamp: { ok: stampOk, status: stampStatus },
  });
}

// ────────────────────────────────────────────────────────────────────────────
// handleEventUpdate  – Terros → Enerflo appointment rescheduling
// ────────────────────────────────────────────────────────────────────────────
async function handleEventUpdate(
  terrosBase: string,
  terrosKey: string,
  data: TerrosEventData
): Promise<NextResponse> {
  const terrosEventId  = (data.id ?? data.eventId ?? "").trim();
  const accountId      = (data.account?.accountId ?? "").trim();
  // Prefer attendee (Closer) email for Enerflo `user`; fall back to owner
  const assigneeEmail  = (data.attendee?.email ?? data.owner?.email ?? "").trim();
  const enerfloStart   = terrosEventDateToEnerflo(data.eventDate);
  const enerfloEnd     = enerfloStart
    ? addMinutesToEnerfloDate(enerfloStart, data.duration ?? 60)
    : null;

  // ── Fetch the event note (carries the [Enerflo:ID] marker) ───────────────
  // Terros sends the marker in "note" (singular). If the webhook payload omits
  // it, fetch the event from the calendar list. The marker is used below both
  // to resolve the appointment id and to detect sync echoes.
  let eventNote = extractEventNoteMarker(data);

  if (!eventNote && terrosEventId && accountId && terrosKey) {
    try {
      const listRes = await fetch(`${terrosBase}/calendar/event/list`, {
        method:  "POST",
        headers: { "Content-Type": "application/json", Authorization: `ApiKey ${terrosKey}` },
        // size:200 — see handleEventAdd; avoids truncating busy accounts.
        body:    JSON.stringify({ accountId, size: 200 }),
      });
      const listText = await listRes.text();
      if (listRes.ok && terrosJsonBodyIndicatesSuccess(listText)) {
        const parsed = JSON.parse(listText) as Record<string, unknown>;
        const evts   = parsed.events as Record<string, unknown>[] | undefined;
        if (Array.isArray(evts)) {
          const thisEvt = evts.find(e => (e.eventId ?? e.id) === terrosEventId);
          if (thisEvt) {
            eventNote = String(thisEvt.note ?? thisEvt.notes ?? "");
          }
        }
      }
    } catch { /* best-effort */ }
  }

  // ── Resolve Enerflo appointment ID ───────────────────────────────────────
  // The [Enerflo:ID] marker we stamp on Terros events is the most reliable
  // source — it embeds the exact appointment id. Parse it first, then fall back
  // to the Supabase map and the API scan below.
  let enerfloAppointmentId: number | null = null;
  const markerMatch = eventNote.match(/\[Enerflo:(\d+)\]/i);
  const markerApptId = markerMatch ? Number(markerMatch[1]) : null;

  // ── Echo guard (loop prevention) ─────────────────────────────────────────
  // A marker-bearing update that lands within EVENT_ECHO_WINDOW_MS of the
  // mapping being written is the note-stamp / sync echo, not a human action —
  // skip it so we don't ping-pong with Enerflo. Genuine reschedules arrive
  // later and fall through to the PUT.
  if (markerApptId != null && terrosEventId) {
    const mapMeta = await getCalendarEventMappingMeta(terrosEventId);
    if (mapMeta && mapMeta.ageMs < EVENT_ECHO_WINDOW_MS) {
      await writeApiLog({
        operation:       "webhook:terros:event-update-dedup",
        vendor:          "terros",
        method:          "POST",
        url:             `/api/webhooks/terros`,
        hadApiKey:       Boolean(terrosKey),
        status:          200,
        ok:              true,
        responsePreview: JSON.stringify({ terrosEventId, accountId, reason: "sync-echo-within-window", ageMs: mapMeta.ageMs, notePreview: eventNote.slice(0, 80) }).slice(0, 400),
      });
      return NextResponse.json({ received: true, action: "event-update", skipped: true, reason: "dedup:sync-echo-within-window" });
    }
  }

  // Primary: the marker, then reverse-lookup from Supabase calendar-event-id-map
  if (markerApptId != null) {
    enerfloAppointmentId = markerApptId;
  }
  if (!enerfloAppointmentId && terrosEventId) {
    enerfloAppointmentId = await getEnerfloAppointmentIdByTerrosEventId(terrosEventId);
  }

  // Fallback: scan customer appointments via Enerflo API and match by closest date
  if (!enerfloAppointmentId) {
    const inlineExtId = (data.account?.externalLeadId ?? "").trim();
    let numericCustomerId: string | null =
      (inlineExtId && !UUID_RE.test(inlineExtId)) ? inlineExtId : null;

    if (!numericCustomerId && accountId && terrosKey) {
      const acc = await fetchTerrosAccountById(terrosBase, terrosKey, accountId);
      if (acc) {
        const eid = pickExternalLeadId(acc) ?? (typeof acc.externalLeadId === "string" ? acc.externalLeadId.trim() : null);
        if (eid && !UUID_RE.test(eid)) {
          numericCustomerId = eid;
        }
      }
    }

    if (numericCustomerId && enerfloStart) {
      try {
        const enerfloBase = (process.env.ENERFLO_V1_BASE_URL ?? "https://enerflo.io").replace(/\/$/, "");
        const enerfloKey  = process.env.ENERFLO_V1_API_KEY ?? "";
        const apptRes = await fetch(
          `${enerfloBase}/api/v3/customers/${numericCustomerId}/appointments`,
          { headers: { "api-key": enerfloKey } }
        );
        if (apptRes.ok) {
          const parsed = (await apptRes.json()) as Record<string, unknown>;
          const list   = (parsed.appointments ?? parsed.data ?? parsed) as Record<string, unknown>[];
          if (Array.isArray(list) && list.length > 0) {
            const targetMs = new Date(enerfloStart.replace(" ", "T") + "Z").getTime();
            let bestDiff   = Infinity;
            let bestId: number | null = null;
            for (const appt of list) {
              const apptDate = appt.start ?? appt.appointment_date ?? appt.date;
              if (apptDate) {
                const apptMs = new Date(String(apptDate).replace(" ", "T") + (String(apptDate).includes("T") ? "" : "Z")).getTime();
                const diff   = Math.abs(apptMs - targetMs);
                if (diff < bestDiff) { bestDiff = diff; bestId = appt.id != null ? Number(appt.id) : null; }
              }
            }
            if (bestId != null) enerfloAppointmentId = bestId;
          }
        }
      } catch { /* best-effort */ }
    }
  }

  if (!enerfloAppointmentId) {
    await writeApiLog({
      operation:       "webhook:terros:event-update-no-appt-id",
      vendor:          "terros",
      method:          "POST",
      url:             `/api/webhooks/terros`,
      hadApiKey:       Boolean(terrosKey),
      status:          200,
      ok:              false,
      responsePreview: JSON.stringify({ terrosEventId, accountId, reason: "could-not-resolve-enerflo-appointment-id" }).slice(0, 400),
    });
    return NextResponse.json({
      received:     true,
      action:       "event-update",
      skipped:      true,
      reason:       "Could not resolve Enerflo appointment ID",
      terrosEventId,
    });
  }

  // ── PUT /v1/appointments/{id} ─────────────────────────────────────────────
  // Enerflo update accepts: start, end (yyyy-mm-dd hh:mm:ss UTC), user (email)
  const cleanedAssigneeEmail = assigneeEmail ? cleanEmailForEnerflo(assigneeEmail) : "";
  const updateBody: Record<string, unknown> = {};
  if (enerfloStart)          updateBody.start = enerfloStart;
  if (enerfloEnd)            updateBody.end   = enerfloEnd;
  if (cleanedAssigneeEmail)  updateBody.user  = cleanedAssigneeEmail;

  const updateLog = await enerfloRequest({
    operation: "webhook:terros:update-enerflo-appointment",
    method:    "PUT",
    path:      `/api/v1/appointments/${enerfloAppointmentId}`,
    body:      updateBody,
  });

  return NextResponse.json({
    received:               true,
    action:                 "event-update",
    terrosEventId,
    accountId,
    enerfloAppointmentId,
    assigneeEmail,
    enerfloStart,
    enerfloEnd,
    enerfloStatus:          updateLog.status,
    enerfloOk:              updateLog.ok,
    enerfloResponsePreview: updateLog.responsePreview,
  });
}
