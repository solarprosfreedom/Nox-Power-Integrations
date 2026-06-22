/**
 * POST /api/webhooks/enerflo-v2
 *
 * Receives real Enerflo v2 webhook payloads and routes each event to the
 * appropriate handler. Some events require multi-step API calls (e.g. resolving
 * a Terros user ID from an Enerflo user UUID) which the generic automation
 * engine cannot handle — those live here.
 *
 * How to subscribe in Enerflo:
 *   https://{partner}.enerflo.io/settings/webhooks
 *   → point the URL to: https://<your-domain>/api/webhooks/enerflo-v2
 *
 * Event routing (first match): `x-enerflo-event` header, `?event=` query param,
 * or root JSON `event` — Enerflo v2 webhooks send `"event":"deal.projectSubmitted"`.
 */

import { NextRequest, NextResponse } from "next/server";
import { writeApiLog, acquireCalendarEventLock, acquireAppointmentStageLock, acquireCustomerCreatedLock, saveCalendarEventMapping, getCalendarEventId, saveCustomerAccountMapping, getTerrosAccountIdByEnerfloNumericId } from "@/lib/logger";
import {
  getEnerfloCustomerUuid,
  getEnerfloIntegrationExternalId,
  getTerrosAccountIdFromIntegrationMaps,
  resolveTerrosAccountForInstalls,
} from "@/lib/sync/account-matcher";
import { env } from "@/lib/env";
import { resolveEnerfloCustomerLeadOwner } from "@/lib/sync/enerflo-lead-owner";
import { createTerrosSearchCache } from "@/lib/sync/terros-accounts";
import { resolveTerrosUserIdByEmail } from "@/lib/sync/terros-users";

// ── Types ─────────────────────────────────────────────────────────────────

interface ProjectAddress {
  line1?: string;
  line2?: string | null;
  line3?: string | null;
  city?: string;
  state?: string;
  postalCode?: number | string;
  fullAddress?: string;
  lat?: number;
  lng?: number;
}

interface ProjectSubmittedPayload {
  targetOrg: string;
  initiatedBy: string;
  deal: {
    id: string;
    shortCode: string;
    state: Record<string, unknown> & { financingStatus?: string };
    salesRep?: { id?: string };
  };
  customer: {
    id: string;
    firstName: string;
    lastName: string;
  };
  proposal?: {
    id?: string;
    financeProduct?: { name?: string };
    design?: { totalSystemSizeWatts?: number };
    pricingOutputs?: {
      deal?: { projectAddress?: ProjectAddress };
      design?: {
        totalSystemSizeWatts?: number;
        firstYearProduction?: number;
        arrays?: { moduleCount?: number; module?: { name?: string; capacity?: number } }[];
        inverters?: { name?: string }[];
        batteryCount?: number;
        mountingType?: string;
        offset?: number;
        consumptionProfile?: {
          annualConsumption?: number;
          averageMonthlyBill?: number;
          utility?: { name?: string };
        };
      };
      financeProduct?: { name?: string };
      totalSystemSizeWatts?: number;
      netPPW?: number;
      netCost?: number;
      grossCost?: number;
      grossPPW?: number;
      downPayment?: number;
      dealerFeePercent?: number;
      federalRebateTotal?: number;
    };
  };
}

interface CustomerAddress {
  line1?: string;
  line2?: string | null;
  line3?: string | null;
  city?: string;
  state?: string;
  postalCode?: number | string;
  fullAddress?: string;
  lat?: number;
  lng?: number;
}

/** Nested user refs sometimes appear on v2 payloads (camelCase/snake_case). */
interface EnerfloWebhookUserRef {
  id?: string;
  uuid?: string;
  userId?: string;
  email?: string;
  Email?: string;
}

interface CustomerCreatedPayload {
  targetOrg: string;
  initiatedBy: string;
  /** Some tenants send lead owner at root as well as under `customer`. */
  leadOwner?: EnerfloWebhookUserRef;
  lead_owner?: EnerfloWebhookUserRef;
  leadOwnerUser?: EnerfloWebhookUserRef;
  lead_owner_user?: EnerfloWebhookUserRef;
  customer: {
    id: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    mobile?: string;
    address?: CustomerAddress;
    leadOwner?: EnerfloWebhookUserRef;
    lead_owner?: EnerfloWebhookUserRef;
    leadOwnerUser?: EnerfloWebhookUserRef;
    lead_owner_user?: EnerfloWebhookUserRef;
    /** Ignored for Terros owner — use lead-owner keys above. Enerflo may still send `salesRep` / `owner`. */
    salesRep?: EnerfloWebhookUserRef;
    sales_rep?: EnerfloWebhookUserRef;
  };
}

interface DealCreatedPayload {
  targetOrg: string;
  initiatedBy: string;
  deal: {
    id: string;
    shortCode?: string;
    customer: {
      id: string;
      firstName?: string;
      lastName?: string;
      email?: string;
    };
    salesRep?: { id?: string };
  };
}

interface CustomerUpdatedV2Payload {
  targetOrg: string;
  initiatedBy: string;
  current: {
    id: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    mobile?: string;
    address?: CustomerAddress;
  };
  previous: {
    id: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    mobile?: string;
    address?: CustomerAddress;
  };
  changes: Record<string, unknown>;
}

/** Enerflo v1 update_customer payload (webhook_event at root, flat structure) */
interface UpdateCustomerPayload {
  webhook_event: string;
  id: number | string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  external_id?: string | null;
  status?: string | null;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
    county?: string;
    full_address?: string;
    latitude?: string;
    longitude?: string;
  };
  customer_timezone?: string;
  lead_source?: string;
  timestamps?: { created_at?: string; updated_at?: string };
}

interface NewAppointmentPayload {
  id: number;
  status: string;
  length_minutes: number;
  appointment_type: { id: number; name: string; status?: string };
  times: {
    iso8601: { start_time: string; end_time: string };
    unix: { unix_time: number; unix_time_end: number };
  };
  deal_id: number | null;
  customer: {
    id: number | string;
    first_name?: string;
    last_name?: string;
    email?: string;
    phone?: string;
    address?: {
      street?: string;
      city?: string;
      state?: string;
      zip?: string;
      full_address?: string;
      latitude?: string;
      longitude?: string;
    };
  };
  assignee: {
    id: number;
    email: string;
    first_name?: string;
    last_name?: string;
  };
  creator?: {
    id: number;
    email?: string;
    first_name?: string;
    last_name?: string;
  };
  external_notes?: string | null;
  internal_notes?: string | null;
}

interface StepResult {
  step: string;
  ok: boolean;
  status: number | null;
  data?: unknown;
  error?: string;
  [key: string]: unknown;
}

/** True if any `TERROS_CF_*` env var is set (Terros custom field definition IDs). */
function terrosCustomFieldEnvHasAnyMapping(): boolean {
  const ids = [
    env.terrosCfEnerfloDealId,
    env.terrosCfEnerfloShortCode,
    env.terrosCfProposalId,
    env.terrosCfSystemSizeKw,
    env.terrosCfFirstYearProductionKwh,
    env.terrosCfNetPpw,
    env.terrosCfPanelCount,
    env.terrosCfFinanceProduct,
    env.terrosCfNetCost,
    env.terrosCfGrossCost,
    env.terrosCfGrossPpw,
    env.terrosCfDownPayment,
    env.terrosCfDealerFee,
    env.terrosCfFederalRebate,
    env.terrosCfUtilityCompany,
    env.terrosCfAnnualConsumption,
    env.terrosCfAvgMonthlyBill,
    env.terrosCfSolarOffset,
    env.terrosCfPanelModel,
    env.terrosCfPanelWattage,
    env.terrosCfInverterModel,
    env.terrosCfMountingType,
    env.terrosCfBatteryCount,
    env.terrosCfFinancingStatus,
  ];
  return ids.some((s) => s != null && String(s).trim() !== "");
}

// ── GET — health check / discovery ────────────────────────────────────────

export async function GET() {
  return NextResponse.json({
    ok: true,
    description:
      "Enerflo v2 webhook POST. Enerflo includes root-level \"event\"; optional header x-enerflo-event or ?event= for tests.",
    supportedEvents: ["deal.projectSubmitted", "deal.created", "customer.created", "customer.updated.v2", "new_appointment", "update_appointment", "update_customer", "new_customer"],
  });
}

// ── POST — main handler ────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const eventName =
    req.headers.get("x-enerflo-event") ??
    req.nextUrl.searchParams.get("event") ??
    (typeof body.event         === "string" ? body.event         : null) ??
    // Appointment webhooks (new_appointment / update_appointment) use webhook_event at root
    (typeof body.webhook_event === "string" ? body.webhook_event : "") ;

  // v2 payloads are wrapped in a `payload` key; appointment payloads are flat at root
  const payload = (body.payload ?? body) as Record<string, unknown>;

  switch (eventName) {
    case "deal.projectSubmitted":
      return handleProjectSubmitted(payload as unknown as ProjectSubmittedPayload);

    case "deal.created":
      return handleDealCreated(payload as unknown as DealCreatedPayload);

    case "customer.created":
      return handleCustomerCreated(payload as unknown as CustomerCreatedPayload);

    case "customer.updated.v2":
      return handleCustomerUpdatedV2(payload as unknown as CustomerUpdatedV2Payload);

    case "new_appointment":
      try {
        return await handleNewAppointment(body as unknown as NewAppointmentPayload);
      } catch (err) {
        console.error("[new_appointment] unhandled error:", err);
        return NextResponse.json({ received: true, event: "new_appointment", error: String(err) }, { status: 200 });
      }

    case "update_appointment":
      try {
        return await handleUpdateAppointment(body as unknown as NewAppointmentPayload);
      } catch (err) {
        console.error("[update_appointment] unhandled error:", err);
        return NextResponse.json({ received: true, event: "update_appointment", error: String(err) }, { status: 200 });
      }

    case "update_customer":
    case "new_customer":
      return handleUpdateCustomer(body as unknown as UpdateCustomerPayload);

    default:
      return NextResponse.json({
        received: true,
        event: eventName || "(unknown)",
        message: "No handler registered for this event.",
      });
  }
}

// ── deal.projectSubmitted ─────────────────────────────────────────────────
/**
 * Flow (steps 1-2 are best-effort and will NOT stop account creation):
 *  1b [best-effort] Rep email: GET survey by deal id → numeric agent → user email,
 *                   else match salesRep / initiatedBy UUIDs against /api/v3/users
 *  2  [best-effort] Resolve Terros userId by rep email → ownerId on account
 *  3a [best-effort] Check if Terros account already exists for this deal
 *  3b [required]    Create or update Terros account (payload name/address/deal id)
 */
