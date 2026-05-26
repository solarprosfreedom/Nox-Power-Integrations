import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { enerfloRequest, enerfloRequestParsed } from "@/lib/enerflo/client";
import { writeApiLog, getEnerfloAppointmentIdByTerrosEventId, acquireTerrosEventCreateLock, saveCalendarEventMapping } from "@/lib/logger";
import { findUserByEmailInList } from "@/lib/sync/user-email-match";

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

  const url = `${terrosBase}/user/get`;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `ApiKey ${terrosKey}`,
  };

  // Try email lookup first, then ID-based lookups
  const bodies: Record<string, unknown>[] = [];
  if (rawEmail && rawEmail.includes("@")) bodies.push({ email: rawEmail });
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

  // Fall back to alias-stripped raw email so assignment is still attempted
  return rawEmail && rawEmail.includes("@") ? stripEmailAlias(rawEmail) : undefined;
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
/** Collect all Enerflo users up to 3 pages of 100 (shared by email/id lookup helpers). */
async function fetchAllEnerfloUsers(): Promise<Record<string, unknown>[]> {
  const allUsers: Record<string, unknown>[] = [];
  for (let page = 1; page <= 3; page++) {
    const { ok, data } = await enerfloRequestParsed<unknown>({
      operation: "webhook:terros:lookup-enerflo-user-by-email",
      method: "GET",
      path: "/api/v3/users",
      query: { page: String(page), pageSize: "100" },
    });
    if (!ok || !data || typeof data !== "object") break;
    const o = data as Record<string, unknown>;
    const rows = (["results", "items", "users", "data"] as const)
      .map((k) => o[k])
      .find((v) => Array.isArray(v)) as Record<string, unknown>[] | undefined;
    if (!Array.isArray(rows) || rows.length === 0) break;
    allUsers.push(...rows);
    if (rows.length < 100) break;
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

async function findEnerfloCustomerUuidByIntegrationSearch(
  terrosAccountId: string
): Promise<string | null> {
  const { ok, data } = await enerfloRequestParsed<unknown>({
    operation: "webhook:terros:search-customer-by-integration",
    method: "GET",
    path: "/api/v1/customers",
    query: { search: terrosAccountId, page: "1", pageSize: "50" },
  });
  if (!ok || !data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  const rows = (["results", "items", "customers", "data"] as const)
    .map((k) => o[k])
    .find((v) => Array.isArray(v)) as Record<string, unknown>[] | undefined;
  if (!Array.isArray(rows)) return null;
  for (const row of rows) {
    // Enerflo stores the Terros account ID at integrations.Partner.Lead.integration_record_id
    const partnerLead = ((row.integrations as Record<string, unknown> | undefined)
      ?.Partner as Record<string, unknown> | undefined)
      ?.Lead as Record<string, unknown> | undefined;
    const ext = partnerLead?.integration_record_id ??
      row.integration_record_id ??
      row.integrationRecordId ??
      row.external_id ??
      row.externalId;
    if (typeof ext === "string" && ext === terrosAccountId) {
      const id = row.id ?? row.uuid ?? row.customer_id;
      if (id != null) return String(id);
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
  terrosAccountId: string
): Promise<string | null> {
  if (!email || !email.includes("@")) return null;
  const { ok, data } = await enerfloRequestParsed<unknown>({
    operation: "webhook:terros:search-customer-by-email",
    method: "GET",
    path: "/api/v1/customers",
    query: { search: email, page: "1", pageSize: "50" },
  });
  if (!ok || !data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  const rows = (["results", "items", "customers", "data"] as const)
    .map((k) => o[k])
    .find((v) => Array.isArray(v)) as Record<string, unknown>[] | undefined;
  if (!Array.isArray(rows)) return null;

  const emailLower = email.trim().toLowerCase();
  const matched = rows.filter(
    (r) => typeof r.email === "string" && r.email.trim().toLowerCase() === emailLower
  );
  if (matched.length === 0) return null;

  // Prefer the row whose integration_record_id matches the Terros account ID
  const exact = matched.find((r) => {
    const partnerIntegId = ((r.integrations as Record<string, unknown> | undefined)
      ?.Partner as Record<string, unknown> | undefined)
      ?.Lead as Record<string, unknown> | undefined;
    return partnerIntegId?.integration_record_id === terrosAccountId;
  });

  const best = exact ?? (matched.length === 1 ? matched[0] : null);
  if (!best) return null; // multiple matches, none linked — ambiguous
  const id = best.id ?? best.customer_id;
  return id != null ? String(id) : null;
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
  if (resolvedOwnerEmail) lead.assign_to_email = resolvedOwnerEmail;
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
      "Account add/update: Creates or updates an Enerflo customer via REST; resolves the Terros account owner's canonical email via /user/get and sets assign_to_email. Links Terros externalLeadId after create.",
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

  try {
    if (action === "add") {
      return await handleAdd(terrosBase, terrosKey, terrosAccountId, data);
    }
    return await handleUpdate(terrosBase, terrosKey, terrosAccountId, data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await writeApiLog({
      operation: "webhook:terros:unhandled-error",
      vendor: "terros",
      method: "POST",
      url: `${req.nextUrl.pathname}`,
      hadApiKey: false,
      status: 500,
      ok: false,
      responsePreview: logPreview(msg),
    });
    return NextResponse.json({ received: true, success: false, error: msg }, { status: 200 });
  }
}

async function handleAdd(
  terrosBase: string,
  terrosKey: string,
  terrosAccountId: string,
  data: TerrosAccountWebhookData
): Promise<NextResponse> {
  const resolvedOwnerEmail = terrosKey
    ? await resolveTerrosOwnerEmail(terrosBase, terrosKey, data.owner)
    : undefined;

  // Use the raw Terros owner email for the Enerflo user lookup so
  // findEnerfloUserByEmail can try BOTH the +alias form and the stripped form.
  // (Some reps are registered in Enerflo with +axia, others without.)
  const rawOwnerEmail = data.owner?.email?.trim();
  const emailForLookup = rawOwnerEmail ?? resolvedOwnerEmail;
  let verifiedOwnerEmail: string | undefined;
  if (emailForLookup) {
    verifiedOwnerEmail = await findEnerfloUserByEmail(emailForLookup);
  }
  // Fall back to default owner (X Lead) if no owner could be resolved
  if (!verifiedOwnerEmail && env.defaultOwnerEmail) {
    verifiedOwnerEmail = await findEnerfloUserByEmail(env.defaultOwnerEmail) ?? env.defaultOwnerEmail;
  }

  const createBody = buildEnerfloPayloadFromTerros(data, terrosAccountId, verifiedOwnerEmail);

  const log = await enerfloRequest({
    operation: "webhook:terros:create-enerflo-customer",
    method: "POST",
    path: "/api/v1/partner/action/lead/add",
    body: createBody,
  });

  const newId = log.responsePreview ? parseEnerfloCreateCustomerId(log.responsePreview) : null;

  // Resolve the Enerflo UUID from the numeric customer_id so externalLeadId on Terros
  // stores the UUID, not the numeric id. This lets deal.created / customer.created
  // find the account by UUID via account/upsert later.
  let enerfloUuid: string | null = null;
  if (log.ok && newId) {
    const residentEmail = typeof data.resident === "object" && data.resident !== null
      ? (data.resident as Record<string, unknown>).email as string | undefined
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
      emailForLookup: emailForLookup ?? null,
      resolvedOwnerEmail: resolvedOwnerEmail ?? null,
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

  let full: Record<string, unknown> | null = null;
  if (terrosKey) {
    full = await fetchTerrosAccountById(terrosBase, terrosKey, terrosAccountId);
  }

  const merged: TerrosAccountWebhookData = {
    ...webhookData,
    ...(full
      ? {
          address: {
            ...(typeof full.location === "object" && full.location
              ? terrosLocationToAddress(full.location as Record<string, unknown>)
              : typeof full.address === "object" && full.address
                ? (full.address as TerrosAddress)
                : {}),
            ...webhookData.address,
          },
          resident: {
            ...terrosResidentFromAccount(full),
            ...webhookData.resident,
          },
          externalLeadId:
            (typeof full.externalLeadId === "string" ? full.externalLeadId : undefined) ??
            webhookData.externalLeadId,
        }
      : {}),
  };

  let customerUuid =
    (merged.externalLeadId && UUID_RE.test(merged.externalLeadId) ? merged.externalLeadId : null) ??
    (webhookData.externalLeadId && UUID_RE.test(webhookData.externalLeadId)
      ? webhookData.externalLeadId
      : null) ??
    (full ? pickExternalLeadId(full) : null);

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
    const rawId =
      merged.externalLeadId ??
      webhookData.externalLeadId ??
      (typeof full?.externalLeadId === "string" ? full.externalLeadId : null);
    if (rawId && /^\d+$/.test(rawId.trim())) customerUuid = rawId.trim();
  }

  if (!customerUuid) {
    return NextResponse.json({
      received: true,
      action: "update",
      terrosAccountId,
      skipped: true,
      reason:
        "No Enerflo customer id found (externalLeadId on Terros, integration_record_id search, or email match). Ensure the customer exists in both systems with the same email.",
    });
  }

  // Opportunistic UUID backfill: if the stored externalLeadId is not a UUID,
  // upgrade it when customerUuid is a real UUID (not a numeric v1 ID).
  const storedExternalLeadId =
    (typeof full?.externalLeadId === "string" ? full.externalLeadId : null) ??
    webhookData.externalLeadId ??
    null;
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
    return NextResponse.json({
      received: true,
      action: "update",
      terrosAccountId,
      enerfloCustomerId: customerUuid,
      skipped: true,
      reason: "No address or resident fields to push after merge",
    });
  }

  // v3 PUT only accepts numeric IDs — UUIDs return 403. If customerUuid is a UUID,
  // resolve the numeric ID via email search before calling the update endpoint.
  let enerfloNumericId: string = customerUuid;
  if (UUID_RE.test(customerUuid) && residentEmail) {
    const numericId = await findEnerfloCustomerIdByEmail(residentEmail, terrosAccountId);
    if (numericId) enerfloNumericId = numericId;
  }

  const path = `/api/v3/customers/${encodeURIComponent(enerfloNumericId)}`;
  const method = "PUT" as const;
  const log = await enerfloRequest({
    operation: "webhook:terros:update-enerflo-customer",
    method,
    path,
    body: updateBody,
  });

  return NextResponse.json({
    received: true,
    action: "update",
    terrosAccountId,
    enerfloCustomerId: customerUuid,
    enerfloNumericId,
    success: log.ok,
    enerfloStatus: log.status,
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
  const terrosEventId  = (data.id ?? "").trim();
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
        body:    JSON.stringify({ accountId }),
      });
      if (listRes.ok) {
        const parsed = JSON.parse(await listRes.text()) as Record<string, unknown>;
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
      await new Promise<void>(resolve => setTimeout(resolve, 400));
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
  let enerfloAppointmentId: string | null = null;
  if (createLog.responsePreview) {
    try {
      const j    = JSON.parse(createLog.responsePreview) as Record<string, unknown>;
      const appt = (j.appointment ?? j.data ?? j) as Record<string, unknown>;
      const rawId = appt.id ?? appt.appointment_id ?? j.id ?? j.appointment_id;
      if (rawId != null) enerfloAppointmentId = String(rawId);
    } catch { /* ignore */ }
  }

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
  const terrosEventId  = (data.id ?? "").trim();
  const accountId      = (data.account?.accountId ?? "").trim();
  // Prefer attendee (Closer) email for Enerflo `user`; fall back to owner
  const assigneeEmail  = (data.attendee?.email ?? data.owner?.email ?? "").trim();
  const enerfloStart   = terrosEventDateToEnerflo(data.eventDate);
  const enerfloEnd     = enerfloStart
    ? addMinutesToEnerfloDate(enerfloStart, data.duration ?? 60)
    : null;

  // ── Dedup guard ──────────────────────────────────────────────────────────
  // Terros sends the dedup marker in "note" (singular). If the event originated
  // from Enerflo, the update is just the echo — skip to prevent a loop.
  let eventNote = extractEventNoteMarker(data);

  if (!eventNote && terrosEventId && accountId && terrosKey) {
    try {
      const listRes = await fetch(`${terrosBase}/calendar/event/list`, {
        method:  "POST",
        headers: { "Content-Type": "application/json", Authorization: `ApiKey ${terrosKey}` },
        body:    JSON.stringify({ accountId }),
      });
      if (listRes.ok) {
        const parsed = JSON.parse(await listRes.text()) as Record<string, unknown>;
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

  if (/\[Enerflo:\d+\]/i.test(eventNote)) {
    await writeApiLog({
      operation:       "webhook:terros:event-update-dedup",
      vendor:          "terros",
      method:          "POST",
      url:             `/api/webhooks/terros`,
      hadApiKey:       Boolean(terrosKey),
      status:          200,
      ok:              true,
      responsePreview: JSON.stringify({ terrosEventId, accountId, reason: "originated-from-enerflo", notePreview: eventNote.slice(0, 80) }).slice(0, 400),
    });
    return NextResponse.json({ received: true, action: "event-update", skipped: true, reason: "dedup:enerflo-marker-in-note" });
  }

  // ── Resolve Enerflo appointment ID ───────────────────────────────────────
  // Primary: reverse-lookup from Supabase calendar-event-id-map
  let enerfloAppointmentId: number | null = null;
  if (terrosEventId) {
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
