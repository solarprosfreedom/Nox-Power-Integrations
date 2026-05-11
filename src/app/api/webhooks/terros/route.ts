import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { enerfloRequest, enerfloRequestParsed } from "@/lib/enerflo/client";
import { writeApiLog } from "@/lib/logger";

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
    const id = j.id ?? c.id ?? c.uuid;
    if (typeof id === "string" && UUID_RE.test(id)) return id;
    if (typeof id === "number") return String(id);
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Verify that `email` belongs to an active Enerflo user by searching
 * GET /api/v3/users (paginates up to 3 pages of 100 users).
 *
 * Tries both the raw email (e.g. "user+axia@domain.com") AND the alias-stripped
 * version (e.g. "user@domain.com") because Enerflo has a mix — some reps are
 * registered with +axia in their email, others without.
 *
 * Returns the exact Enerflo-registered email on match, or undefined.
 */
async function findEnerfloUserByEmail(rawEmail: string): Promise<string | undefined> {
  const stripped = stripEmailAlias(rawEmail.trim());
  const candidates = [rawEmail.trim().toLowerCase(), stripped.toLowerCase()].filter(
    (e, i, arr) => e && arr.indexOf(e) === i
  );

  // Collect all users up to 3 pages then search
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

  for (const candidate of candidates) {
    for (const row of allUsers) {
      const rowEmail =
        typeof row.email === "string" ? row.email.trim().toLowerCase() : null;
      if (rowEmail && rowEmail === candidate) {
        return typeof row.email === "string" ? row.email.trim() : rawEmail;
      }
    }
  }
  return undefined;
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
    const ext =
      row.integration_record_id ??
      row.integrationRecordId ??
      row.external_id ??
      row.externalId;
    if (typeof ext === "string" && ext === terrosAccountId) {
      const id = row.id ?? row.uuid ?? row.customer_id;
      if (typeof id === "string" && UUID_RE.test(id)) return id;
    }
  }
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
  if (resolvedOwnerEmail) lead.assign_to_email = resolvedOwnerEmail;
  return { lead };
}

function buildEnerfloUpdatePayload(
  account: TerrosAccountWebhookData,
  resolvedOwnerEmail?: string
): Record<string, unknown> {
  const r = account.resident ?? {};
  const fullName = (r.name ?? "").trim();
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
      "Inbound Terros webhooks (Settings → Webhooks → Entity Account). POST JSON from Terros here.",
    path: "/api/webhooks/terros",
    handles: { entity: "Account", actions: ["add", "update"] },
    outbound:
      "Creates or updates an Enerflo customer via REST; resolves the Terros account owner's canonical email via /user/get (supports email or id-only owner payloads) and sets `assign_to_email`. Links Terros externalLeadId after create.",
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

  const terrosKey = env.terrosApiKey ?? "";
  const terrosBase = (env.terrosApiBaseUrl ?? "https://api.terros.com").replace(/\/$/, "");

  if (!(env.enerfloV1ApiKey ?? "").trim()) {
    return NextResponse.json({
      received: true,
      skipped: true,
      reason: "ENERFLO_V1_API_KEY is not configured",
    });
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

  if (!customerUuid) {
    return NextResponse.json({
      received: true,
      action: "update",
      terrosAccountId,
      skipped: true,
      reason:
        "No Enerflo customer id found (externalLeadId on Terros, or v1 customer with matching integration_record_id). Create from Enerflo first, or let an Account add webhook create the customer and link.",
    });
  }

  // Opportunistic UUID backfill: if the stored externalLeadId is a numeric v1 ID
  // (not a UUID), upgrade it now so future deal.created upserts can find the account.
  const storedExternalLeadId =
    (typeof full?.externalLeadId === "string" ? full.externalLeadId : null) ??
    webhookData.externalLeadId ??
    null;
  const needsUuidBackfill =
    terrosKey &&
    customerUuid &&
    (!storedExternalLeadId || !UUID_RE.test(storedExternalLeadId));
  if (needsUuidBackfill) {
    await terrosAccountUpdateExternalLeadId(terrosBase, terrosKey, terrosAccountId, customerUuid);
  }

  // Resolve canonical owner email (handles +alias mismatches and ID-only owner payloads)
  const ownerData = merged.owner ?? webhookData.owner;
  const resolvedOwnerEmail = terrosKey
    ? await resolveTerrosOwnerEmail(terrosBase, terrosKey, ownerData)
    : undefined;
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

  // Use v3 UUID path when id looks like a UUID, otherwise fall back to v1 customer PATCH.
  const isUuid = UUID_RE.test(customerUuid);
  const path = isUuid
    ? `/api/v3/customers/${encodeURIComponent(customerUuid)}`
    : `/api/v1/customers/${encodeURIComponent(customerUuid)}`;
  const method = isUuid ? "PUT" : "PATCH" as const;
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
    email: typeof res.email === "string" ? res.email : undefined,
    phone: typeof res.phone === "string" ? res.phone : undefined,
  };
}