async function handleProjectSubmitted(
  payload: ProjectSubmittedPayload
): Promise<NextResponse> {
  const steps: StepResult[] = [];
  const enerfloBase = (env.enerfloV1BaseUrl ?? "https://enerflo.io").replace(/\/$/, "");
  const terrosBase  = (env.terrosApiBaseUrl  ?? "https://api.terros.com").replace(/\/$/, "");
  const enerfloKey  = env.enerfloV1ApiKey ?? "";
  const terrosKey        = env.terrosApiKey              ?? "";
  const terrosWorkflowId   = env.terrosWorkflowId              ?? "";
  const terrosStartStage   = env.terrosWorkflowStartStageId    ?? "";
  const knockStageId       = env.terrosWorkflowKnockStageId    ?? "";
  const terrosClosedStageId = env.terrosWorkflowClosedStageId  ?? "";

  const initiatedBy = payload.initiatedBy ?? "";
  const salesRepUuid = payload.deal?.salesRep?.id ? String(payload.deal.salesRep.id) : "";
  /** Prefer sales rep; fall back to submitter — used for logging / Terros when email resolves */
  const repLookupId = salesRepUuid || initiatedBy;

  const dealId        = payload.deal?.id ?? "";
  const dealShortCode = payload.deal?.shortCode ?? "";
  const customerName  = `${payload.customer?.firstName ?? ""} ${payload.customer?.lastName ?? ""}`.trim();
  const systemSizeWatts = readTotalSystemSizeWatts(payload);
  const systemSizeKw    = systemSizeWatts > 0 ? systemSizeWatts / 1000 : null;

  // ── Pull address directly from the payload (always present on projectSubmitted) ──
  const pa = payload.proposal?.pricingOutputs?.deal?.projectAddress;
  const projectLine1 =
    pa?.line1 != null && String(pa.line1).trim() !== "" ? String(pa.line1).trim() : "";
  let customerAddress = pa?.fullAddress
    ? String(pa.fullAddress)
    : [pa?.line1, pa?.line2, pa?.line3]
        .filter((x) => x != null && String(x).trim() !== "")
        .map(String)
        .join(" ");
  let customerCity    = pa?.city    ? String(pa.city)                      : "";
  let customerState   = pa?.state   ? String(pa.state)                     : "";
  let customerZip     = pa?.postalCode != null ? String(pa.postalCode)     : "";

  // email/phone are NOT in the payload — try the customer API (best-effort)
  let customerEmail = "";
  let customerPhone = "";
  // Lead owner's numeric/UUID Enerflo ID extracted from the full customer record
  let customerAgentId = "";

  // ── Step 1a [best-effort]: Fetch customer email/phone from Enerflo ────────
  const customerId = payload.customer?.id ?? "";
  if (customerId) {
    // Only v3 accepts UUID customer IDs; v1 requires numeric IDs and returns 404 for UUIDs
    const urls = [
      `${enerfloBase}/api/v3/customers/${encodeURIComponent(customerId)}`,
    ];
    let status: number | null = null;
    let ok = false;
    let responseText = "";
    let urlUsed = "";

    for (const url of urls) {
      urlUsed = url;
      try {
        const res = await fetch(url, {
          method: "GET",
          headers: { "api-key": enerfloKey, "Content-Type": "application/json" },
        });
        status = res.status;
        ok = res.ok;
        const rawBody = await res.text();
        responseText = rawBody;
        if (ok) {
          const raw = JSON.parse(rawBody) as Record<string, unknown>;
          const c = (raw.customer ?? raw.data ?? raw) as Record<string, unknown>;
          customerEmail = String(c.email ?? c.Email ?? "");
          customerPhone = String(c.phone ?? c.mobile_phone ?? "");
          // Fill any address gaps not already set from the payload
          if (!customerAddress) customerAddress = String(c.address ?? c.line1 ?? "");
          if (!customerCity)    customerCity    = String(c.city    ?? "");
          if (!customerState)   customerState   = String(c.state   ?? "");
          if (!customerZip)     customerZip     = String(c.zip ?? c.postal_code ?? c.postalCode ?? "");
          // Extract lead owner email + ID from the customer record.
          // c.agent_id is the company-user junction ID (e.g. 102466), NOT the
          // actual user ID (e.g. 147158). Prefer the email directly from
          // owner.user.email, then fall back to the actual user ID
          // (owner.user_id / owner.user.id) which works with /api/v3/users/{id}.
          const agentObj = (c.agent ?? c.owner ?? c.leadOwner) as Record<string, unknown> | undefined;
          const agentUser = agentObj && typeof agentObj === "object"
            ? (agentObj.user as Record<string, unknown> | undefined)
            : undefined;
          // Direct email — no extra API call needed
          const agentEmailDirect =
            (agentUser?.email as string | undefined) ??
            (agentObj?.email as string | undefined);
          if (agentEmailDirect && agentEmailDirect.includes("@")) {
            customerAgentId = agentEmailDirect.trim();
          } else {
            // Fall back to the actual Enerflo user ID for /api/v3/users/{id} lookup.
            // Prefer owner.user.id / owner.user_id (real user ID like 147158) over
            // c.agent_id / owner.id (junction table ID like 102466) which won't match.
            const rawAgentId =
              agentUser?.id ??
              agentObj?.user_id ??
              agentObj?.userId ??
              c.agent_user_id ??
              c.agentUserId ??
              c.agentId ??
              c.agent_id; // snake_case fallback — junction ID, last resort
            if (rawAgentId != null && String(rawAgentId).trim()) {
              customerAgentId = String(rawAgentId).trim();
            }
          }
          if (customerEmail || customerPhone) break;
        }
      } catch (e) {
        responseText = e instanceof Error ? e.message : String(e);
        ok = false;
      }
    }

    steps.push({
      step: "1a [best-effort] — Fetch customer email/phone",
      ok,
      status,
      data: ok ? { customerEmail, customerPhone, customerAgentId: customerAgentId || null } : undefined,
      _ownerShape: ok ? (() => {
        try {
          const raw = JSON.parse(responseText) as Record<string, unknown>;
          const c2 = (raw.customer ?? raw.data ?? raw) as Record<string, unknown>;
          const o = c2.owner ?? c2.agent ?? c2.leadOwner;
          return {
            agent_id: c2.agent_id,
            owner_keys: o && typeof o === "object" ? Object.keys(o as object) : null,
            owner_user_keys: (o as Record<string, unknown>)?.user && typeof (o as Record<string, unknown>).user === "object"
              ? Object.keys((o as Record<string, unknown>).user as object)
              : null,
            owner_email: (o as Record<string, unknown>)?.email,
            owner_user_id: (o as Record<string, unknown>)?.user_id,
            owner_user_email: ((o as Record<string, unknown>)?.user as Record<string, unknown>)?.email,
          };
        } catch { return null; }
      })() : undefined,
      error: ok ? undefined : logPreview(responseText),
    });
  }

  // ── Step 1b [best-effort]: Resolve rep / owner email from Enerflo ─────────
  // Priority: Lead Owner (v1 owner.email) → agent → setter; avoid initiatedBy (API user).
  let repEmail: string | null = null;
  let repResolvedFrom = "";
  let resolveStatus: number | null = null;
  let resolvePreview = "";

  if (customerEmail && customerId && enerfloKey) {
    const leadOwner = await resolveEnerfloCustomerLeadOwner({
      enerfloBase,
      enerfloKey,
      customerEmail,
      customerUuid: customerId,
    });
    if (leadOwner.ownerEmail) {
      repEmail = leadOwner.ownerEmail;
      repResolvedFrom = leadOwner.ownerResolvedFrom;
      resolvePreview = JSON.stringify(leadOwner.debug).slice(0, 300);
    }
  }

  if (!repEmail && repLookupId.includes("@")) {
    repEmail = repLookupId;
    repResolvedFrom = "email-inline";
  } else if (!repEmail) {
    // customerAgentId from v3 customer fetch — often owner.user.email (Lead Owner)
    const uuidCandidates = [customerAgentId, salesRepUuid].filter(
      (id, i, arr) => id && arr.indexOf(id) === i,
    );
    for (const lookupId of uuidCandidates) {
      const r = await resolveEnerfloUserEmailByLookupId(enerfloBase, enerfloKey, lookupId);
      resolveStatus = r.lastStatus;
      resolvePreview = r.lastPreview;
      if (r.email) {
        repEmail = r.email;
        repResolvedFrom = lookupId.includes("@")
          ? "customer:owner.email"
          : `users-list:${lookupId.slice(0, 8)}…`;
        break;
      }
    }

    if (!repEmail && dealId && enerfloKey) {
      const surveyUrl = `${enerfloBase}/api/v3/surveys/${encodeURIComponent(dealId)}`;
      try {
        const res = await fetch(surveyUrl, {
          method: "GET",
          headers: { "api-key": enerfloKey, "Content-Type": "application/json" },
        });
        resolveStatus = res.status;
        const rawBody = await res.text();
        resolvePreview = rawBody;
        if (res.ok) {
          const parsed = JSON.parse(rawBody) as Record<string, unknown>;
          const s = (parsed.survey ?? parsed.data ?? parsed) as Record<string, unknown>;
          const agentNumeric =
            s.agent_user_id ??
            s.setter_user_id ??
            s.creator_user_id ??
            s.user_id ??
            s.agentUserId ??
            s.creatorUserId;
          if (agentNumeric != null && String(agentNumeric).trim() !== "") {
            const numericId = String(agentNumeric).trim();
            const userUrl = `${enerfloBase}/api/v3/users/${encodeURIComponent(numericId)}`;
            const ures = await fetch(userUrl, {
              method: "GET",
              headers: { "api-key": enerfloKey, "Content-Type": "application/json" },
            });
            resolveStatus = ures.status;
            const ubody = await ures.text();
            resolvePreview = ubody;
            if (ures.ok) {
              repEmail = parseUserEmailFromJsonBody(ubody);
              if (repEmail) repResolvedFrom = `survey→user/${numericId}`;
            }
          }
        }
      } catch (e) {
        resolvePreview = e instanceof Error ? e.message : String(e);
      }
    }

    // initiatedBy is the API key user — last resort only
    if (!repEmail && initiatedBy) {
      const r = await resolveEnerfloUserEmailByLookupId(enerfloBase, enerfloKey, initiatedBy);
      resolveStatus = r.lastStatus;
      resolvePreview = r.lastPreview;
      if (r.email) {
        repEmail = r.email;
        repResolvedFrom = "initiatedBy:last-resort";
      }
    }
  }

  steps.push({
    step: "1b [best-effort] — Resolve rep email from Enerflo",
    ok: Boolean(repEmail),
    status: resolveStatus,
    data: repEmail
      ? { repEmail, salesRepUuid: salesRepUuid || null, initiatedBy, repResolvedFrom }
      : {
          salesRepUuid: salesRepUuid || null,
          initiatedBy,
          note: "No email: webhook has UUIDs only; survey agent id or user-list match failed",
        },
    error: repEmail
      ? undefined
      : "Terros account will be created without ownerId until rep email resolves",
  });

  // ── Step 2 [best-effort]: Resolve Terros userId by rep email ─────────────
  let terrosUserId: string | null = null;
  const repEmailToResolve = repEmail || "";
  if (repEmailToResolve) {
    const u = await resolveTerrosUserIdByEmail(terrosBase, terrosKey, repEmailToResolve);
    terrosUserId = u.userId;
    steps.push({
      step: "2 [best-effort] — Resolve Terros userId by rep email",
      ok: u.ok && Boolean(terrosUserId),
      status: u.status,
      data: terrosUserId ? { terrosUserId, usedDefault: !repEmail || undefined } : undefined,
      error: u.ok && terrosUserId ? undefined : logPreview(u.preview),
    });
  }

  // ── Step 3 [required]: Upsert Terros account ─────────────────────────────
  // account/upsert creates or updates based on externalLeadId — idempotent on resubmit.
  let accountCreated = false;
  let terrosCustomFieldsForApi: Record<string, string | number> = {};
  {
    const url = `${terrosBase}/account/upsert`;
    let status: number | null = null;
    let ok = false;
    let responseText = "";

    terrosCustomFieldsForApi = buildTerrosCustomFields(payload, systemSizeKw);
    const terrosCustomFields = terrosCustomFieldsForApi;

    const displayName = customerName || `Deal ${dealShortCode}`;
    const accountName =
      systemSizeKw !== null && systemSizeKw > 0
        ? `${displayName} (${systemSizeKw} kW)`
        : displayName;

    // Terros requires `location.line1` (string). `oneLine` alone is not enough.
    const addrTrim = customerAddress.trim();
    const line1ForTerros =
      projectLine1 ||
      (addrTrim ? addrTrim.split(",")[0]?.trim() || addrTrim : "") ||
      (dealShortCode ? `Enerflo ${dealShortCode}` : "") ||
      (dealId ? `Enerflo ${dealId.slice(0, 8)}…` : "Address pending");

    const location: Record<string, unknown> = {
      line1: line1ForTerros,
      ...(addrTrim ? { oneLine: addrTrim } : {}),
      ...(customerCity ? { locality: customerCity } : {}),
      ...(customerState ? { countrySubd: customerState } : {}),
      ...(customerZip ? { postal1: customerZip } : {}),
    };
    if (typeof pa?.lat === "number" && typeof pa?.lng === "number") {
      location.latlng = { latitude: pa.lat, longitude: pa.lng };
    }

    const accountFields: Record<string, unknown> = {
      name: accountName,
      // Terros OpenAPI uses ownerId for Owner/Setter; keep assignedUserId for compatibility
      ...(terrosUserId
        ? { ownerId: terrosUserId, assignedUserId: terrosUserId }
        : {}),
      ...(terrosUserId ? { actorId: terrosUserId } : {}),
      externalId: dealId,
      sourceStatus: "Project Submitted",
      ...(dealShortCode ? { sourceId: dealShortCode } : {}),
      // externalLeadId uses customer UUID so upsert matches the account created by customer.created
      // and updates it with full project details instead of creating a duplicate.
      ...(customerId ? { externalLeadId: customerId } : { ...(dealId ? { externalLeadId: dealId } : {}) }),
      // Workflow fields — required for the account to appear in the Terros UI
      ...(terrosWorkflowId ? { workflowId: terrosWorkflowId } : {}),
      // New accounts from project submit start at Closed; upsert keeps existing stage on update
      ...(terrosClosedStageId ? { workflowStageId: terrosClosedStageId } : (knockStageId ? { workflowStageId: knockStageId } : {})),
      location,
      resident: {
        ...(customerName ? { name: customerName } : {}),
        ...(payload.customer?.firstName ? { firstName: payload.customer.firstName } : {}),
        ...(payload.customer?.lastName  ? { lastName:  payload.customer.lastName  } : {}),
        ...(customerEmail ? { email: customerEmail } : {}),
        ...(sanitizePhone(customerPhone) ? { phone: sanitizePhone(customerPhone) } : {}),
      },
      customFields: terrosCustomFields,
    };
    // Terros expects: { "account": { ...fields } }
    const accountBody = { account: accountFields };

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `ApiKey ${terrosKey}` },
        body: JSON.stringify(accountBody),
      });
      status = res.status;
      const rawBody = await res.text();
      responseText = rawBody;
      // Terros returns HTTP 200 with { "type": "error", ... } on validation failures
      accountCreated = res.ok && terrosJsonBodyIndicatesSuccess(responseText);
      ok = accountCreated;
    } catch (e) {
      responseText = e instanceof Error ? e.message : String(e);
    }

    await writeApiLog({
      operation: "webhook:enerflo-v2:upsert-terros-account",
      vendor: "terros",
      method: "POST",
      url,
      hadApiKey: Boolean(terrosKey),
      status,
      ok,
      responsePreview: logPreview(responseText),
    });

    let parsedBody: Record<string, unknown> | undefined;
    if (ok) {
      try { parsedBody = JSON.parse(responseText) as Record<string, unknown>; }
      catch { parsedBody = { raw: logPreview(responseText) }; }
    }

    steps.push({
      step: "3 — Upsert Terros account",
      ok,
      status,
      data: ok ? parsedBody : undefined,
      error: ok ? undefined : logPreview(responseText),
    });

    // ── Step 3b [best-effort]: Assign start stage if upsert returned no workflowStageId ──
    // Terros upsert preserves the existing stage on updates and ignores workflowStageId in the
    // request body. Accounts created before stage support was added have no stage and are
    // invisible in the UI. If the upsert response has no stage, force-assign it via account/update.
    const fallbackStageId = terrosClosedStageId || knockStageId;
    if (ok && fallbackStageId) {
      const upsertedAccount = parsedBody?.account as Record<string, unknown> | undefined;
      const upsertedId = upsertedAccount?.accountId as string | undefined;
      const hasStage = Boolean(upsertedAccount?.workflowStageId);

      if (upsertedId && !hasStage) {
        let stageStatus: number | null = null;
        let stageOk = false;
        let stageError: string | undefined;

        try {
          const stageRes = await fetch(`${terrosBase}/account/update`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `ApiKey ${terrosKey}` },
            body: JSON.stringify({
              account: {
                accountId: upsertedId,
                id: upsertedId,
                workflowStageId: fallbackStageId,
                ...(terrosUserId ? { actorId: terrosUserId } : {}),
              },
            }),
          });
          stageStatus = stageRes.status;
          const stageBody = await stageRes.text();
          stageOk = stageRes.ok && terrosJsonBodyIndicatesSuccess(stageBody);
          if (!stageOk) stageError = logPreview(stageBody);
        } catch (e) {
          stageError = e instanceof Error ? e.message : String(e);
        }

        steps.push({
          step: "3b [best-effort] — Assign Closed stage to unstageed account",
          ok: stageOk,
          status: stageStatus,
          data: stageOk ? { accountId: upsertedId, workflowStageId: fallbackStageId } : undefined,
          error: stageError,
        });
      }
    }

    // ── Step 3c [best-effort]: Set Closed stage + Net Deals +1 (Installs stays 0) ──
    // project_submitted increments netDeals only; Installs is incremented by a separate install event.
    if (ok) {
      const upsertedAccount = parsedBody?.account as Record<string, unknown> | undefined;
      const upsertedId = upsertedAccount?.accountId as string | undefined;
      const closedStage  = env.terrosWorkflowClosedStageId;
      const netDealsCfId = env.terrosCfNetDeals;

      if (upsertedId && (closedStage || netDealsCfId)) {
        // Fetch current account to read existing custom field values before updating.
        // Terros account/update replaces the entire customFields object, so we must
        // merge existing fields to avoid overwriting other counters.
        let currentNetDeals = 0;
        let existingCustomFields: Record<string, unknown> = {};
        let storedDealId: string | undefined;
        try {
          const getRes = await fetch(`${terrosBase}/account/get`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `ApiKey ${terrosKey}` },
            body: JSON.stringify({ accountId: upsertedId }),
          });
          if (getRes.ok) {
            const getRaw = await getRes.text();
            if (terrosJsonBodyIndicatesSuccess(getRaw)) {
              const getParsed = JSON.parse(getRaw) as Record<string, unknown>;
              const acc = (getParsed.account ?? getParsed) as Record<string, unknown>;
              const cfs = acc.customFields as Record<string, unknown> | undefined;
              if (cfs && typeof cfs === "object") existingCustomFields = cfs;
              if (netDealsCfId) {
                const existing = cfs?.[netDealsCfId];
                if (typeof existing === "number") currentNetDeals = existing;
                else if (typeof existing === "string") currentNetDeals = parseInt(existing, 10) || 0;
              }
              const enerfloDealIdCfId = env.terrosCfEnerfloDealId?.trim();
              if (enerfloDealIdCfId) {
                const stored = cfs?.[enerfloDealIdCfId];
                if (typeof stored === "string") storedDealId = stored.trim();
                else if (typeof stored === "number") storedDealId = String(stored);
              }
            }
          }
        } catch { /* best-effort — proceed with 0 if fetch fails */ }

        // Idempotency: skip netDeals increment if this deal was already processed.
        const incomingDealId = payload.deal?.id ? String(payload.deal.id).trim() : undefined;
        const alreadyCounted = Boolean(incomingDealId && storedDealId && storedDealId === incomingDealId);

        const cleanPhoneForClosed = sanitizePhone(customerPhone);
        // Merge order: existing fields → deal fields (override) → netDeals counter (unless already counted)
        const mergedCustomFields: Record<string, unknown> = {
          ...existingCustomFields,
          ...terrosCustomFieldsForApi,
          ...(netDealsCfId && !alreadyCounted ? { [netDealsCfId]: currentNetDeals + 1 } : {}),
        };
        const updateFields: Record<string, unknown> = {
          accountId: upsertedId,
          id: upsertedId,
          ...(closedStage ? { workflowStageId: closedStage } : {}),
          ...(terrosUserId ? { actorId: terrosUserId } : {}),
          ...(Object.keys(mergedCustomFields).length > 0 ? { customFields: mergedCustomFields } : {}),
          // Terros requires a phone number before allowing stage transition to Closed
          ...(cleanPhoneForClosed ? { resident: { phone: cleanPhoneForClosed } } : {}),
        };

        let closedOk = false;
        let closedStatus: number | null = null;
        let closedError: string | undefined;

        try {
          const closedRes = await fetch(`${terrosBase}/account/update`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `ApiKey ${terrosKey}` },
            body: JSON.stringify({ account: updateFields }),
          });
          closedStatus = closedRes.status;
          const closedBody = await closedRes.text();
          closedOk = closedRes.ok && terrosJsonBodyIndicatesSuccess(closedBody);
          if (!closedOk) closedError = logPreview(closedBody);
        } catch (e) {
          closedError = e instanceof Error ? e.message : String(e);
        }

        await writeApiLog({
          operation: "webhook:enerflo-v2:set-closed-stage-netdeals",
          vendor: "terros",
          method: "POST",
          url: `${terrosBase}/account/update`,
          hadApiKey: Boolean(terrosKey),
          status: closedStatus,
          ok: closedOk,
          responsePreview: closedError ?? "ok",
        });

        steps.push({
          step: "3c [best-effort] — Set Closed stage + Net Deals +1",
          ok: closedOk,
          status: closedStatus,
          data: closedOk
            ? {
                accountId: upsertedId,
                workflowStageId: closedStage ?? null,
                netDeals: alreadyCounted ? currentNetDeals : currentNetDeals + 1,
                installs: 0,
                alreadyCounted,
                incomingDealId,
                storedDealId,
              }
            : undefined,
          error: closedError,
        });
      }
    }
  }

  const terrosCfEnvConfigured = terrosCustomFieldEnvHasAnyMapping();
  const terrosCfKeysSent = Object.keys(terrosCustomFieldsForApi).length;

  return NextResponse.json({
    received: true,
    event: "deal.projectSubmitted",
    dealId,
    success: accountCreated,
    repUserId: repLookupId,
    repResolvedFrom: repResolvedFrom || null,
    repEmail,
    terrosUserId,
    systemSizeKw,
    terrosCustomFields: {
      keysSent: terrosCfKeysSent,
      terrosFieldIdsConfiguredInEnv: terrosCfEnvConfigured,
      ...(!terrosCfEnvConfigured
        ? {
            hint:
              "No TERROS_CF_* values in .env.local — Terros custom fields stay N/A. " +
              "In Terros Settings → Custom Fields, open each field and copy its API/field ID into the matching TERROS_CF_* variable, then restart the server.",
          }
        : terrosCfKeysSent === 0
          ? {
              hint:
                "TERROS_CF_* is set but no values were sent (check deal.id, shortCode, proposal.id, and proposal.pricingOutputs in the webhook payload).",
            }
          : {}),
    },
    customer: {
      name:    customerName,
      email:   customerEmail   || null,
      phone:   customerPhone   || null,
      address: customerAddress || null,
      city:    customerCity    || null,
      state:   customerState   || null,
      zip:     customerZip     || null,
    },
    steps,
  });
}

