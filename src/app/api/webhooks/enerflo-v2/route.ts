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
import { writeApiLog } from "@/lib/logger";
import { env } from "@/lib/env";

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
    supportedEvents: ["deal.projectSubmitted", "customer.created", "customer.updated.v2"],
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
    (typeof body.event === "string" ? body.event : "");

  // Enerflo v2 payloads are wrapped in a `payload` key
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
  // Webhook only includes UUIDs for salesRep / initiatedBy — not numeric company user id (e.g. 147073).
  // Survey GET by deal id often exposes agent_user_id / creator_user_id for the real rep (e.g. Jonas).
  let repEmail: string | null = null;
  let repResolvedFrom = "";
  let resolveStatus: number | null = null;
  let resolvePreview = "";

  if (repLookupId.includes("@")) {
    repEmail = repLookupId;
    repResolvedFrom = "email-inline";
  } else {
    if (dealId && enerfloKey) {
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
            s.creator_user_id ??
            s.setter_user_id ??
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

    // customerAgentId (from the full customer record) is the most reliable source —
    // it's the Enerflo lead owner, not the API key user. Try it first.
    // salesRepUuid and initiatedBy are secondary fallbacks (initiatedBy is the API
    // key user for API-created leads, so it will often resolve to the wrong rep).
    const uuidCandidates = [customerAgentId, salesRepUuid, initiatedBy].filter(
      (id, i, arr) => id && arr.indexOf(id) === i
    );
    for (const lookupId of uuidCandidates) {
      if (repEmail) break;
      const r = await resolveEnerfloUserEmailByLookupId(enerfloBase, enerfloKey, lookupId);
      resolveStatus = r.lastStatus;
      resolvePreview = r.lastPreview;
      if (r.email) {
        repEmail = r.email;
        repResolvedFrom = `users-list:${lookupId.slice(0, 8)}…`;
        break;
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
  if (repEmail) {
    const u = await resolveTerrosUserIdByEmail(terrosBase, terrosKey, repEmail);
    terrosUserId = u.userId;
    steps.push({
      step: "2 [best-effort] — Resolve Terros userId by rep email",
      ok: u.ok && Boolean(terrosUserId),
      status: u.status,
      data: terrosUserId ? { terrosUserId } : undefined,
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
            body: JSON.stringify({ account: { accountId: upsertedId, id: upsertedId, workflowStageId: fallbackStageId } }),
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

    // ── Step 3c [best-effort]: Set Closed stage + increment Net Deals counter ──
    // deal.projectSubmitted is the definitive "net deal" signal — project is committed to installer.
    if (ok) {
      const upsertedAccount = parsedBody?.account as Record<string, unknown> | undefined;
      const upsertedId = upsertedAccount?.accountId as string | undefined;
      const closedStage = env.terrosWorkflowClosedStageId;
      const installsCfId = env.terrosCfInstalls;

      if (upsertedId && (closedStage || installsCfId)) {
        // Fetch current account to read existing Installs value before incrementing.
        let currentInstalls = 0;
        if (installsCfId) {
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
                const existing = cfs?.[installsCfId];
                if (typeof existing === "number") currentInstalls = existing;
                else if (typeof existing === "string") currentInstalls = parseInt(existing, 10) || 0;
              }
            }
          } catch { /* best-effort — proceed with 0 if fetch fails */ }
        }

        const cleanPhoneForClosed = sanitizePhone(customerPhone);
        // Merge Installs into the full custom fields map so the update doesn't
        // overwrite the deal fields (gross PPW, inverter model, etc.) set by the upsert.
        const mergedCustomFields: Record<string, unknown> = {
          ...terrosCustomFieldsForApi,
          ...(installsCfId ? { [installsCfId]: currentInstalls + 1 } : {}),
        };
        const updateFields: Record<string, unknown> = {
          accountId: upsertedId,
          id: upsertedId,
          ...(closedStage ? { workflowStageId: closedStage } : {}),
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
          operation: "webhook:enerflo-v2:set-closed-stage-and-net-deals",
          vendor: "terros",
          method: "POST",
          url: `${terrosBase}/account/update`,
          hadApiKey: Boolean(terrosKey),
          status: closedStatus,
          ok: closedOk,
          responsePreview: closedError ?? "ok",
        });

        steps.push({
          step: "3c [best-effort] — Set Closed stage + Installs +1",
          ok: closedOk,
          status: closedStatus,
          data: closedOk
            ? { accountId: upsertedId, workflowStageId: closedStage ?? null, installs: currentInstalls + 1 }
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

  // Step 2: Update stage to Knock + Net Deals +1.
  // Block only if already at Appointment or Closed.
  const appointmentStageId = env.terrosWorkflowAppointmentStageId ?? "";
  const closedStageId      = env.terrosWorkflowClosedStageId      ?? "";
  const netDealsCfId       = env.terrosCfNetDeals                 ?? "";
  const blockKnockStages   = [appointmentStageId, closedStageId].filter(Boolean);
  const shouldSetKnock = !currentStage || !blockKnockStages.includes(currentStage);
  let stageOk = false;
  let stageStatus: number | null = null;
  let stagePreview = "";

  if (accountId && shouldSetKnock) {
    // Read current Net Deals before incrementing
    let currentNetDeals = 0;
    if (netDealsCfId) {
      try {
        const getRes = await fetch(`${terrosBase}/account/get`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `ApiKey ${terrosKey}` },
          body: JSON.stringify({ accountId }),
        });
        if (getRes.ok) {
          const getRaw = await getRes.text();
          if (terrosJsonBodyIndicatesSuccess(getRaw)) {
            const getParsed = JSON.parse(getRaw) as Record<string, unknown>;
            const acc = (getParsed.account ?? getParsed) as Record<string, unknown>;
            const cfs = acc.customFields as Record<string, unknown> | undefined;
            const existing = cfs?.[netDealsCfId];
            if (typeof existing === "number") currentNetDeals = existing;
            else if (typeof existing === "string") currentNetDeals = parseInt(existing, 10) || 0;
          }
        }
      } catch { /* best-effort */ }
    }

    const knockUpdateFields: Record<string, unknown> = {
      accountId,
      ...(knockStageId ? { workflowStageId: knockStageId } : {}),
      ...(netDealsCfId ? { customFields: { [netDealsCfId]: currentNetDeals + 1 } } : {}),
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
      responsePreview: stagePreview,
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

  let ownerResolvedFrom = "";
  let ownerEmail: string | null = null;
  let _ownerDebug: Record<string, unknown> = {};

  // GET /api/v3/customers/{uuid} returns 403 for this API key.
  // Instead, use GET /api/v1/customers?search={email} which returns owner.email directly.
  // The customer.created payload always includes customer.email.
  if (customerEmail && enerfloKey) {
    try {
      const searchUrl = `${enerfloBase}/api/v1/customers?search=${encodeURIComponent(customerEmail)}&pageSize=20`;
      const res = await fetch(searchUrl, {
        method: "GET",
        headers: { "api-key": enerfloKey, "Content-Type": "application/json" },
      });
      _ownerDebug.searchStatus = res.status;
      if (res.ok) {
        const raw = JSON.parse(await res.text()) as Record<string, unknown>;
        const rows = raw.data as Record<string, unknown>[] | undefined;
        _ownerDebug.searchCount = raw.dataCount ?? 0;
        if (Array.isArray(rows)) {
          // Find the record whose integration UUID matches our customerId
          let matchedRow = rows.find((r) => {
            const integId = (
              (r.integrations as Record<string, unknown> | undefined)
                ?.["Enerflo V2"] as Record<string, unknown> | undefined
            )?.EnerfloV2Customer as Record<string, unknown> | undefined;
            return integId?.integration_record_id === customerId;
          });
          // Fall back to first result if UUID match not found (e.g. newly created, not yet indexed)
          if (!matchedRow && rows.length === 1) matchedRow = rows[0];
          const ownerObj = matchedRow?.owner as Record<string, unknown> | undefined;
          const foundEmail = ownerObj?.email as string | undefined;
          _ownerDebug.matchedRowId = matchedRow?.id ?? null;
          _ownerDebug.foundOwnerEmail = foundEmail ?? null;
          if (foundEmail && foundEmail.includes("@")) {
            ownerEmail = foundEmail.trim();
            ownerResolvedFrom = "v1-search:owner.email";
          }
        }
      }
    } catch (e) {
      _ownerDebug.searchError = e instanceof Error ? e.message : String(e);
    }
  }

  // Fallback: check payload-level leadOwner fields
  if (!ownerEmail) {
    const payloadRoot = payload as unknown as Record<string, unknown>;
    const leadRefs = extractCustomerCreatedLeadOwnerRefs(c, payloadRoot);
    if (leadRefs.email) {
      ownerEmail = leadRefs.email;
      ownerResolvedFrom = leadRefs.source ?? "leadOwner.email";
    } else if (leadRefs.id && enerfloKey) {
      const r = await resolveEnerfloUserEmailByLookupId(enerfloBase, enerfloKey, leadRefs.id);
      if (r.email) {
        ownerEmail = r.email;
        ownerResolvedFrom = `${leadRefs.source ?? "leadOwner"}.id→Enerflo`;
      }
    }
  }

  let terrosOwnerId: string | null = null;
  if (ownerEmail) {
    const u = await resolveTerrosUserIdByEmail(terrosBase, terrosKey, ownerEmail);
    terrosOwnerId = u.userId;
    _ownerDebug.terrosLookupStatus = u.status;
    _ownerDebug.terrosLookupOk = u.ok;
    _ownerDebug.terrosLookupPreview = u.preview.slice(0, 200);
  }

  const accountFields: Record<string, unknown> = {
    name: customerName,
    // externalLeadId = Enerflo customer UUID — used by upsert to match on resubmit / deal.projectSubmitted
    externalLeadId: customerId,
    externalId: customerId,
    sourceStatus: "New Lead",
    ...(terrosOwnerId ? { ownerId: terrosOwnerId, assignedUserId: terrosOwnerId } : {}),
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

  // Use account/add (not upsert) — account/add reliably sets workflowStageId for new accounts.
  // account/upsert ignores workflowStageId on both create and update, leaving the account stageless
  // and invisible in the Terros UI. customer.created fires once per customer so duplicates are not a concern.
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
  const terrosBase  = (env.terrosApiBaseUrl ?? "https://api.terros.com").replace(/\/$/, "");
  const terrosKey   = env.terrosApiKey ?? "";

  const c          = payload.current;
  const customerId = c.id ?? "";
  const customerName = `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim();
  const customerEmail = c.email?.trim() ?? "";
  const customerPhone = (c.mobile?.trim() || c.phone?.trim()) ?? "";

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

function isWebhookRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Terros `/user/list` → find user ID by email match.
 *  `/user/get` always returns the API key user and ignores the email param. */
async function resolveTerrosUserIdByEmail(
  terrosBase: string,
  terrosKey: string,
  email: string
): Promise<{ userId: string | null; status: number | null; ok: boolean; preview: string }> {
  const needle = email.trim().toLowerCase();
  let status: number | null = null;
  let ok = false;
  let preview = "";
  try {
    const res = await fetch(`${terrosBase}/user/list`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `ApiKey ${terrosKey}` },
      body: JSON.stringify({}),
    });
    status = res.status;
    const rawBody = await res.text();
    preview = rawBody.slice(0, 300);
    ok = res.ok && terrosJsonBodyIndicatesSuccess(rawBody);
    if (!ok) return { userId: null, status, ok, preview };
    const parsed = JSON.parse(rawBody) as Record<string, unknown>;
    const users = parsed.users as Record<string, unknown>[] | undefined;
    if (!Array.isArray(users)) return { userId: null, status, ok, preview };
    const match = users.find((u) =>
      typeof u.email === "string" && u.email.trim().toLowerCase() === needle
    );
    const userId = (match?.userId as string | undefined) ?? null;
    return { userId, status, ok, preview };
  } catch (e) {
    preview = e instanceof Error ? e.message : String(e);
    return { userId: null, status, ok: false, preview };
  }
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
    for (let page = 1; page <= 50; page++) {
      const listUrl = `${enerfloBase}/api/v3/users?page=${page}&pageSize=100`;
      const res = await fetch(listUrl, { method: "GET", headers });
      lastStatus = res.status;
      const rawBody = await res.text();
      lastPreview = rawBody;
      if (!res.ok) break;
      const users = extractUsers(JSON.parse(rawBody) as unknown);
      const match = users.find((u) => repUserRecordMatchesLookup(u, lookupId));
      if (match?.email) return { email: match.email, lastStatus, lastPreview };
      if (users.length < 100) break;
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