// ── customer.created ─────────────────────────────────────────────────────
// ── deal.created ─────────────────────────────────────────────────────────
async function handleDealCreated(
  payload: DealCreatedPayload
): Promise<NextResponse> {
  const terrosBase = (env.terrosApiBaseUrl ?? "https://api.terros.com").replace(/\/$/, "");
  const terrosKey       = env.terrosApiKey ?? "";
  const knockStageId    = env.terrosWorkflowKnockStageId ?? "";
  const terrosWorkflowId = env.terrosWorkflowId ?? "";
  const terrosStartStage = env.terrosWorkflowStartStageId ?? "";

  const customerId = payload.deal?.customer?.id ?? "";

  if (!customerId) {
    return NextResponse.json({ received: true, event: "deal.created", skipped: true, reason: "no customer id" });
  }
  if (!knockStageId) {
    return NextResponse.json({ received: true, event: "deal.created", skipped: true, reason: "TERROS_WORKFLOW_KNOCK_STAGE_ID not configured" });
  }

  // Step 1: Upsert the account (finds existing by externalLeadId) to get the accountId
  let accountId: string | null = null;
  let currentStage: string | null = null;
  let upsertOk = false;
  let upsertStatus: number | null = null;
  let upsertPreview = "";

  try {
    const res = await fetch(`${terrosBase}/account/upsert`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `ApiKey ${terrosKey}` },
      body: JSON.stringify({
        account: {
          externalLeadId: customerId,
          ...(terrosWorkflowId ? { workflowId: terrosWorkflowId } : {}),
          ...(knockStageId ? { workflowStageId: knockStageId } : {}),
        },
      }),
    });
    upsertStatus = res.status;
    const rawBody = await res.text();
    upsertPreview = rawBody.slice(0, 300);
    upsertOk = res.ok && terrosJsonBodyIndicatesSuccess(rawBody);
    if (upsertOk) {
      const parsed = JSON.parse(rawBody) as Record<string, unknown>;
      const acc = (parsed.account ?? parsed) as Record<string, unknown>;
      accountId = (acc.accountId as string | undefined) ?? null;
      currentStage = (acc.workflowStageId as string | undefined) ?? null;
    }
  } catch (e) {
    upsertPreview = e instanceof Error ? e.message : String(e);
  }

  await writeApiLog({
    operation: "webhook:enerflo-v2:upsert-terros-account-deal-created",
    vendor: "terros",
    method: "POST",
    url: `${terrosBase}/account/upsert`,
    hadApiKey: Boolean(terrosKey),
    status: upsertStatus,
    ok: upsertOk,
    responsePreview: upsertPreview,
  });

  // Step 2: Update stage to Knock only (no counter — Net Deals is counted on deal.projectSubmitted).
  // Block only if already at Appointment or Closed.
  const appointmentStageId = env.terrosWorkflowAppointmentStageId ?? "";
  const closedStageId      = env.terrosWorkflowClosedStageId      ?? "";
  const blockKnockStages   = [appointmentStageId, closedStageId].filter(Boolean);
  const shouldSetKnock = !currentStage || !blockKnockStages.includes(currentStage);
  let stageOk = false;
  let stageStatus: number | null = null;
  let stagePreview = "";

  if (accountId && shouldSetKnock) {
    const knockUpdateFields: Record<string, unknown> = {
      accountId,
      ...(knockStageId ? { workflowStageId: knockStageId } : {}),
    };

    try {
      const res = await fetch(`${terrosBase}/account/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `ApiKey ${terrosKey}` },
        body: JSON.stringify({ account: knockUpdateFields }),
      });
      stageStatus = res.status;
      const rawBody = await res.text();
      stagePreview = rawBody.slice(0, 300);
      stageOk = res.ok && terrosJsonBodyIndicatesSuccess(rawBody);
    } catch (e) {
      stagePreview = e instanceof Error ? e.message : String(e);
    }

    await writeApiLog({
      operation: "webhook:enerflo-v2:set-knock-stage-deal-created",
      vendor: "terros",
      method: "POST",
      url: `${terrosBase}/account/update`,
      hadApiKey: Boolean(terrosKey),
      status: stageStatus,
      ok: stageOk,
      responsePreview: stagePreview.slice(0, 300),
    });
  } else if (accountId && !shouldSetKnock) {
    stagePreview = `Skipped: account already past Prospect stage (currentStage=${currentStage ?? "none"})`;
  }

  return NextResponse.json({
    received: true,
    event: "deal.created",
    customerId,
    accountId,
    knockStageId,
    currentStage,
    upsert: { ok: upsertOk, status: upsertStatus },
    stageUpdate: !accountId
      ? { skipped: true, reason: "no accountId from upsert" }
      : !shouldSetKnock
        ? { skipped: true, reason: stagePreview }
        : { ok: stageOk, status: stageStatus, preview: stagePreview },
  });
}

// ── customer.created ─────────────────────────────────────────────────────
async function handleCustomerCreated(
  payload: CustomerCreatedPayload
): Promise<NextResponse> {
  const enerfloBase = (env.enerfloV1BaseUrl ?? "https://enerflo.io").replace(/\/$/, "");
  const enerfloKey  = env.enerfloV1ApiKey ?? "";
  const terrosBase = (env.terrosApiBaseUrl ?? "https://api.terros.com").replace(/\/$/, "");
  const terrosKey       = env.terrosApiKey               ?? "";
  const terrosWorkflowId = env.terrosWorkflowId          ?? "";
  const terrosStartStage = env.terrosWorkflowStartStageId ?? "";
  const knockStageId     = env.terrosWorkflowKnockStageId ?? "";

  const c = payload.customer;
  const customerId  = c.id ?? "";
  const customerName = `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || "Unknown";
  const customerEmail = c.email?.trim() ?? "";
  const customerPhone = (c.mobile?.trim() || c.phone?.trim()) ?? "";

  // ── Junk-delivery guard ───────────────────────────────────────────────────
  // Enerflo fires customer.created 2-3× per customer, and some deliveries in the
  // burst arrive with no usable customer data (empty email/phone, name "Unknown").
  // Those empty deliveries can't resolve an owner, so they fall back to the
  // default owner and create a junk Terros account wrongly assigned to the API
  // user. A real lead always has at least an email or a phone — skip the rest.
  if (!customerEmail && !customerPhone) {
    await writeApiLog({
      operation: "webhook:enerflo-v2:customer-created:skipped",
      vendor: "enerflo",
      method: "POST",
      url: "/api/webhooks/enerflo-v2",
      hadApiKey: false,
      status: 200,
      ok: true,
      responsePreview: JSON.stringify({ reason: "empty-payload", customerId }).slice(0, 200),
    });
    return NextResponse.json({
      received: true,
      event: "customer.created",
      customerId,
      skipped: true,
      reason: "empty-payload",
    });
  }

  // ── Idempotency lock ──────────────────────────────────────────────────────
  // Serialize the customer.created burst so only the FIRST delivery for a given
  // Enerflo customer creates the Terros account. This is what prevents duplicate
  // accounts (and the duplicate that gets mis-assigned to the default owner).
  if (customerId && !(await acquireCustomerCreatedLock(customerId))) {
    await writeApiLog({
      operation: "webhook:enerflo-v2:customer-created:skipped",
      vendor: "enerflo",
      method: "POST",
      url: "/api/webhooks/enerflo-v2",
      hadApiKey: false,
      status: 200,
      ok: true,
      responsePreview: JSON.stringify({ reason: "duplicate-delivery-lock", customerId }).slice(0, 200),
    });
    return NextResponse.json({
      received: true,
      event: "customer.created",
      customerId,
      skipped: true,
      reason: "duplicate-delivery-lock",
    });
  }

  const addr = c.address;
  const addrTrim  = addr?.fullAddress?.trim() ?? [addr?.line1, addr?.line2, addr?.line3].filter(Boolean).join(" ");
  const line1ForTerros =
    addr?.line1?.trim() ||
    (addrTrim ? addrTrim.split(",")[0]?.trim() : "") ||
    "Address pending";

  const location: Record<string, unknown> = {
    line1: line1ForTerros,
    ...(addrTrim ? { oneLine: addrTrim } : {}),
    ...(addr?.city  ? { locality: addr.city }         : {}),
    ...(addr?.state ? { countrySubd: addr.state }      : {}),
    ...(addr?.postalCode != null ? { postal1: String(addr.postalCode) } : {}),
  };
  if (typeof addr?.lat === "number" && typeof addr?.lng === "number") {
    location.latlng = { latitude: addr.lat, longitude: addr.lng };
  }

  const payloadRoot = payload as unknown as Record<string, unknown>;
  const leadRefs = extractCustomerCreatedLeadOwnerRefs(c, payloadRoot);
  let payloadLeadOwnerEmail = leadRefs.email ?? null;
  if (!payloadLeadOwnerEmail && leadRefs.id && enerfloKey) {
    const r = await resolveEnerfloUserEmailByLookupId(enerfloBase, enerfloKey, leadRefs.id);
    if (r.email) payloadLeadOwnerEmail = r.email;
  }

  const ownerResolution = await resolveEnerfloCustomerLeadOwner({
    enerfloBase,
    enerfloKey,
    customerEmail,
    customerUuid: customerId,
    payloadLeadOwnerEmail,
  });

  const ownerEmail = ownerResolution.ownerEmail;
  const ownerResolvedFrom = ownerResolution.ownerResolvedFrom;
  const setterEmailResolved = ownerResolution.setterEmail;
  const resolvedNumericId = ownerResolution.matchedNumericId;
  const _ownerDebug = ownerResolution.debug;

  let terrosOwnerId:  string | null = null;
  let terrosCloserId: string | null = null;
  // Field mapping for Enerflo-originated leads (business rule):
  //   Enerflo Setter              → Terros Owner
  //   Enerflo Lead Owner/SalesRep → Terros Closer
  // Terros Owner source prefers the setter, then falls back to the sales rep.
  // We intentionally do not use DEFAULT_OWNER_EMAIL as a hard fallback because
  // sparse payloads would otherwise assign leads to a generic/default owner.
  const terrosOwnerSourceEmail = setterEmailResolved || ownerEmail || "";
  _ownerDebug.terrosOwnerSource = terrosOwnerSourceEmail || null;
  _ownerDebug.terrosCloserSource = ownerEmail || null;
  if (terrosOwnerSourceEmail) {
    const u = await resolveTerrosUserIdByEmail(terrosBase, terrosKey, terrosOwnerSourceEmail);
    terrosOwnerId = u.userId;
    _ownerDebug.terrosLookupStatus = u.status;
    _ownerDebug.terrosLookupOk = u.ok;
    _ownerDebug.terrosLookupPreview = u.preview.slice(0, 200);
    if (!setterEmailResolved && !ownerEmail && terrosOwnerId) {
      _ownerDebug.note = "fell back to DEFAULT_OWNER_EMAIL";
    }
  }
  // Terros Closer ← Enerflo lead owner / sales rep. Resolve only when present and
  // different from the owner source (avoid assigning the same person to both).
  if (ownerEmail && ownerEmail !== terrosOwnerSourceEmail) {
    const u = await resolveTerrosUserIdByEmail(terrosBase, terrosKey, ownerEmail);
    terrosCloserId = u.userId;
  }

  const accountFields: Record<string, unknown> = {
    name: customerName,
    // externalLeadId = Enerflo numeric customer ID (matches what handleNewAppointment searches for).
    // Fall back to the V2 UUID (customerId) if v1 search didn't resolve a numeric ID.
    externalLeadId: resolvedNumericId ?? customerId,
    externalId: customerId,
    sourceStatus: "New Lead",
    ...(terrosOwnerId  ? { ownerId: terrosOwnerId, assignedUserId: terrosOwnerId } : {}),
    ...(terrosCloserId ? { closerId: terrosCloserId }                               : {}),
    ...((terrosOwnerId || terrosCloserId) ? { actorId: terrosOwnerId || terrosCloserId } : {}),
    ...(terrosWorkflowId ? { workflowId: terrosWorkflowId } : {}),
    ...(knockStageId ? { workflowStageId: knockStageId } : {}),
    location,
    resident: {
      ...(customerName  ? { name: customerName }   : {}),
      ...(c.firstName   ? { firstName: c.firstName } : {}),
      ...(c.lastName    ? { lastName:  c.lastName  } : {}),
      ...(customerEmail ? { email: customerEmail } : {}),
      ...(sanitizePhone(customerPhone) ? { phone: sanitizePhone(customerPhone) } : {}),
    },
  };

  // ── Dedup guard: never create a duplicate Terros account ──────────────────
  // customer.created fires when an Enerflo lead converts to a customer. If that
  // lead ORIGINATED in Terros (we created the Enerflo lead from a Terros account
  // via lead/add), a Terros account already exists — a blind account/add would
  // duplicate it. Check our reverse mapping first (fast), then search Terros by
  // strong identifiers (Enerflo numeric id / UUID / email / phone).
  let existingTerrosAccountId: string | null = null;
  if (resolvedNumericId) {
    existingTerrosAccountId = await getTerrosAccountIdByEnerfloNumericId(resolvedNumericId);
  }
  if (!existingTerrosAccountId && terrosKey) {
    const dedupQueries = [
      resolvedNumericId ? String(resolvedNumericId) : "",
      customerId,
      customerEmail,
      sanitizePhone(customerPhone) ?? "",
    ];
    for (const q of dedupQueries) {
      if (!q) continue;
      const hit = await searchTerrosAccountByQuery(terrosBase, terrosKey, q);
      if (hit) {
        existingTerrosAccountId = String(hit.accountId ?? hit.id ?? "").trim() || null;
        if (existingTerrosAccountId) break;
      }
    }
  }
  if (existingTerrosAccountId) {
    // Persist the mapping so future updates resolve instantly, then skip the add.
    if (resolvedNumericId) {
      await saveCustomerAccountMapping(existingTerrosAccountId, Number(resolvedNumericId));
    }
    await writeApiLog({
      operation: "webhook:enerflo-v2:add-terros-account-from-customer-created",
      vendor: "terros",
      method: "POST",
      url: `${terrosBase}/account/add`,
      hadApiKey: Boolean(terrosKey),
      status: 200,
      ok: true,
      responsePreview: JSON.stringify({
        skipped: "existing-terros-account",
        terrosAccountId: existingTerrosAccountId,
        enerfloNumericId: resolvedNumericId ?? null,
        customerId,
      }).slice(0, 400),
    });
    return NextResponse.json({
      received: true,
      event: "customer.created",
      customerId,
      skipped: true,
      reason: "existing-terros-account",
      terrosAccountId: existingTerrosAccountId,
    });
  }

  // Use account/add (not upsert) — account/add reliably sets workflowStageId for new accounts.
  // account/upsert ignores workflowStageId on both create and update, leaving the account stageless
  // and invisible in the Terros UI. The dedup guard above prevents duplicates.
  let ok = false;
  let status: number | null = null;
  let responseText = "";

  try {
    const res = await fetch(`${terrosBase}/account/add`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `ApiKey ${terrosKey}` },
      body: JSON.stringify({ account: accountFields }),
    });
    status = res.status;
    responseText = await res.text();
    ok = res.ok && terrosJsonBodyIndicatesSuccess(responseText);
  } catch (e) {
    responseText = e instanceof Error ? e.message : String(e);
  }

  await writeApiLog({
    operation: "webhook:enerflo-v2:add-terros-account-from-customer-created",
    vendor: "terros",
    method: "POST",
    url: `${terrosBase}/account/add`,
    hadApiKey: Boolean(terrosKey),
    status,
    ok,
    responsePreview: logPreview(responseText),
  });

  await writeApiLog({
    operation: "webhook:enerflo-v2:customer-created:owner-debug",
    vendor: "enerflo",
    method: "GET",
    url: `${enerfloBase}/api/v3/customers`,
    hadApiKey: Boolean(enerfloKey),
    status: terrosOwnerId ? 200 : null,
    ok: Boolean(terrosOwnerId),
    responsePreview: JSON.stringify({
      customerEmail,
      customerId,
      ownerEmail,
      ownerResolvedFrom: ownerResolvedFrom || null,
      setterEmailResolved,
      terrosOwnerId,
      terrosCloserId,
      ..._ownerDebug,
    }).slice(0, 600),
  });

  let parsedBody: unknown;
  try { parsedBody = JSON.parse(responseText); }
  catch { parsedBody = { raw: logPreview(responseText) }; }

  return NextResponse.json({
    received: true,
    event: "customer.created",
    customerId,
    success: ok,
    status,
    owner: {
      ownerEmail: ownerEmail ?? null,
      ownerResolvedFrom: ownerResolvedFrom || null,
      terrosOwnerId: terrosOwnerId ?? null,
    },
    _ownerDebug,
    data: ok ? parsedBody : undefined,
    error: ok ? undefined : logPreview(responseText),
  });
}

// ── customer.updated.v2 ───────────────────────────────────────────────────
async function handleCustomerUpdatedV2(
  payload: CustomerUpdatedV2Payload
): Promise<NextResponse> {
  const enerfloBase = (env.enerfloV1BaseUrl ?? "https://enerflo.io").replace(/\/$/, "");
  const enerfloKey  = env.enerfloV1ApiKey ?? "";
  const terrosBase  = (env.terrosApiBaseUrl ?? "https://api.terros.com").replace(/\/$/, "");
  const terrosKey   = env.terrosApiKey ?? "";

  const c          = payload.current;
  const customerId = c.id ?? "";
  const customerName = `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim();
  const customerEmail = c.email?.trim() ?? "";
  const customerPhone = (c.mobile?.trim() || c.phone?.trim()) ?? "";

  const ownerResolution = await resolveEnerfloCustomerLeadOwner({
    enerfloBase,
    enerfloKey,
    customerEmail,
    customerUuid: customerId,
  });
  // Field mapping (same business rule as customer.created):
  //   Enerflo Setter              → Terros Owner
  //   Enerflo Lead Owner/SalesRep → Terros Closer
  const terrosOwnerSourceEmail =
    ownerResolution.setterEmail || ownerResolution.ownerEmail || "";
  let terrosOwnerId: string | null = null;
  let terrosCloserId: string | null = null;
  if (terrosOwnerSourceEmail && terrosKey) {
    const u = await resolveTerrosUserIdByEmail(terrosBase, terrosKey, terrosOwnerSourceEmail);
    terrosOwnerId = u.userId;
  }
  if (
    ownerResolution.ownerEmail &&
    ownerResolution.ownerEmail !== terrosOwnerSourceEmail &&
    terrosKey
  ) {
    const u = await resolveTerrosUserIdByEmail(terrosBase, terrosKey, ownerResolution.ownerEmail);
    terrosCloserId = u.userId;
  }

  const addr = c.address;
  const addrTrim = addr?.fullAddress?.trim() ??
    [addr?.line1, addr?.line2, addr?.line3].filter(Boolean).join(" ");
  const line1ForTerros =
    addr?.line1?.trim() ||
    (addrTrim ? addrTrim.split(",")[0]?.trim() : "") ||
    "";

  // Build only the fields that actually changed — avoids overwriting with empty values
  const changes = payload.changes;
  const residentUpdate: Record<string, string> = {};
  if (customerName)       residentUpdate.name      = customerName;
  if (c.firstName?.trim()) residentUpdate.firstName = c.firstName.trim();
  if (c.lastName?.trim())  residentUpdate.lastName  = c.lastName.trim();
  if (customerEmail)      residentUpdate.email     = customerEmail;
  const cleanPhone = sanitizePhone(customerPhone);
  if (cleanPhone) residentUpdate.phone = cleanPhone;

  const accountFields: Record<string, unknown> = {
    // externalLeadId = customer UUID — used by account/upsert to find the existing account
    externalLeadId: customerId,
    ...(customerName ? { name: customerName } : {}),
    ...(terrosOwnerId ? { ownerId: terrosOwnerId, assignedUserId: terrosOwnerId } : {}),
    ...(terrosCloserId ? { closerId: terrosCloserId } : {}),
    ...((terrosOwnerId || terrosCloserId) ? { actorId: terrosOwnerId || terrosCloserId } : {}),
    ...(Object.keys(residentUpdate).length > 0 ? { resident: residentUpdate } : {}),
  };

  // Only update location if address fields changed
  if ("address" in changes && line1ForTerros) {
    const location: Record<string, unknown> = {
      line1: line1ForTerros,
      ...(addrTrim ? { oneLine: addrTrim } : {}),
      ...(addr?.city        ? { locality: addr.city }              : {}),
      ...(addr?.state       ? { countrySubd: addr.state }          : {}),
      ...(addr?.postalCode != null ? { postal1: String(addr.postalCode) } : {}),
    };
    if (typeof addr?.lat === "number" && addr.lat !== 0 && typeof addr?.lng === "number" && addr.lng !== 0) {
      location.latlng = { latitude: addr.lat, longitude: addr.lng };
    }
    accountFields.location = location;
  }

  let ok = false;
  let status: number | null = null;
  let responseText = "";

  try {
    const res = await fetch(`${terrosBase}/account/upsert`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `ApiKey ${terrosKey}` },
      body: JSON.stringify({ account: accountFields }),
    });
    status = res.status;
    responseText = await res.text();
    ok = res.ok && terrosJsonBodyIndicatesSuccess(responseText);
  } catch (e) {
    responseText = e instanceof Error ? e.message : String(e);
  }

  await writeApiLog({
    operation: "webhook:enerflo-v2:upsert-terros-account-from-customer-updated",
    vendor: "terros",
    method: "POST",
    url: `${terrosBase}/account/upsert`,
    hadApiKey: Boolean(terrosKey),
    status,
    ok,
    responsePreview: logPreview(responseText),
  });

  let parsedBody: unknown;
  try { parsedBody = JSON.parse(responseText); }
  catch { parsedBody = { raw: logPreview(responseText) }; }

  return NextResponse.json({
    received: true,
    event: "customer.updated.v2",
    customerId,
    fieldsChanged: Object.keys(changes),
    owner: {
      ownerEmail: ownerResolution.ownerEmail,
      ownerResolvedFrom: ownerResolution.ownerResolvedFrom,
      terrosOwnerId,
      terrosCloserId,
    },
    success: ok,
    status,
    data: ok ? parsedBody : undefined,
    error: ok ? undefined : logPreview(responseText),
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Normalize for Terros `account.resident.phone`.
 * Enerflo v2 uses E.164 (e.g. `+19497352136`). The UI often shows `(949) 735-2136`.
 * Terros rejects some formatted strings — send **E.164 with a leading `+`** like Enerflo.
 */
function sanitizePhone(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 0) return undefined;
  if (/^0+$/.test(digits)) return undefined;

  const junk10 = (s: string) => s.length === 10 && /^(\d)\1{9}$/.test(s);

  // US 11-digit (1XXXXXXXXXX) or 10-digit → Terros expects bare 10 digits (no +1 prefix)
  if (digits.length === 11 && digits.startsWith("1")) {
    const national = digits.slice(1);
    if (junk10(national)) return undefined;
    return national;
  }
  if (digits.length === 10) {
    if (junk10(digits)) return undefined;
    return digits;
  }
  // International (non-US): send as-is (digits only)
  if (digits.length >= 7 && digits.length <= 15) return digits;
  return undefined;
}

/**
 * Maps Enerflo webhook values into Terros `account.customFields`.
 * Keys are Terros field definition IDs from `TERROS_CF_*` env — omit an env var to skip that field.
 */
function buildTerrosCustomFields(
  payload: ProjectSubmittedPayload,
  systemSizeKw: number | null
): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  const po = payload.proposal?.pricingOutputs;

  const putStr = (fieldId: string | undefined, value: string | undefined) => {
    if (!fieldId?.trim() || value === undefined) return;
    const t = value.trim();
    if (!t) return;
    out[fieldId.trim()] = t;
  };

  const putNum = (fieldId: string | undefined, value: number | null | undefined) => {
    if (!fieldId?.trim() || value === null || value === undefined) return;
    if (typeof value !== "number" || !Number.isFinite(value)) return;
    out[fieldId.trim()] = value;
  };

  putStr(env.terrosCfEnerfloDealId, payload.deal?.id);
  putStr(env.terrosCfEnerfloShortCode, payload.deal?.shortCode);
  putStr(env.terrosCfProposalId, payload.proposal?.id);

  if (systemSizeKw !== null && systemSizeKw > 0) {
    putNum(env.terrosCfSystemSizeKw, systemSizeKw);
  }

  const firstYear = po?.design?.firstYearProduction;
  if (typeof firstYear === "number" && Number.isFinite(firstYear)) {
    putNum(env.terrosCfFirstYearProductionKwh, firstYear);
  }

  const netPpw = po?.netPPW;
  if (typeof netPpw === "number" && Number.isFinite(netPpw)) {
    putNum(env.terrosCfNetPpw, netPpw);
  }

  // Panel count: sum moduleCount across all arrays in pricingOutputs.design.arrays
  const arrays = po?.design?.arrays;
  if (Array.isArray(arrays) && arrays.length > 0) {
    const panelCount = arrays.reduce((sum, arr) => sum + (arr.moduleCount ?? 0), 0);
    if (panelCount > 0) putNum(env.terrosCfPanelCount, panelCount);
  }

  // Finance product name: proposal.financeProduct.name or proposal.pricingOutputs.financeProduct.name
  const financeProductName =
    payload.proposal?.financeProduct?.name ??
    payload.proposal?.pricingOutputs?.financeProduct?.name;
  putStr(env.terrosCfFinanceProduct, financeProductName);

  // ── New pricing fields ────────────────────────────────────────────────────
  putNum(env.terrosCfNetCost,          po?.netCost);
  putNum(env.terrosCfGrossCost,        po?.grossCost);
  putNum(env.terrosCfGrossPpw,         po?.grossPPW);
  putNum(env.terrosCfDownPayment,      po?.downPayment);
  putNum(env.terrosCfDealerFee,        po?.dealerFeePercent);
  putNum(env.terrosCfFederalRebate,    po?.federalRebateTotal);

  // ── Consumption / utility ─────────────────────────────────────────────────
  const cp = po?.design?.consumptionProfile;
  putStr(env.terrosCfUtilityCompany,    cp?.utility?.name);
  putNum(env.terrosCfAnnualConsumption, cp?.annualConsumption);
  putNum(env.terrosCfAvgMonthlyBill,    cp?.averageMonthlyBill);

  // Solar offset — send as string percentage (e.g. "87.5") since the Terros field is Text type
  const offsetRaw = po?.design?.offset;
  if (typeof offsetRaw === "number" && Number.isFinite(offsetRaw)) {
    const offsetPct = Math.round(offsetRaw * 10000) / 100;
    putStr(env.terrosCfSolarOffset, String(offsetPct));
  }

  // ── Equipment ─────────────────────────────────────────────────────────────
  const firstArray = po?.design?.arrays?.[0];
  putStr(env.terrosCfPanelModel,   firstArray?.module?.name);
  putNum(env.terrosCfPanelWattage, firstArray?.module?.capacity);

  const firstInverter = po?.design?.inverters?.[0];
  putStr(env.terrosCfInverterModel, firstInverter?.name);

  putStr(env.terrosCfMountingType, po?.design?.mountingType);
  putNum(env.terrosCfBatteryCount, po?.design?.batteryCount);

  // ── Deal state ────────────────────────────────────────────────────────────
  putStr(env.terrosCfFinancingStatus, payload.deal?.state?.financingStatus);

  return out;
}

/** Truncate for DB logs only — never slice before JSON.parse */
const MAX_LOG_PREVIEW_CHARS = 2000;
function logPreview(body: string): string {
  if (body.length <= MAX_LOG_PREVIEW_CHARS) return body;
  return `${body.slice(0, MAX_LOG_PREVIEW_CHARS)}…`;
}

/** Terros often uses HTTP 200 even when the JSON body is `{ "type": "error", ... }`. */
function terrosJsonBodyIndicatesSuccess(responseText: string): boolean {
  try {
    const j = JSON.parse(responseText) as Record<string, unknown>;
    if (j.type === "error") return false;
  } catch {
    /* non-JSON body — treat as success if caller already got 2xx */
  }
  return true;
}

function terrosEventNoteText(evt: Record<string, unknown>): string {
  const note = evt.note ?? evt.notes ?? "";
  return typeof note === "string" ? note : String(note);
}

function terrosEventHasEnerfloMarker(evt: Record<string, unknown>, enerfloAppointmentId: number): boolean {
  return terrosEventNoteText(evt).includes(`[Enerflo:${enerfloAppointmentId}]`);
}

function isWebhookRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Terros `/user/list` → find user ID by email match.
 *  `/user/get` always returns the API key user and ignores the email param. */
/**
 * Resolve a numeric Enerflo user ID → email by paging through /api/v3/users.
 * Returns null if not found or on error.
 */
async function fetchEnerfloUserEmailByNumericId(
  enerfloBase: string,
  enerfloKey: string,
  numericId: string | number
): Promise<string | null> {
  if (!numericId || !enerfloKey) return null;
  const target = String(numericId);
  // Page through all users (1200+) — a low page cap would miss reps past the
  // cutoff and fail to resolve their email. MAX_PAGES is a safety guard.
  // Enerflo ignores `pageSize` (caps at 100) — use `per_page` instead.
  const PAGE_SIZE = 500;
  const MAX_PAGES = 100;
  let seen = 0;
  for (let page = 1; page <= MAX_PAGES; page++) {
    try {
      const r = await fetch(
        `${enerfloBase}/api/v3/users?page=${page}&per_page=${PAGE_SIZE}`,
        { headers: { "api-key": enerfloKey, "Content-Type": "application/json" } }
      );
      if (!r.ok) break;
      const parsed = JSON.parse(await r.text()) as Record<string, unknown>;
      const rows = (parsed.results ?? parsed.items ?? parsed.users ?? parsed.data) as Record<string, unknown>[] | undefined;
      if (!Array.isArray(rows) || rows.length === 0) break;
      const match = rows.find(u => String(u.id ?? u.user_id) === target);
      if (match) return (match.email ?? match.user_email) as string | null ?? null;
      seen += rows.length;
      const total = typeof parsed.dataCount === "number" ? parsed.dataCount : undefined;
      if (total != null && seen >= total) break;
      if (rows.length < PAGE_SIZE) break;
    } catch { break; }
  }
  return null;
}

/** Prefer nested lead owner keys; fallback object may hold `leadOwner` only on some tenants. */
function extractCustomerCreatedLeadOwnerRefs(
  customer: CustomerCreatedPayload["customer"],
  payloadRoot: Record<string, unknown>
): { email?: string; id?: string; source?: string } {
  // Only explicit lead-owner shapes — not `salesRep` / `owner` (Terros visibility still depends on
  // whether Terros assigns the API key user when we omit `ownerId`; see handler comment).
  const keys = ["leadOwner", "lead_owner", "leadOwnerUser", "lead_owner_user"] as const;
  const buckets: Record<string, unknown>[] = [payloadRoot];
  if (isWebhookRecord(customer)) buckets.push(customer as Record<string, unknown>);

  for (const b of buckets) {
    for (const k of keys) {
      const v = b[k];
      if (!isWebhookRecord(v)) continue;
      const em = v.email ?? v.Email;
      if (typeof em === "string" && em.includes("@")) {
        return { email: em.trim(), source: k };
      }
      const id = v.id ?? v.uuid ?? v.userId ?? v.user_id;
      if (typeof id === "string" && id.trim()) {
        return { id: id.trim(), source: k };
      }
    }
  }
  return {};
}

interface EnerfloUser {
  id?: string | number;
  uuid?: string;
  email?: string;
}

function extractUsers(parsed: unknown): EnerfloUser[] {
  if (!parsed || typeof parsed !== "object") return [];
  const p = parsed as Record<string, unknown>;
  for (const key of ["results", "data", "users", "items"]) {
    if (Array.isArray(p[key])) return p[key] as EnerfloUser[];
  }
  if (Array.isArray(parsed)) return parsed as EnerfloUser[];
  return [];
}

/** Single GET /users/{id} then paginated /users until email found for that id */
async function resolveEnerfloUserEmailByLookupId(
  enerfloBase: string,
  enerfloKey: string,
  lookupId: string
): Promise<{ email: string | null; lastStatus: number | null; lastPreview: string }> {
  if (!lookupId) {
    return { email: null, lastStatus: null, lastPreview: "" };
  }
  // If lookupId is already an email (extracted directly from owner.user.email), return it
  if (lookupId.includes("@")) {
    return { email: lookupId.trim(), lastStatus: null, lastPreview: "email-passthrough" };
  }
  const headers = { "api-key": enerfloKey, "Content-Type": "application/json" };
  let lastStatus: number | null = null;
  let lastPreview = "";

  try {
    const singleUrl = `${enerfloBase}/api/v3/users/${encodeURIComponent(lookupId)}`;
    const res = await fetch(singleUrl, { method: "GET", headers });
    lastStatus = res.status;
    const rawBody = await res.text();
    lastPreview = rawBody;
    if (res.ok) {
      const e = parseUserEmailFromJsonBody(rawBody);
      if (e) return { email: e, lastStatus, lastPreview };
    }
  } catch (e) {
    lastPreview = e instanceof Error ? e.message : String(e);
  }

  try {
    // Enerflo ignores `pageSize` — use `per_page` instead (returns all users at once).
    for (let page = 1; page <= 50; page++) {
      const listUrl = `${enerfloBase}/api/v3/users?page=${page}&per_page=500`;
      const res = await fetch(listUrl, { method: "GET", headers });
      lastStatus = res.status;
      const rawBody = await res.text();
      lastPreview = rawBody;
      if (!res.ok) break;
      const users = extractUsers(JSON.parse(rawBody) as unknown);
      const match = users.find((u) => repUserRecordMatchesLookup(u, lookupId));
      if (match?.email) return { email: match.email, lastStatus, lastPreview };
      if (users.length < 500) break;
    }
  } catch (e) {
    lastPreview = e instanceof Error ? e.message : String(e);
  }

  return { email: null, lastStatus, lastPreview };
}

function parseUserEmailFromJsonBody(rawBody: string): string | null {
  try {
    const parsed = JSON.parse(rawBody) as Record<string, unknown>;
    const u = (parsed.user ?? parsed.data ?? parsed) as Record<string, unknown>;
    const email = (u.email as string | undefined) ?? (u.Email as string | undefined);
    if (email && String(email).trim()) return String(email).trim();
  } catch {
    /* ignore */
  }
  return null;
}

/** Match deal.salesRep.id / initiatedBy UUID against Enerflo user list fields */
function repUserRecordMatchesLookup(u: EnerfloUser, repLookupId: string): boolean {
  const want = String(repLookupId).toLowerCase();
  const rec = u as Record<string, unknown>;
  const candidates: unknown[] = [
    u.id,
    u.uuid,
    rec.user_uuid,
    rec.userUuid,
    rec.external_user_id,
    rec.guid,
    rec.v2_id,
    rec.v2_user_id,
    rec.enerflo_user_id,
    rec.user_id,
    rec.enerfloUserId,
  ];
  return candidates.some((c) => c != null && String(c).toLowerCase() === want);
}

interface AppointmentAccountResolution {
  accountId: string | null;
  accountOwnerIdFromLookup: string | null;
  accountLocation: Record<string, unknown> | null;
  customerUuid: string | null;
  v3Customer: Record<string, unknown>;
  enerfloSetterNumericId: string | null;
  enerfloAgentNumericId: string | null;
  step1Source: string;
  step1Ok: boolean;
  step1Status: number | null;
  step1Preview: string;
}

async function fetchTerrosAccountRecord(
  terrosBase: string,
  terrosKey: string,
  accountId: string,
): Promise<Record<string, unknown> | null> {
  try {
    const r = await fetch(`${terrosBase}/account/get`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `ApiKey ${terrosKey}` },
      body: JSON.stringify({ accountId }),
    });
    const raw = await r.text();
    if (!r.ok || !terrosJsonBodyIndicatesSuccess(raw)) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return (parsed.account ?? parsed) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function searchTerrosAccountByQuery(
  terrosBase: string,
  terrosKey: string,
  query: string,
): Promise<Record<string, unknown> | null> {
  const trimmed = query.trim();
  if (!trimmed) return null;
  try {
    const r = await fetch(`${terrosBase}/account/list`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `ApiKey ${terrosKey}` },
      body: JSON.stringify({ size: 10, searchInput: { query: trimmed } }),
    });
    const raw = await r.text();
    if (!r.ok || !terrosJsonBodyIndicatesSuccess(raw)) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const accounts = parsed.accounts as Record<string, unknown>[] | undefined;
    return Array.isArray(accounts) && accounts.length > 0 ? accounts[0]! : null;
  } catch {
    return null;
  }
}

function buildLocationFromAppointmentCustomer(
  payload: NewAppointmentPayload,
  v3Customer: Record<string, unknown>,
): Record<string, unknown> | null {
  const payloadAddr = payload.customer?.address;
  const v3Addr = v3Customer.address as Record<string, unknown> | undefined;
  const street = String(payloadAddr?.street ?? v3Addr?.street ?? v3Addr?.line1 ?? "").trim();
  const city = String(payloadAddr?.city ?? v3Addr?.city ?? v3Addr?.locality ?? "").trim();
  const state = String(payloadAddr?.state ?? v3Addr?.state ?? v3Addr?.countrySubd ?? "").trim();
  const zip = String(payloadAddr?.zip ?? v3Addr?.zip ?? v3Addr?.postalCode ?? v3Addr?.postal1 ?? "").trim();
  const fullAddress = String(payloadAddr?.full_address ?? v3Addr?.full_address ?? v3Addr?.oneLine ?? "").trim();
  if (!street && !city && !fullAddress) return null;

  const location: Record<string, unknown> = {
    ...(street ? { line1: street } : {}),
    ...(fullAddress ? { oneLine: fullAddress } : {}),
    ...(city ? { locality: city } : {}),
    ...(state ? { countrySubd: state } : {}),
    ...(zip ? { postal1: zip } : {}),
  };
  const lat = payloadAddr?.latitude ?? v3Addr?.latitude;
  const lng = payloadAddr?.longitude ?? v3Addr?.longitude;
  if (lat && lng) {
    location.latitude = parseFloat(String(lat));
    location.longitude = parseFloat(String(lng));
  }
  return location;
}

function buildTerrosAccountFieldsFromAppointment(
  payload: NewAppointmentPayload,
  v3Customer: Record<string, unknown>,
  customerUuid: string | null,
  customerNumericId: string,
  terrosWorkflowId: string,
): Record<string, unknown> | null {
  const firstName = String(payload.customer?.first_name ?? v3Customer.first_name ?? "").trim();
  const lastName = String(payload.customer?.last_name ?? v3Customer.last_name ?? "").trim();
  const customerName = `${firstName} ${lastName}`.trim();
  const customerEmail = String(payload.customer?.email ?? v3Customer.email ?? "").trim();
  const customerPhone = sanitizePhone(
    String(payload.customer?.phone ?? v3Customer.phone ?? v3Customer.mobile ?? ""),
  );
  const location = buildLocationFromAppointmentCustomer(payload, v3Customer);

  if (!customerName && !customerEmail && !customerPhone && !location) return null;

  const externalLeadId = customerNumericId || customerUuid;
  if (!externalLeadId) return null;

  const resident: Record<string, string> = {};
  if (customerName) resident.name = customerName;
  if (firstName) resident.firstName = firstName;
  if (lastName) resident.lastName = lastName;
  if (customerEmail) resident.email = customerEmail;
  if (customerPhone) resident.phone = customerPhone;

  return {
    externalLeadId,
    ...(customerName ? { name: customerName } : {}),
    ...(terrosWorkflowId ? { workflowId: terrosWorkflowId } : {}),
    ...(Object.keys(resident).length > 0 ? { resident } : {}),
    ...(location ? { location } : {}),
  };
}

/**
 * Find an existing Terros account without creating empty shells.
 * Only upserts when no match is found AND we have enough customer data to populate resident/location.
 */
async function resolveTerrosAccountForAppointment(
  payload: NewAppointmentPayload,
  enerfloBase: string,
  enerfloKey: string,
  terrosBase: string,
  terrosKey: string,
  terrosWorkflowId: string,
): Promise<AppointmentAccountResolution> {
  const customerNumericId = String(payload.customer?.id ?? "");
  const customerEmail = String(payload.customer?.email ?? "").trim();
  const customerPhone = sanitizePhone(payload.customer?.phone ?? "") ?? "";
  const customerName = `${payload.customer?.first_name ?? ""} ${payload.customer?.last_name ?? ""}`.trim();

  let customerUuid: string | null = null;
  let v3Customer: Record<string, unknown> = {};
  let enerfloSetterNumericId: string | null = null;
  let enerfloAgentNumericId: string | null = null;
  let accountId: string | null = null;
  let accountOwnerIdFromLookup: string | null = null;
  let accountLocation: Record<string, unknown> | null = null;
  let step1Source = "";
  let step1Ok = false;
  let step1Status: number | null = null;
  let step1Preview = "";

  if (customerNumericId && enerfloKey) {
    try {
      const r = await fetch(`${enerfloBase}/api/v3/customers/${encodeURIComponent(customerNumericId)}`, {
        headers: { "api-key": enerfloKey, "Content-Type": "application/json" },
      });
      if (r.ok) {
        v3Customer = JSON.parse(await r.text()) as Record<string, unknown>;
        customerUuid = getEnerfloCustomerUuid(v3Customer) ?? getEnerfloIntegrationExternalId(v3Customer);
        if (v3Customer.setter_user_id) enerfloSetterNumericId = String(v3Customer.setter_user_id);
        if (v3Customer.agent_user_id) enerfloAgentNumericId = String(v3Customer.agent_user_id);
      }
    } catch { /* best-effort */ }
  }

  const v3Email = String(v3Customer.email ?? "").trim();
  const emailForSearch = customerEmail || v3Email;
  const v3Phone = sanitizePhone(String(v3Customer.phone ?? v3Customer.mobile ?? "")) ?? "";
  const phoneForSearch = customerPhone || v3Phone;
  const v3Name = `${v3Customer.first_name ?? ""} ${v3Customer.last_name ?? ""}`.trim();
  const nameForSearch = customerName || v3Name;

  const applyAccountMatch = (acc: Record<string, unknown>, source: string) => {
    accountId = String(acc.accountId ?? acc.id ?? "").trim() || null;
    accountOwnerIdFromLookup = (acc.ownerId as string | undefined) ?? null;
    if (acc.location && typeof acc.location === "object") {
      accountLocation = acc.location as Record<string, unknown>;
    }
    step1Source = source;
    step1Ok = Boolean(accountId);
  };

  if (terrosKey) {
    const terrosAccountFromMap = getTerrosAccountIdFromIntegrationMaps(v3Customer);
    if (terrosAccountFromMap) {
      const acc = await fetchTerrosAccountRecord(terrosBase, terrosKey, terrosAccountFromMap);
      if (acc) applyAccountMatch(acc, "get:integration-map");
    }

    if (!accountId && emailForSearch) {
      const acc = await searchTerrosAccountByQuery(terrosBase, terrosKey, emailForSearch);
      if (acc) applyAccountMatch(acc, "list:email");
    }

    if (!accountId && customerNumericId) {
      const acc = await searchTerrosAccountByQuery(terrosBase, terrosKey, customerNumericId);
      if (acc) applyAccountMatch(acc, "list:numeric-id");
    }

    if (!accountId && customerUuid) {
      const acc = await searchTerrosAccountByQuery(terrosBase, terrosKey, customerUuid);
      if (acc) applyAccountMatch(acc, "list:uuid");
    }

    if (!accountId) {
      const resolvedId = await resolveTerrosAccountForInstalls({
        customer: v3Customer,
        uuid: customerUuid ?? "",
        numericId: customerNumericId,
        email: emailForSearch,
        phone: phoneForSearch,
        name: nameForSearch,
        addressLine1: payload.customer?.address?.street,
        city: payload.customer?.address?.city,
        zip: payload.customer?.address?.zip,
        maps: {
          terrosExternalLeadIdToAccount: new Map(),
          terrosEmailToAccount: new Map(),
          terrosPhoneToAccount: new Map(),
          terrosAccounts: [],
        },
        terrosBase,
        terrosKey,
        searchCache: createTerrosSearchCache(),
      });
      if (resolvedId) {
        const acc = await fetchTerrosAccountRecord(terrosBase, terrosKey, resolvedId);
        if (acc) applyAccountMatch(acc, "matcher:installs");
      }
    }

    if (!accountId) {
      const accountFields = buildTerrosAccountFieldsFromAppointment(
        payload,
        v3Customer,
        customerUuid,
        customerNumericId,
        terrosWorkflowId,
      );
      if (accountFields) {
        try {
          const r = await fetch(`${terrosBase}/account/upsert`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `ApiKey ${terrosKey}` },
            body: JSON.stringify({ account: accountFields }),
          });
          step1Status = r.status;
          const raw = await r.text();
          step1Preview = raw.slice(0, 300);
          step1Ok = r.ok && terrosJsonBodyIndicatesSuccess(raw);
          if (step1Ok) {
            const parsed = JSON.parse(raw) as Record<string, unknown>;
            const acc = (parsed.account ?? parsed) as Record<string, unknown>;
            if (acc?.accountId) {
              applyAccountMatch(acc, "upsert:full-fields");
            }
          }
        } catch (e) {
          step1Preview = e instanceof Error ? e.message : String(e);
        }
      } else {
        step1Source = "skipped:no-customer-data";
        step1Preview = "No Terros account found and insufficient customer data to create one safely.";
      }
    }
  }

  return {
    accountId,
    accountOwnerIdFromLookup,
    accountLocation,
    customerUuid,
    v3Customer,
    enerfloSetterNumericId,
    enerfloAgentNumericId,
    step1Source,
    step1Ok,
    step1Status,
    step1Preview,
  };
}

// ── new_appointment ──────────────────────────────────────────────────────────
/**
 * Flow:
 *  1 [best-effort] Find existing Terros account (search only); create with full
 *    customer fields only when no match exists.
 *  2 [best-effort] Resolve assignee.email → Terros closerUserId via user/list.
 *  3 [best-effort] account/update — set Appointment stage + closerId.
 *  4 [skipped]     Calendar event handled by update_appointment.
 */
async function handleNewAppointment(payload: NewAppointmentPayload): Promise<NextResponse> {
  const enerfloBase  = (env.enerfloV1BaseUrl  ?? "https://enerflo.io").replace(/\/$/, "");
  const enerfloKey   = env.enerfloV1ApiKey   ?? "";
  const terrosBase   = (env.terrosApiBaseUrl  ?? "https://api.terros.com").replace(/\/$/, "");
  const terrosKey    = env.terrosApiKey       ?? "";
  const terrosWorkflowId      = env.terrosWorkflowId                    ?? "";
  const appointmentStageId    = env.terrosWorkflowAppointmentStageId    ?? "";

  const enerfloAppointmentId  = payload.id;
  const startTimeMs           = payload.times.unix.unix_time * 1000;
  const durationMinutes       = payload.length_minutes;
  const assigneeEmail         = payload.assignee?.email?.trim() ?? "";
  const customerNumericId     = String(payload.customer?.id ?? "");
  const customerEmail         = payload.customer?.email?.trim() ?? "";
  const customerAddr          = payload.customer?.address;
  // Stamp the Enerflo appointment ID so update_appointment can find the right event later
  const notesBase             = [payload.external_notes, payload.internal_notes]
                                  .filter(Boolean).join("\n").trim();
  const notes                 = [`[Enerflo:${payload.id}]`, notesBase].filter(Boolean).join("\n");

  // ── Step 1: find Terros account (search-first; no bare upsert) ───────────

  const accountResolution = await resolveTerrosAccountForAppointment(
    payload,
    enerfloBase,
    enerfloKey,
    terrosBase,
    terrosKey,
    terrosWorkflowId,
  );
  let accountId = accountResolution.accountId;
  let accountOwnerIdFromLookup = accountResolution.accountOwnerIdFromLookup;
  const step1Source = accountResolution.step1Source;
  const step1Status = accountResolution.step1Status;
  let step1Ok = accountResolution.step1Ok;
  const step1Preview = accountResolution.step1Preview;
  const customerUuid = accountResolution.customerUuid;
  const enerfloSetterNumericId = accountResolution.enerfloSetterNumericId;
  const enerfloAgentNumericId = accountResolution.enerfloAgentNumericId;

  // Resolve setter (or agent) → Terros ownerId for the calendar event "Setter" field
  let eventOwnerIdFromSetter: string | null = null;
  if (terrosKey && enerfloKey && (enerfloSetterNumericId || enerfloAgentNumericId)) {
    const setterEmail = enerfloSetterNumericId
      ? await fetchEnerfloUserEmailByNumericId(enerfloBase, enerfloKey, enerfloSetterNumericId)
      : null;
    const agentEmail  = enerfloAgentNumericId
      ? await fetchEnerfloUserEmailByNumericId(enerfloBase, enerfloKey, enerfloAgentNumericId)
      : null;
    const emailToUse  = setterEmail || agentEmail;
    if (emailToUse) {
      const resolved = await resolveTerrosUserIdByEmail(terrosBase, terrosKey, emailToUse);
      eventOwnerIdFromSetter = resolved.userId;
    }
  }

  await writeApiLog({
    operation: "webhook:enerflo-v2:new-appointment:find-terros-account",
    vendor: "terros",
    method: "POST",
    url: `${terrosBase}/account/get|list|upsert`,
    hadApiKey: Boolean(terrosKey),
    status: step1Status,
    ok: step1Ok,
    responsePreview: JSON.stringify({ step1Source, step1Preview }).slice(0, 400),
  });

  // ── Step 2: resolve assignee email → Terros closerUserId ─────────────────

  let closerUserId: string | null = null;
  let step2Preview = "";
  if (assigneeEmail && terrosKey) {
    const u = await resolveTerrosUserIdByEmail(terrosBase, terrosKey, assigneeEmail);
    closerUserId = u.userId;
    step2Preview = u.preview;
    await writeApiLog({
      operation: "webhook:enerflo-v2:new-appointment:resolve-closer",
      vendor: "terros",
      method: "POST",
      url: `${terrosBase}/user/list`,
      hadApiKey: Boolean(terrosKey),
      status: u.status,
      ok: u.ok,
      responsePreview: u.preview,
    });
  }

  // ── Step 3: update account — Appointment stage (account/update) + closerId (account/upsert) ──
  // account/update sets workflowStageId but does NOT persist the displayed Closer field.
  // account/upsert with externalLeadId is required to set closerId in the Assignment panel.

  let step3Ok     = false;
  let step3Status: number | null = null;
  let step3Preview = "";
  if (accountId && terrosKey) {
    // 3a: account/update — set workflow stage (once per appointment).
    // Guarded so the repeated new_appointment/update_appointment deliveries don't
    // spam the account history with duplicate "Stage: Appointment" entries.
    if (appointmentStageId && await acquireAppointmentStageLock(enerfloAppointmentId)) {
      try {
        const r = await fetch(`${terrosBase}/account/update`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `ApiKey ${terrosKey}` },
          body: JSON.stringify({
            account: {
              accountId,
              workflowStageId: appointmentStageId,
              ...(closerUserId ? { actorId: closerUserId } : {}),
            },
          }),
        });
        step3Status  = r.status;
        const raw    = await r.text();
        step3Preview = raw.slice(0, 300);
        step3Ok      = r.ok && terrosJsonBodyIndicatesSuccess(raw);
      } catch (e) {
        step3Preview = e instanceof Error ? e.message : String(e);
      }

      await writeApiLog({
        operation: "webhook:enerflo-v2:new-appointment:update-account-stage",
        vendor: "terros",
        method: "POST",
        url: `${terrosBase}/account/update`,
        hadApiKey: Boolean(terrosKey),
        status: step3Status,
        ok: step3Ok,
        responsePreview: step3Preview,
      });
    }

    // 3b: account/upsert — set closerId using the accountId we already resolved in step 1.
    // Using accountId (not externalLeadId) prevents creating duplicate accounts.
    if (closerUserId && accountId) {
      let step3bOk = false;
      let step3bStatus: number | null = null;
      let step3bPreview = "";
      try {
        const r = await fetch(`${terrosBase}/account/upsert`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `ApiKey ${terrosKey}` },
          body: JSON.stringify({
            account: {
              accountId,
              closerId: closerUserId,
              actorId: closerUserId,
            },
          }),
        });
        step3bStatus  = r.status;
        const raw     = await r.text();
        step3bPreview = raw.slice(0, 300);
        step3bOk      = r.ok && terrosJsonBodyIndicatesSuccess(raw);
      } catch (e) {
        step3bPreview = e instanceof Error ? e.message : String(e);
      }

      await writeApiLog({
        operation: "webhook:enerflo-v2:new-appointment:upsert-account-closer",
        vendor: "terros",
        method: "POST",
        url: `${terrosBase}/account/upsert`,
        hadApiKey: Boolean(terrosKey),
        status: step3bStatus,
        ok: step3bOk,
        responsePreview: step3bPreview,
      });
    }
  }

  // ── Step 4: /calendar/event/add ──────────────────────────────────────────

  // Calendar event creation is intentionally NOT done here.
  // Enerflo fires both new_appointment and update_appointment for every appointment creation,
  // causing a race condition where both handlers run simultaneously, both find no existing event,
  // and both create a duplicate. update_appointment is responsible for all calendar event
  // creation/updates — it fires immediately after new_appointment and has proper dedup logic.
  const step4Ok      = false;
  const step4Status: number | null = null;
  const step4Preview = "skipped: calendar event handled by update_appointment";
  const calendarEventId: string | null = null;
  const step4Action  = "skipped-handled-by-update";

  return NextResponse.json({
    received: true,
    event: "new_appointment",
    enerfloAppointmentId,
    customerNumericId,
    customerUuid,
    accountId,
    step1Source,
    closerUserId,
    appointmentStageId: appointmentStageId || null,
    stageUpdate: { ok: step3Ok, status: step3Status, preview: step3Preview },
    calendarEvent: {
      ok:      step4Ok,
      action:  step4Action,
      status:  step4Status,
      eventId: calendarEventId,
      preview: step4Preview,
    },
  });
}

// ── update_appointment ────────────────────────────────────────────────────────
/**
 * Flow:
 *  1 [best-effort]  Find Terros account via Enerflo customer UUID → externalLeadId,
 *                   or fall back to account/list by email.
 *  2 [best-effort]  Resolve assignee.email → Terros closerUserId.
 *  3 [best-effort]  Update account: set Appointment stage + closerId.
 *  4 [best-effort]  Find existing Terros calendar event by searching notes for
 *                   "[Enerflo:{id}]" marker, then update it with new time/duration/closer.
 *                   If not found, create a new event as fallback.
 */
async function handleUpdateAppointment(payload: NewAppointmentPayload): Promise<NextResponse> {
  const enerfloBase  = (env.enerfloV1BaseUrl  ?? "https://enerflo.io").replace(/\/$/, "");
  const enerfloKey   = env.enerfloV1ApiKey   ?? "";
  const terrosBase   = (env.terrosApiBaseUrl  ?? "https://api.terros.com").replace(/\/$/, "");
  const terrosKey    = env.terrosApiKey       ?? "";
  const terrosWorkflowId   = env.terrosWorkflowId ?? "";
  const appointmentStageId = env.terrosWorkflowAppointmentStageId ?? "";

  const enerfloAppointmentId = payload.id;
  const startTimeMs          = payload.times.unix.unix_time * 1000;
  const durationMinutes      = payload.length_minutes;
  const assigneeEmail        = payload.assignee?.email?.trim() ?? "";
  const customerNumericId    = String(payload.customer?.id ?? "");
  const customerEmail        = payload.customer?.email?.trim() ?? "";
  const customerAddr         = payload.customer?.address;
  const notesBase            = [payload.external_notes, payload.internal_notes]
                                 .filter(Boolean).join("\n").trim();
  const notes                = [`[Enerflo:${enerfloAppointmentId}]`, notesBase].filter(Boolean).join("\n");

  // ── Step 1: find Terros account (search-first; no bare upsert) ───────────

  const accountResolution = await resolveTerrosAccountForAppointment(
    payload,
    enerfloBase,
    enerfloKey,
    terrosBase,
    terrosKey,
    terrosWorkflowId,
  );
  const accountId = accountResolution.accountId;
  const accountOwnerIdFromLookup = accountResolution.accountOwnerIdFromLookup;
  const step1Source = accountResolution.step1Source;
  const customerUuid = accountResolution.customerUuid;
  const accountLocation = accountResolution.accountLocation;
  const enerfloSetterNumericId = accountResolution.enerfloSetterNumericId;
  const enerfloAgentNumericId = accountResolution.enerfloAgentNumericId;

  // Resolve setter (or agent) → Terros ownerId for the calendar event "Setter" field
  let eventOwnerIdFromSetter: string | null = null;
  if (terrosKey && enerfloKey && (enerfloSetterNumericId || enerfloAgentNumericId)) {
    const setterEmail = enerfloSetterNumericId
      ? await fetchEnerfloUserEmailByNumericId(enerfloBase, enerfloKey, enerfloSetterNumericId)
      : null;
    const agentEmail  = enerfloAgentNumericId
      ? await fetchEnerfloUserEmailByNumericId(enerfloBase, enerfloKey, enerfloAgentNumericId)
      : null;
    const emailToUse  = setterEmail || agentEmail;
    if (emailToUse) {
      const resolved = await resolveTerrosUserIdByEmail(terrosBase, terrosKey, emailToUse);
      eventOwnerIdFromSetter = resolved.userId;
    }
  }

  // ── Build location (shared by step 3b account update and step 4 event) ──
  // Prefer address from the Enerflo payload; fall back to the Terros account's
  // existing location (captured from the account lookup above).
  const hasPayloadAddr = !!(customerAddr?.street || customerAddr?.city || customerAddr?.full_address);
  const payloadLocation = buildLocationFromAppointmentCustomer(payload, accountResolution.v3Customer);
  const resolvedLocation: Record<string, unknown> | null = hasPayloadAddr
    ? (payloadLocation ?? {
        ...(customerAddr!.street       ? { line1:       customerAddr!.street }      : {}),
        ...(customerAddr!.full_address ? { oneLine:     customerAddr!.full_address } : {}),
        ...(customerAddr!.city         ? { locality:    customerAddr!.city }         : {}),
        ...(customerAddr!.state        ? { countrySubd: customerAddr!.state }        : {}),
        ...(customerAddr!.zip          ? { postal1:     customerAddr!.zip }          : {}),
        ...((customerAddr!.latitude && customerAddr!.longitude) ? {
          latitude:  parseFloat(customerAddr!.latitude),
          longitude: parseFloat(customerAddr!.longitude),
        } : {}),
      })
    : (accountLocation ?? payloadLocation);

  // ── Step 2: resolve closer ────────────────────────────────────────────────

  let closerUserId: string | null = null;
  if (assigneeEmail && terrosKey) {
    const resolved = await resolveTerrosUserIdByEmail(terrosBase, terrosKey, assigneeEmail);
    closerUserId = resolved.userId;
  }

  // ── Step 3: update account stage + closer ────────────────────────────────
  // account/update sets workflowStageId but does NOT persist the displayed Closer field.
  // account/upsert with externalLeadId is required to set closerId in the Assignment panel.

  let step3Ok      = false;
  let step3Status: number | null = null;
  let step3Preview = "";

  if (accountId && terrosKey) {
    // 3a: account/update — set workflow stage (once per appointment).
    // Guarded so the repeated new_appointment/update_appointment deliveries don't
    // spam the account history with duplicate "Stage: Appointment" entries.
    if (appointmentStageId && await acquireAppointmentStageLock(enerfloAppointmentId)) {
      try {
        const r = await fetch(`${terrosBase}/account/update`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `ApiKey ${terrosKey}` },
          body: JSON.stringify({
            account: {
              accountId,
              id: accountId,
              workflowStageId: appointmentStageId,
              ...(closerUserId ? { actorId: closerUserId } : {}),
            },
          }),
        });
        step3Status  = r.status;
        const raw    = await r.text();
        step3Ok      = r.ok && terrosJsonBodyIndicatesSuccess(raw);
        step3Preview = raw.slice(0, 400);
      } catch (e) {
        step3Preview = e instanceof Error ? e.message : String(e);
      }

      await writeApiLog({
        operation: "webhook:enerflo-v2:update-appointment:account-update",
        vendor: "terros",
        method: "POST",
        url: `${terrosBase}/account/update`,
        hadApiKey: Boolean(terrosKey),
        status: step3Status,
        ok: step3Ok,
        responsePreview: step3Preview,
      });
    }

    // 3b: account/update — set closerId + location on the EXACT account we found in step 1.
    // We use accountId (not externalLeadId) to avoid creating a duplicate account when the
    // externalLeadId stored in Terros (numeric) doesn't match what we'd look up (UUID or string).
    // account/update alone doesn't persist closerId in the Assignment panel, so we also call
    // account/upsert but with accountId to guarantee we're touching the right record.
    if ((closerUserId || resolvedLocation) && accountId) {
      let step3bOk = false;
      let step3bStatus: number | null = null;
      let step3bPreview = "";
      try {
        const r = await fetch(`${terrosBase}/account/upsert`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `ApiKey ${terrosKey}` },
          body: JSON.stringify({ account: {
            accountId,
            ...(closerUserId     ? { closerId: closerUserId }     : {}),
            ...(closerUserId     ? { actorId: closerUserId }      : {}),
            ...(resolvedLocation ? { location: resolvedLocation } : {}),
          } }),
        });
        step3bStatus  = r.status;
        const raw     = await r.text();
        step3bPreview = raw.slice(0, 300);
        step3bOk      = r.ok && terrosJsonBodyIndicatesSuccess(raw);
      } catch (e) {
        step3bPreview = e instanceof Error ? e.message : String(e);
      }

      await writeApiLog({
        operation: "webhook:enerflo-v2:update-appointment:upsert-account-closer",
        vendor: "terros",
        method: "POST",
        url: `${terrosBase}/account/upsert`,
        hadApiKey: Boolean(terrosKey),
        status: step3bStatus,
        ok: step3bOk,
        responsePreview: step3bPreview,
      });
    }
  }

  // ── Step 4: find + update (or create) Terros calendar event ──────────────

  let step4Ok      = false;
  let step4Status: number | null = null;
  let step4Preview = "";
  let calendarEventId: string | null = null;
  let step4Action  = "none";

  if (accountId && terrosKey) {
    // Acquire a distributed lock so concurrent update_appointment fires (Enerflo sends 2-3
    // for every appointment creation) don't all race to create the same event simultaneously.
    // The earliest writer among concurrent requests wins; the others skip event creation.
    const wonLock = await acquireCalendarEventLock(enerfloAppointmentId);
    if (!wonLock) {
      step4Action  = "skipped-lock-lost";
      step4Ok      = true;
      step4Preview = "Another concurrent update_appointment request won the lock — skipping to prevent duplicate.";
      await writeApiLog({
        operation: "webhook:enerflo-v2:update-appointment:find-existing-event",
        vendor: "terros",
        method: "POST",
        url: `${terrosBase}/calendar/event/list`,
        hadApiKey: Boolean(terrosKey),
        status: 200,
        ok: false,
        responsePreview: JSON.stringify({ enerfloAppointmentId, accountId, skipped: "lock-lost" }).slice(0, 400),
      });
    }

    if (!wonLock) {
      // fall through to return
    } else {
    // 4a: find the existing Terros event for this Enerflo appointment.
    // Strategy order (most → least reliable):
    //   1) Supabase id-map   — saved when we first created the event; survives date changes
    //   2) notes [Enerflo:ID]— in the event list (only works if Terros returns notes in list)
    //   3) title + eventDate — fallback for events created before the id-map feature
    let existingEventId: string | null = null;
    let step4ListPreview = "";

    // Strategy 1: Supabase mapping (most reliable for updates)
    existingEventId = await getCalendarEventId(enerfloAppointmentId);

    // Strategies 2 & 3: search the event list (needed when id-map has no entry yet)
    if (!existingEventId) {
      try {
        const listRes = await fetch(`${terrosBase}/calendar/event/list`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `ApiKey ${terrosKey}` },
          body: JSON.stringify({ accountId, size: 200 }),
        });
        if (listRes.ok) {
          const raw    = await listRes.text();
          step4ListPreview = raw.slice(0, 600);
          const parsed = JSON.parse(raw) as Record<string, unknown>;
          const evts   = parsed.events as Record<string, unknown>[] | undefined;
          if (Array.isArray(evts) && evts.length > 0) {
            // Strategy 2: [Enerflo:ID] marker in note or notes
            const byNotes = evts.find(e => terrosEventHasEnerfloMarker(e, enerfloAppointmentId));
            if (byNotes) {
              existingEventId = (byNotes.eventId ?? byNotes.id) as string;
            } else {
              // Strategy 3: title match (Enerflo "In-Home – Name" vs Terros "Consultation")
              const apptTypeName2 = payload.appointment_type?.name ?? "Consultation";
              const expectedTitle = `${apptTypeName2} – ${payload.customer?.first_name ?? ""} ${payload.customer?.last_name ?? ""}`.trim();
              const byTitle = evts.find(e =>
                typeof e.title === "string" && e.title === expectedTitle
              );
              if (byTitle) {
                existingEventId = (byTitle.eventId ?? byTitle.id) as string;
              } else {
                // Strategy 3b: same start time (Terros often titles events "Consultation")
                const byDate = evts.find(e => {
                  const rawDate = e.eventDate ?? e.startDate;
                  if (rawDate == null) return false;
                  const evtMs =
                    typeof rawDate === "number" ? rawDate : new Date(String(rawDate)).getTime();
                  if (Number.isNaN(evtMs)) return false;
                  return Math.abs(evtMs - startTimeMs) < 60_000;
                });
                if (byDate) {
                  existingEventId = (byDate.eventId ?? byDate.id) as string;
                }
              }
            }
          }
        }
      } catch { /* best-effort */ }
    }

    // Log what we got back from list and whether we found a match
    await writeApiLog({
      operation: "webhook:enerflo-v2:update-appointment:find-existing-event",
      vendor: "terros",
      method: "POST",
      url: `${terrosBase}/calendar/event/list`,
      hadApiKey: Boolean(terrosKey),
      status: 200,
      ok: Boolean(existingEventId),
      responsePreview: JSON.stringify({
        enerfloAppointmentId,
        accountId,
        existingEventId,
        resolvedLocationUsed: resolvedLocation,
        listRaw: step4ListPreview,
      }).slice(0, 1200),
    });

    const apptTypeName = payload.appointment_type?.name ?? "Consultation";
    const eventTitle   = `${apptTypeName} – ${payload.customer?.first_name ?? ""} ${payload.customer?.last_name ?? ""}`.trim();

    const eventOwnerIdFinal = eventOwnerIdFromSetter ?? accountOwnerIdFromLookup;
    const eventFields: Record<string, unknown> = {
      eventType: "Consultation",
      title:     eventTitle || "Consultation",
      eventDate: startTimeMs,
      duration:  durationMinutes,
      notes,
      ...(eventOwnerIdFinal ? { ownerId: eventOwnerIdFinal }  : {}),
      // Only attendeeId — NOT closerId (undocumented field that hides the event
      // from the account Appointments section) and NOT actionId (same issue).
      ...(closerUserId      ? { attendeeId: closerUserId }    : {}),
      ...(resolvedLocation  ? { location: resolvedLocation }  : {}),
    };

    if (existingEventId) {
      // 4b: update the existing event
      step4Action = "update";
      const updateBody = { event: { eventId: existingEventId, ...eventFields } };
      try {
        const r = await fetch(`${terrosBase}/calendar/event/update`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `ApiKey ${terrosKey}` },
          body: JSON.stringify(updateBody),
        });
        step4Status  = r.status;
        const raw    = await r.text();
        step4Ok      = r.ok && terrosJsonBodyIndicatesSuccess(raw);
        step4Preview = JSON.stringify({
          requestBody: updateBody,
          responseStatus: r.status,
          responseBody: raw.slice(0, 600),
        }).slice(0, 1200);
        if (step4Ok) {
          try {
            const parsed = JSON.parse(raw) as Record<string, unknown>;
            const evt    = (parsed.event ?? parsed) as Record<string, unknown>;
            calendarEventId = evt.eventId as string | null ?? existingEventId;
          } catch { calendarEventId = existingEventId; }
        }
      } catch (e) {
        step4Preview = JSON.stringify({ requestBody: updateBody, error: String(e) });
      }
    } else {
      // 4c: no matching event found — create only when Terros truly has none
      const mappedTerrosId = await getCalendarEventId(enerfloAppointmentId);
      if (mappedTerrosId) {
        step4Action = "skipped-already-mapped";
        step4Ok = true;
        calendarEventId = mappedTerrosId;
        step4Preview = JSON.stringify({
          enerfloAppointmentId,
          accountId,
          skipped: "calendar-event-id-map",
          terrosEventId: mappedTerrosId,
        }).slice(0, 1200);
      } else {
      step4Action = "create";
      const createBody = { event: { accountId, ...eventFields } };
      try {
        const r = await fetch(`${terrosBase}/calendar/event/add`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `ApiKey ${terrosKey}` },
          body: JSON.stringify(createBody),
        });
        step4Status  = r.status;
        const raw    = await r.text();
        step4Ok      = r.ok && terrosJsonBodyIndicatesSuccess(raw);
        step4Preview = JSON.stringify({
          requestBody: createBody,
          responseStatus: r.status,
          responseBody: raw.slice(0, 600),
        }).slice(0, 1200);
        if (step4Ok) {
          try {
            const parsed = JSON.parse(raw) as Record<string, unknown>;
            const evt    = (parsed.event ?? parsed) as Record<string, unknown>;
            calendarEventId = (evt.eventId ?? evt.id) as string | null ?? null;
            if (calendarEventId) {
              await saveCalendarEventMapping(enerfloAppointmentId, calendarEventId);
            }
          } catch { /* ignore */ }
        }
      } catch (e) {
        step4Preview = JSON.stringify({ requestBody: createBody, error: String(e) });
      }
      }
    }

    await writeApiLog({
      operation: `webhook:enerflo-v2:update-appointment:calendar-event-${step4Action}`,
      vendor: "terros",
      method: "POST",
      url: `${terrosBase}/calendar/event/${step4Action === "update" ? "update" : "add"}`,
      hadApiKey: Boolean(terrosKey),
      status: step4Status,
      ok: step4Ok,
      responsePreview: step4Preview,
    });
    } // end else (wonLock)
  }

  return NextResponse.json({
    received: true,
    event: "update_appointment",
    enerfloAppointmentId,
    customerNumericId,
    customerUuid,
    accountId,
    step1Source,
    closerUserId,
    appointmentStageId: appointmentStageId || null,
    stageUpdate: { ok: step3Ok, status: step3Status, preview: step3Preview },
    calendarEvent: {
      ok:      step4Ok,
      action:  step4Action,
      status:  step4Status,
      eventId: calendarEventId,
      preview: step4Preview,
    },
  });
}

// ── update_customer / new_customer ───────────────────────────────────────────
/**
 * Flow:
 *  1 [best-effort]  Fetch Enerflo customer UUID via REST GET /api/v1/customers/{id}
 *                   (the v1 payload only has the numeric id).
 *  2 [best-effort]  Query Enerflo GraphQL fetchDealList to get salesRep + setter emails
 *                   for this customer — these are NOT in the webhook payload.
 *  3 [best-effort]  Resolve salesRep email → Terros ownerId, setter email → Terros closerId.
 *  4 [required]     Upsert Terros account by externalLeadId (customer UUID): update name,
 *                   address, contact info, ownerId, closerId.
 */
async function handleUpdateCustomer(payload: UpdateCustomerPayload): Promise<NextResponse> {
  const enerfloBase    = (env.enerfloV1BaseUrl      ?? "https://enerflo.io").replace(/\/$/, "");
  const enerfloKey     = env.enerfloV1ApiKey ?? "";
  const terrosBase     = (env.terrosApiBaseUrl ?? "https://api.terros.com").replace(/\/$/, "");
  const terrosKey      = env.terrosApiKey ?? "";

  const numericId     = String(payload.id ?? "");
  const customerEmail = payload.email?.trim() ?? "";
  const customerName  = `${payload.first_name ?? ""} ${payload.last_name ?? ""}`.trim();
  const addr          = payload.address;

  // ── Step 1: GET /api/v3/customers/{id} — uuid, agent_user_id, setter_user_id, office_id ──
  // v3 endpoint returns all assignment fields directly — no GraphQL needed.

  let customerUuid:         string | null = null;
  let terrosAccountIdFromMap: string | null = null;
  let agentNumericId:       string | null = null;
  let setterNumericId:      string | null = null;
  let v3CustomerRaw:        Record<string, unknown> = {};
  let step1Ok = false;

  if (numericId && enerfloKey) {
    try {
      const r = await fetch(`${enerfloBase}/api/v3/customers/${encodeURIComponent(numericId)}`, {
        headers: { "api-key": enerfloKey, "Content-Type": "application/json" },
      });
      if (r.ok) {
        const raw    = await r.text();
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        v3CustomerRaw = parsed;
        // Try top-level uuid/external_id first
        const topUuid = (parsed.uuid ?? parsed.external_id ?? payload.external_id) as string | undefined;
        if (topUuid && /^[0-9a-f-]{36}$/i.test(topUuid)) customerUuid = topUuid;
        // Fallback: extract UUID from integration_maps (Enerflo V2 stores it there)
        if (!customerUuid && Array.isArray(parsed.integration_maps)) {
          for (const map of parsed.integration_maps as Record<string, unknown>[]) {
            const extId = map.external_id as string | undefined;
            if (extId && /^[0-9a-f-]{36}$/i.test(extId)) {
              customerUuid = extId;
              break;
            }
          }
        }
        // Fallback: if still no UUID, look for a Terros Account ID in integration_maps
        // (accounts created in Terros first store "Account.xxx" as the external_id)
        if (!customerUuid && Array.isArray(parsed.integration_maps)) {
          for (const map of parsed.integration_maps as Record<string, unknown>[]) {
            const extId = map.external_id as string | undefined;
            if (extId?.startsWith("Account.")) {
              terrosAccountIdFromMap = extId;
              break;
            }
          }
        }
        if (parsed.agent_user_id)  agentNumericId  = String(parsed.agent_user_id);
        if (parsed.setter_user_id) setterNumericId = String(parsed.setter_user_id);
        // Prefer the v3 status (always current) over what the webhook payload sends
        if (parsed.status != null && String(parsed.status).trim()) {
          payload.status = String(parsed.status).trim();
        }
        step1Ok = true;
      }
    } catch { /* best-effort */ }

    await writeApiLog({
      operation: "webhook:enerflo-v2:update-customer:v3-fetch",
      vendor: "enerflo",
      method: "GET",
      url: `${enerfloBase}/api/v3/customers/${numericId}`,
      hadApiKey: Boolean(enerfloKey),
      status: null,
      ok: step1Ok,
      responsePreview: JSON.stringify(v3CustomerRaw).slice(0, 600),
    });

    if (step1Ok && numericId) {
      const terrosAccountFromMap = getTerrosAccountIdFromIntegrationMaps(v3CustomerRaw);
      const parsedNumericId = Number(numericId);
      if (terrosAccountFromMap && Number.isFinite(parsedNumericId)) {
        await saveCustomerAccountMapping(terrosAccountFromMap, parsedNumericId);
      }
    }
  }

  // ── Step 2–3: Lead owner (sales rep / agent → setter fallback) → Terros IDs ──
  const ownerResolution = await resolveEnerfloCustomerLeadOwner({
    enerfloBase,
    enerfloKey,
    customerEmail,
    customerUuid: customerUuid ?? undefined,
    v3Customer: Object.keys(v3CustomerRaw).length > 0 ? v3CustomerRaw : null,
    v1NumericId: numericId || null,
  });

  const salesRepEmail = ownerResolution.ownerEmail;
  const setterEmail = ownerResolution.setterEmail;
  const step2Ok = Boolean(salesRepEmail || setterEmail);

  await writeApiLog({
    operation: "webhook:enerflo-v2:update-customer:user-resolve",
    vendor:    "enerflo",
    method:    "GET",
    url:       `${enerfloBase}/api/v3/customers`,
    hadApiKey: Boolean(enerfloKey),
    status:    step2Ok ? 200 : null,
    ok:        step2Ok,
    responsePreview: JSON.stringify({
      agentNumericId,
      setterNumericId,
      salesRepEmail,
      setterEmail,
      ownerResolvedFrom: ownerResolution.ownerResolvedFrom,
      ...ownerResolution.debug,
    }).slice(0, 400),
  });

  let ownerId:  string | null = null;
  let closerId: string | null = null;

  if (terrosKey) {
    const ownerEmailToUse = salesRepEmail || "";
    if (ownerEmailToUse) {
      const r = await resolveTerrosUserIdByEmail(terrosBase, terrosKey, ownerEmailToUse);
      ownerId = r.userId;
      await writeApiLog({
        operation: "webhook:enerflo-v2:update-customer:owner-resolve",
        vendor: "terros",
        method: "POST",
        url: `${terrosBase}/user/list`,
        hadApiKey: Boolean(terrosKey),
        status: r.status,
        ok: Boolean(ownerId),
        responsePreview: r.preview.slice(0, 400),
      });
    }
    if (setterEmail && setterEmail !== salesRepEmail) {
      const r = await resolveTerrosUserIdByEmail(terrosBase, terrosKey, setterEmail);
      closerId = r.userId;
    }
  }

  // ── Step 4: upsert Terros account ────────────────────────────────────────

  const residentFields: Record<string, string> = {};
  if (customerName)  residentFields.name  = customerName;
  if (payload.first_name?.trim()) residentFields.firstName = payload.first_name.trim();
  if (payload.last_name?.trim())  residentFields.lastName  = payload.last_name.trim();
  if (customerEmail) residentFields.email = customerEmail;
  const cleanPhone = sanitizePhone(payload.phone ?? "");
  if (cleanPhone)    residentFields.phone = cleanPhone;

  const accountFields: Record<string, unknown> = {
    // externalLeadId = customer UUID — upsert key shared with customer.created
    ...(customerUuid          ? { externalLeadId: customerUuid }        : {}),
    // Fallback: if customer has no UUID (v1 partner-created), use the Terros accountId
    // stored in integration_maps to directly target the right account.
    ...(terrosAccountIdFromMap ? { accountId: terrosAccountIdFromMap }  : {}),
    ...(customerName  ? { name: customerName }                          : {}),
    ...(ownerId       ? { ownerId }                                     : {}),
    ...(closerId      ? { closerId }                                    : {}),
    ...((ownerId || closerId) ? { actorId: ownerId || closerId }       : {}),
    ...(Object.keys(residentFields).length > 0 ? { resident: residentFields } : {}),
  };

  if (addr?.street || addr?.full_address) {
    const location: Record<string, unknown> = {
      ...(addr.street       ? { line1:       addr.street }       : {}),
      ...(addr.full_address ? { oneLine:     addr.full_address }  : {}),
      ...(addr.city         ? { locality:    addr.city }          : {}),
      ...(addr.state        ? { countrySubd: addr.state }         : {}),
      ...(addr.zip          ? { postal1:     addr.zip }           : {}),
    };
    if (addr.latitude && addr.longitude) {
      location.latitude  = parseFloat(addr.latitude);
      location.longitude = parseFloat(addr.longitude);
    }
    accountFields.location = location;
  }

  let step4Ok      = false;
  let step4Status: number | null = null;
  let step4Preview = "";
  let accountId: string | null = null;

  try {
    const r = await fetch(`${terrosBase}/account/upsert`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `ApiKey ${terrosKey}` },
      body: JSON.stringify({ account: accountFields }),
    });
    step4Status  = r.status;
    const raw    = await r.text();
    step4Preview = raw.slice(0, 400);
    step4Ok      = r.ok && terrosJsonBodyIndicatesSuccess(raw);
    if (step4Ok) {
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const acc    = (parsed.account ?? parsed) as Record<string, unknown>;
        accountId    = acc.accountId as string | null ?? null;
      } catch { /* ignore */ }
    }
  } catch (e) {
    step4Preview = e instanceof Error ? e.message : String(e);
  }

  await writeApiLog({
    operation: "webhook:enerflo-v2:update-customer:terros-upsert",
    vendor: "terros",
    method: "POST",
    url: `${terrosBase}/account/upsert`,
    hadApiKey: Boolean(terrosKey),
    status: step4Status,
    ok: step4Ok,
    responsePreview: step4Preview,
  });

  // ── Step 4b: account/update — set ownerId + closerId ─────────────────────
  // account/upsert ignores ownerId/closerId for existing accounts.
  // account/update is required to change the displayed Owner and Closer fields.
  if (accountId && terrosKey && (ownerId || closerId)) {
    const ownerUpdateFields: Record<string, unknown> = {
      accountId,
      id: accountId,
      ...(ownerId  ? { ownerId }  : {}),
      ...(closerId ? { closerId } : {}),
      ...(ownerId || closerId ? { actorId: ownerId || closerId } : {}),
    };
    let step4bOk = false;
    let step4bStatus: number | null = null;
    let step4bPreview = "";
    try {
      const r = await fetch(`${terrosBase}/account/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `ApiKey ${terrosKey}` },
        body: JSON.stringify({ account: ownerUpdateFields }),
      });
      step4bStatus  = r.status;
      const raw     = await r.text();
      step4bPreview = raw.slice(0, 400);
      step4bOk      = r.ok && terrosJsonBodyIndicatesSuccess(raw);
    } catch (e) {
      step4bPreview = e instanceof Error ? e.message : String(e);
    }
    await writeApiLog({
      operation: "webhook:enerflo-v2:update-customer:owner-update",
      vendor: "terros",
      method: "POST",
      url: `${terrosBase}/account/update`,
      hadApiKey: Boolean(terrosKey),
      status: step4bStatus,
      ok: step4bOk,
      responsePreview: step4bPreview,
    });
  }

  // ── Step 5: update workflow stage if Enerflo status changed ──────────────
  // Resolve Enerflo status → Terros stage ID via ENERFLO_STATUS_TO_TERROS_STAGE_MAP

  let step5Ok     = false;
  let step5Status: number | null = null;
  let step5Preview = "";
  let resolvedStageId: string | null = null;

  const enerfloStatus = (payload.status ?? "").toString().trim().toLowerCase();

  await writeApiLog({
    operation: "webhook:enerflo-v2:update-customer:stage-check",
    vendor: "terros",
    method: "GET",
    url: `${terrosBase}/account/update`,
    hadApiKey: Boolean(terrosKey),
    status: null,
    ok: false,
    responsePreview: JSON.stringify({
      enerfloStatus,
      payloadStatus: payload.status ?? null,
      accountId,
      customerUuid,
      mapConfigured: Boolean(env.enerfloStatusToTerrosStageMap),
    }).slice(0, 400),
  });

  if (enerfloStatus && (accountId ?? customerUuid) && terrosKey) {
    // Parse JSON map from env (e.g. {"closed":"S.xxx","appointment_set":"S.yyy"})
    // Only update the Terros stage if there is an explicit entry for this status.
    // If the status is not in the map, leave Terros unchanged.
    const stageMap: Record<string, string> = {};
    if (env.enerfloStatusToTerrosStageMap) {
      try {
        const raw = JSON.parse(env.enerfloStatusToTerrosStageMap) as Record<string, unknown>;
        for (const [k, v] of Object.entries(raw)) {
          if (typeof v === "string") stageMap[k.trim().toLowerCase()] = v;
        }
      } catch { /* malformed JSON — ignore */ }
    }

    resolvedStageId = stageMap[enerfloStatus] ?? null;

    if (resolvedStageId) {
      const updateAccountId = accountId ?? customerUuid;
      try {
        const r = await fetch(`${terrosBase}/account/update`, {
          method:  "POST",
          headers: { "Content-Type": "application/json", Authorization: `ApiKey ${terrosKey}` },
          body:    JSON.stringify({
            account: {
              accountId:       updateAccountId,
              id:              updateAccountId,
              workflowStageId: resolvedStageId,
              ...(ownerId || closerId ? { actorId: ownerId || closerId } : {}),
            },
          }),
        });
        step5Status  = r.status;
        const raw    = await r.text();
        step5Preview = raw.slice(0, 300);
        step5Ok      = r.ok && terrosJsonBodyIndicatesSuccess(raw);
      } catch (e) {
        step5Preview = e instanceof Error ? e.message : String(e);
      }

      await writeApiLog({
        operation: "webhook:enerflo-v2:update-customer:terros-stage-update",
        vendor:    "terros",
        method:    "POST",
        url:       `${terrosBase}/account/update`,
        hadApiKey: Boolean(terrosKey),
        status:    step5Status,
        ok:        step5Ok,
        responsePreview: step5Preview,
      });
    }
  }

  return NextResponse.json({
    received:       true,
    event:          payload.webhook_event,
    numericId,
    customerUuid,
    agentNumericId,
    setterNumericId,
    step1Ok,
    salesRepEmail,
    setterEmail,
    step2Ok,
    ownerId,
    closerId,
    accountId,
    upsert: { ok: step4Ok, status: step4Status, preview: step4Preview },
    stageUpdate: {
      enerfloStatus: enerfloStatus || null,
      resolvedStageId,
      ok: step5Ok,
      status: step5Status,
      preview: step5Preview,
    },
  });
}

/** Enerflo nests kW under pricingOutputs.design, not always on pricingOutputs root */
function readTotalSystemSizeWatts(p: ProjectSubmittedPayload): number {
  const po = p.proposal?.pricingOutputs;
  const candidates = [
    po?.totalSystemSizeWatts,
    po?.design?.totalSystemSizeWatts,
    p.proposal?.design?.totalSystemSizeWatts,
  ];
  for (const n of candidates) {
    if (typeof n === "number" && n > 0) return n;
  }
  return 0;
}
