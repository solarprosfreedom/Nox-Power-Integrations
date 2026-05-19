import { env } from "@/lib/env";
import type { E2TRow, T2ERow, InstallsRow } from "@/lib/sync/preview";

// ── Types ──────────────────────────────────────────────────────────────────

export interface ExecuteResultRow {
  id: string;
  status: "created" | "error";
  targetId?: string;
  error?: string;
  installCount?: number;
}

export interface ExecuteResult {
  created: number;
  errors: number;
  results: ExecuteResultRow[];
}

// ── Helpers ────────────────────────────────────────────────────────────────

function terrosSuccess(text: string): boolean {
  try {
    const j = JSON.parse(text) as Record<string, unknown>;
    if (j.type === "error") return false;
  } catch { /* non-JSON */ }
  return true;
}

function splitName(full: string): { firstName: string; lastName: string } {
  const t = (full ?? "").trim();
  if (!t) return { firstName: "Unknown", lastName: "Account" };
  const parts = t.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0]!, lastName: "." };
  return { firstName: parts[0]!, lastName: parts.slice(1).join(" ") };
}

function extractList(parsed: unknown, keys: string[]): Record<string, unknown>[] {
  if (!parsed || typeof parsed !== "object") return [];
  const p = parsed as Record<string, unknown>;
  for (const k of keys) {
    if (Array.isArray(p[k])) return p[k] as Record<string, unknown>[];
  }
  if (Array.isArray(parsed)) return parsed as Record<string, unknown>[];
  return [];
}

// ── Deal-count helper ──────────────────────────────────────────────────────

interface DealCounts { netDeals: number; installs: number; }

async function fetchDealCounts(
  enerfloBase: string,
  enerfloKey: string,
  enerfloId: string,
): Promise<DealCounts> {
  const headers: Record<string, string> = { "api-key": enerfloKey, "Content-Type": "application/json" };
  const tryParse = (t: string) => { try { return JSON.parse(t) as Record<string, unknown>; } catch { return null; } };

  // Both Net Deals and Installs equal the number of submitted projects (installs).
  // A project submission creates an install record — that is the source of truth for both counters.
  let installs = 0;
  try {
    const res = await fetch(
      `${enerfloBase}/api/v3/installs?customer_uuid=${encodeURIComponent(enerfloId)}&pageSize=50&page=1`,
      { method: "GET", headers },
    );
    if (res.ok) {
      const parsed = tryParse(await res.text());
      if (parsed) {
        const rows = extractList(parsed, ["installs", "data", "results", "items"]);
        installs = rows.length;
      }
    }
  } catch { /* fall through */ }

  return { netDeals: installs, installs };
}

// ── E2T ────────────────────────────────────────────────────────────────────

export async function executeE2T(rows: E2TRow[]): Promise<ExecuteResultRow[]> {
  const terrosBase    = (env.terrosApiBaseUrl ?? "https://api.terros.com").replace(/\/$/, "");
  const terrosKey     = env.terrosApiKey      ?? "";
  const enerfloBase   = (env.enerfloV1BaseUrl ?? "https://enerflo.io").replace(/\/$/, "");
  const enerfloKey    = env.enerfloV1ApiKey   ?? "";
  const workflowId    = env.terrosWorkflowId              ?? "";
  const knockStageId  = env.terrosWorkflowKnockStageId    ?? "";
  const closedStageId = env.terrosWorkflowClosedStageId   ?? "";
  const netDealsCfId  = env.terrosCfNetDeals              ?? "";
  const installsCfId  = env.terrosCfInstalls              ?? "";

  // Fetch Terros users once for bulk owner resolution
  let terrosUsers: Record<string, unknown>[] = [];
  try {
    const res = await fetch(`${terrosBase}/user/list`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `ApiKey ${terrosKey}` },
      body: JSON.stringify({}),
    });
    if (res.ok) {
      const text = await res.text();
      if (terrosSuccess(text)) {
        const parsed = JSON.parse(text) as Record<string, unknown>;
        terrosUsers = (parsed.users as Record<string, unknown>[] | undefined) ?? [];
      }
    }
  } catch { /* best-effort */ }

  const results: ExecuteResultRow[] = [];

  for (const row of rows) {
    try {
      // Resolve Terros owner — strip +alias from both sides to handle mismatches
      let terrosOwnerId: string | null = null;
      if (row.salesRepEmail) {
        const needle   = row.salesRepEmail.trim().toLowerCase();
        const stripped = needle.replace(/\+[^@]*(@)/, "$1");
        const candidates = [needle, stripped].filter((e, i, arr) => e && arr.indexOf(e) === i);
        const match = terrosUsers.find(u => {
          if (typeof u.email !== "string") return false;
          const uEmail    = u.email.trim().toLowerCase();
          const uStripped = uEmail.replace(/\+[^@]*(@)/, "$1");
          return candidates.includes(uEmail) || candidates.includes(uStripped);
        });
        terrosOwnerId = (match?.userId as string | undefined) ?? null;
      }

      // Fetch real deal counts from Enerflo to backfill Net Deals + Installs
      const { netDeals, installs } = await fetchDealCounts(enerfloBase, enerfloKey, row.enerfloId);

      const stageId =
        installs > 0 ? (closedStageId || knockStageId) :
        netDeals > 0 ? knockStageId :
        knockStageId; // default to Knock for new accounts

      const customFields: Record<string, unknown> = {
        ...(netDealsCfId && netDeals > 0 ? { [netDealsCfId]: netDeals } : {}),
        ...(installsCfId && installs > 0  ? { [installsCfId]: installs }  : {}),
      };

      const { firstName, lastName } = splitName(row.name);
      const accountFields: Record<string, unknown> = {
        name:           row.name || "Unknown",
        externalLeadId: row.enerfloId,
        externalId:     row.enerfloId,
        sourceStatus:   "New Lead",
        ...(terrosOwnerId ? { ownerId: terrosOwnerId, assignedUserId: terrosOwnerId } : {}),
        ...(workflowId ? { workflowId } : {}),
        ...(stageId    ? { workflowStageId: stageId } : {}),
        ...(Object.keys(customFields).length > 0 ? { customFields } : {}),
        location: {
          line1: row.addressLine1 || "Unknown",
          ...(row.addressFull ? { oneLine:     row.addressFull } : {}),
          ...(row.city        ? { locality:    row.city }        : {}),
          ...(row.stateCode   ? { countrySubd: row.stateCode }   : {}),
          ...(row.zip         ? { postal1:     row.zip }         : {}),
        },
        resident: {
          name:      row.name || "Unknown",
          firstName,
          lastName,
          ...(row.email ? { email: row.email } : {}),
          ...(row.phone ? { phone: row.phone } : {}),
        },
      };

      const res = await fetch(`${terrosBase}/account/add`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `ApiKey ${terrosKey}` },
        body: JSON.stringify({ account: accountFields }),
      });
      const text = await res.text();
      const ok = res.ok && terrosSuccess(text);

      if (ok) {
        let parsed: Record<string, unknown> | undefined;
        try { parsed = JSON.parse(text) as Record<string, unknown>; } catch { /* ignore */ }
        const acc = parsed?.account as Record<string, unknown> | undefined;
        results.push({ id: row.enerfloId, status: "created", targetId: String(acc?.accountId ?? ""), installCount: installs });
      } else {
        results.push({ id: row.enerfloId, status: "error", error: text.slice(0, 300) });
      }
    } catch (e) {
      results.push({ id: row.enerfloId, status: "error", error: e instanceof Error ? e.message : String(e) });
    }
  }

  return results;
}

// ── T2E ────────────────────────────────────────────────────────────────────

export async function executeT2E(rows: T2ERow[]): Promise<ExecuteResultRow[]> {
  const enerfloBase = (env.enerfloV1BaseUrl ?? "https://enerflo.io").replace(/\/$/, "");
  const enerfloKey  = env.enerfloV1ApiKey   ?? "";
  const terrosBase  = (env.terrosApiBaseUrl ?? "https://api.terros.com").replace(/\/$/, "");
  const terrosKey   = env.terrosApiKey      ?? "";

  // Fetch Enerflo users once for bulk owner resolution
  const allEnerfloUsers: Record<string, unknown>[] = [];
  try {
    for (let page = 1; page <= 3; page++) {
      const res = await fetch(`${enerfloBase}/api/v3/users?page=${page}&pageSize=100`, {
        method: "GET",
        headers: { "api-key": enerfloKey, "Content-Type": "application/json" },
      });
      if (!res.ok) break;
      const parsed = JSON.parse(await res.text()) as Record<string, unknown>;
      const batch = (["results", "items", "users", "data"] as const)
        .map(k => parsed[k])
        .find(v => Array.isArray(v)) as Record<string, unknown>[] | undefined;
      if (!batch || batch.length === 0) break;
      allEnerfloUsers.push(...batch);
      if (batch.length < 100) break;
    }
  } catch { /* best-effort */ }

  function findEnerfloOwnerEmail(rawEmail: string): string | undefined {
    const needle   = rawEmail.trim().toLowerCase();
    const stripped = needle.replace(/\+[^@]*(@)/, "$1");
    const candidates = [needle, stripped].filter((e, i, arr) => e && arr.indexOf(e) === i);
    const match = allEnerfloUsers.find(u => {
      if (typeof u.email !== "string") return false;
      const uEmail    = u.email.trim().toLowerCase();
      const uStripped = uEmail.replace(/\+[^@]*(@)/, "$1");
      return candidates.includes(uEmail) || candidates.includes(uStripped);
    });
    if (match?.email) return typeof match.email === "string" ? match.email.trim() : rawEmail;
    return undefined;
  }

  const results: ExecuteResultRow[] = [];

  for (const row of rows) {
    try {
      const assignToEmail = row.ownerEmail ? findEnerfloOwnerEmail(row.ownerEmail) : undefined;
      const { firstName, lastName } = splitName(row.name);

      const lead: Record<string, unknown> = {
        first_name: firstName,
        last_name:  lastName,
        address:    row.addressLine1 || "Unknown",
        city:       row.city         || "Unknown",
        state:      row.stateCode    || "XX",
        zip:        row.zip          || "00000",
        integration_record_id: row.terrosAccountId,
        office_match: "manual",
      };
      if (row.email)     lead.email          = row.email;
      if (row.phone)     lead.mobile         = row.phone;
      if (assignToEmail) lead.assign_to_email = assignToEmail;

      const res = await fetch(`${enerfloBase}/api/v1/partner/action/lead/add`, {
        method: "POST",
        headers: { "api-key": enerfloKey, "Content-Type": "application/json" },
        body: JSON.stringify({ lead }),
      });
      const text = await res.text();

      if (res.ok) {
        let parsed: Record<string, unknown> | undefined;
        try { parsed = JSON.parse(text) as Record<string, unknown>; } catch { /* ignore */ }
        const customerId   = parsed?.customer_id ?? parsed?.customerId;
        const newEnerfloId = customerId != null ? String(customerId) : "";

        // Back-link: store Enerflo customer ID on Terros account
        if (newEnerfloId && terrosKey) {
          try {
            await fetch(`${terrosBase}/account/update`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `ApiKey ${terrosKey}` },
              body: JSON.stringify({
                account: { accountId: row.terrosAccountId, id: row.terrosAccountId, externalLeadId: newEnerfloId },
              }),
            });
          } catch { /* best-effort */ }
        }

        results.push({ id: row.terrosAccountId, status: "created", targetId: newEnerfloId });
      } else {
        results.push({ id: row.terrosAccountId, status: "error", error: text.slice(0, 300) });
      }
    } catch (e) {
        results.push({ id: row.terrosAccountId, status: "error", error: e instanceof Error ? e.message : String(e) });
    }
  }

  return results;
}

// ── Installs Resync ────────────────────────────────────────────────────────

export async function executeInstallsResync(rows: InstallsRow[]): Promise<ExecuteResultRow[]> {
  const terrosBase    = (env.terrosApiBaseUrl ?? "https://api.terros.com").replace(/\/$/, "");
  const terrosKey     = env.terrosApiKey      ?? "";
  const enerfloBase   = (env.enerfloV1BaseUrl ?? "https://enerflo.io").replace(/\/$/, "");
  const enerfloKey    = env.enerfloV1ApiKey   ?? "";
  const workflowId    = env.terrosWorkflowId              ?? "";
  const knockStageId  = env.terrosWorkflowKnockStageId    ?? "";
  const closedStageId = env.terrosWorkflowClosedStageId   ?? "";
  const netDealsCfId  = env.terrosCfNetDeals              ?? "";
  const installsCfId  = env.terrosCfInstalls              ?? "";

  // Fetch Terros users once for owner resolution on creates
  let terrosUsers: Record<string, unknown>[] = [];
  try {
    const res = await fetch(`${terrosBase}/user/list`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `ApiKey ${terrosKey}` },
      body: JSON.stringify({}),
    });
    if (res.ok) {
      const text = await res.text();
      if (terrosSuccess(text)) {
        const parsed = JSON.parse(text) as Record<string, unknown>;
        terrosUsers = (parsed.users as Record<string, unknown>[] | undefined) ?? [];
      }
    }
  } catch { /* best-effort */ }

  function resolveTerrosOwner(email: string): string | null {
    const needle   = email.trim().toLowerCase();
    const stripped = needle.replace(/\+[^@]*(@)/, "$1");
    const candidates = [needle, stripped].filter((e, i, arr) => e && arr.indexOf(e) === i);
    const match = terrosUsers.find(u => {
      if (typeof u.email !== "string") return false;
      const uEmail    = u.email.trim().toLowerCase();
      const uStripped = uEmail.replace(/\+[^@]*(@)/, "$1");
      return candidates.includes(uEmail) || candidates.includes(uStripped);
    });
    return (match?.userId as string | undefined) ?? null;
  }

  /** Fetch the full install/survey from Enerflo and extract project fields using the same paths as the webhook handler. */
  async function fetchInstallCustomFields(installId: string, customerEnerfloId?: string): Promise<Record<string, unknown>> {
    const cfs: Record<string, unknown> = {};
    const add = (cfId: string | undefined, val: unknown) => {
      if (cfId?.trim() && val !== undefined && val !== null && val !== "") cfs[cfId.trim()] = val;
    };
    const addNum = (cfId: string | undefined, val: unknown) => {
      if (!cfId?.trim()) return;
      const n = typeof val === "number" ? val : typeof val === "string" ? parseFloat(val) : NaN;
      if (Number.isFinite(n)) add(cfId, n);
    };

    const enerfloGet = async (url: string): Promise<Record<string, unknown> | null> => {
      try {
        const res = await fetch(url, {
          method: "GET",
          headers: { "api-key": enerfloKey, "Content-Type": "application/json" },
        });
        if (!res.ok) return null;
        const parsed = JSON.parse(await res.text()) as Record<string, unknown>;
        const record = (parsed.install ?? parsed.survey ?? parsed.data ?? parsed) as Record<string, unknown>;
        return record && typeof record === "object" && Object.keys(record).length > 1 ? record : null;
      } catch { return null; }
    };

    // Fetch the survey record for a customer — surveys contain system size, finance product, etc.
    const fetchSurveyForCustomer = async (): Promise<Record<string, unknown> | null> => {
      if (!customerEnerfloId) return null;
      try {
        // Try GET with customer_uuid filter
        const getRes = await fetch(
          `${enerfloBase}/api/v3/surveys?customer_uuid=${encodeURIComponent(customerEnerfloId)}&pageSize=1&page=1`,
          { method: "GET", headers: { "api-key": enerfloKey, "Content-Type": "application/json" } },
        );
        if (getRes.ok) {
          const parsed = JSON.parse(await getRes.text()) as Record<string, unknown>;
          const list = (parsed.surveys ?? parsed.data ?? parsed.results ?? parsed.items) as unknown[] | undefined;
          if (Array.isArray(list) && list.length > 0) {
            const rec = list[list.length - 1] as Record<string, unknown>;
            console.log("[SurveyCF] GET survey keys:", Object.keys(rec).join(", "));
            console.log("[SurveyCF] GET survey record:", JSON.stringify(rec, null, 2).slice(0, 4000));
            return rec;
          }
        }
        // Fall back: POST /api/v3/surveys with customer_uuid body
        const postRes = await fetch(`${enerfloBase}/api/v3/surveys`, {
          method: "POST",
          headers: { "api-key": enerfloKey, "Content-Type": "application/json" },
          body: JSON.stringify({ customer_uuid: customerEnerfloId, pageSize: 50, page: 1 }),
        });
        if (postRes.ok) {
          const parsed = JSON.parse(await postRes.text()) as Record<string, unknown>;
          const list = (parsed.surveys ?? parsed.data ?? parsed.results ?? parsed.items) as unknown[] | undefined;
          if (Array.isArray(list) && list.length > 0) {
            const rec = list[list.length - 1] as Record<string, unknown>;
            console.log("[SurveyCF] POST survey keys:", Object.keys(rec).join(", "));
            console.log("[SurveyCF] POST survey record:", JSON.stringify(rec, null, 2).slice(0, 4000));
            return rec;
          }
        }
      } catch { /* best-effort */ }
      return null;
    };

    try {
      // Fetch the install pricing record (has ppw_gross, ppw_net, system_cost_gross, panel, inverter)
      const install = await enerfloGet(`${enerfloBase}/api/v3/installs/${encodeURIComponent(installId)}`);

      // Debug: log one install record from the customer's install LIST to see what fields are available
      if (customerEnerfloId) {
        try {
          const listRes = await fetch(
            `${enerfloBase}/api/v3/installs?customer_uuid=${encodeURIComponent(customerEnerfloId)}&pageSize=1&page=1`,
            { method: "GET", headers: { "api-key": enerfloKey, "Content-Type": "application/json" } },
          );
          if (listRes.ok) {
            const listParsed = JSON.parse(await listRes.text()) as Record<string, unknown>;
            const listItems = (listParsed.installs ?? listParsed.data ?? listParsed.results ?? listParsed.items) as unknown[] | undefined;
            if (Array.isArray(listItems) && listItems.length > 0) {
              const sample = listItems[0] as Record<string, unknown>;
              console.log("[InstallList] keys:", Object.keys(sample).join(", "));
              console.log("[InstallList] record:", JSON.stringify(sample, null, 2).slice(0, 5000));
            }
          }
        } catch { /* debug only */ }
      }

      // Fetch the survey record for this customer (has kw, finance_product, panel_count, first_year_production, etc.)
      const surveyRecord = await fetchSurveyForCustomer();

      // Use whichever record we got; survey is preferred for fields it has, install fills in pricing
      const primary = surveyRecord ?? install;
      if (!primary) return cfs;

      // ── Fields from the survey record (system-level data) ────────────────────
      if (surveyRecord) {
        const sp = surveyRecord as Record<string, unknown>;
        add(env.terrosCfEnerfloDealId,    String(sp.id ?? sp.deal_id ?? installId));
        add(env.terrosCfEnerfloShortCode, sp.shortCode ?? sp.short_code);
        add(env.terrosCfProposalId,       String(sp.proposalId ?? sp.proposal_id ?? sp.id ?? ""));

        const kw = sp.kw ?? sp.systemSizeKw ?? sp.system_size_kw ?? sp.system_size ?? sp.system_size_kw;
        const watts = sp.system_size_watts ?? sp.systemSizeWatts;
        if (kw) addNum(env.terrosCfSystemSizeKw, kw);
        else if (watts) addNum(env.terrosCfSystemSizeKw, Number(watts) / 1000);

        addNum(env.terrosCfFirstYearProductionKwh, sp.firstYearProduction ?? sp.first_year_production ?? sp.annual_production);
        addNum(env.terrosCfPanelCount,   sp.panelCount  ?? sp.panel_count  ?? sp.moduleCount ?? sp.module_count ?? sp.number_of_panels);
        addNum(env.terrosCfBatteryCount, sp.batteryCount ?? sp.battery_count ?? sp.batteries);

        const fpName = (sp.financeProduct as Record<string,unknown> | undefined)?.name
          ?? sp.finance_product ?? sp.loanProduct ?? sp.loan_product
          ?? sp.financeProductName ?? sp.finance_product_name ?? sp.loan_type;
        add(env.terrosCfFinanceProduct, fpName);

        add(env.terrosCfUtilityCompany,
          (sp.utility as Record<string,unknown> | undefined)?.name ?? sp.utility_company ?? sp.utilityCompany ?? sp.utility);
        addNum(env.terrosCfAnnualConsumption, sp.annualConsumption ?? sp.annual_consumption ?? sp.annual_usage);
        addNum(env.terrosCfAvgMonthlyBill,    sp.avgMonthlyBill ?? sp.avg_monthly_bill ?? sp.average_monthly_bill);

        const offsetRaw = sp.offset ?? sp.solarOffset ?? sp.solar_offset ?? sp.solar_coverage;
        if (typeof offsetRaw === "number" && Number.isFinite(offsetRaw)) {
          add(env.terrosCfSolarOffset, String(Math.round(offsetRaw * 10000) / 100));
        }

        add(env.terrosCfMountingType, sp.mountingType ?? sp.mounting_type ?? sp.mount_type);
        add(env.terrosCfFinancingStatus, sp.financingStatus ?? sp.financing_status
          ?? (sp.state as Record<string,unknown> | undefined)?.financingStatus);
      } else {
        // No survey — use install ID as deal ID fallback
        add(env.terrosCfEnerfloDealId, installId);
      }

      // ── Fields from the install pricing record (ppw_gross, ppw_net, system_cost_*, panel, inverter) ──
      if (install) {
        const ip = install as Record<string, unknown>;
        // Pricing — Enerflo install endpoint uses snake_case flat fields
        addNum(env.terrosCfGrossPpw,  ip.ppw_gross ?? ip.grossPpw  ?? ip.gross_ppw);
        addNum(env.terrosCfNetPpw,    ip.ppw_net   ?? ip.netPpw    ?? ip.net_ppw);
        addNum(env.terrosCfGrossCost, ip.system_cost_gross ?? ip.grossCost ?? ip.gross_cost);
        // Net cost = base + adders (before dealer fee)
        addNum(env.terrosCfNetCost,   ip.system_cost_base_adders ?? ip.netCost ?? ip.net_cost ?? ip.system_cost_net);
        addNum(env.terrosCfDealerFee, ip.dealer_fees ?? ip.dealerFee ?? ip.dealer_fee ?? ip.dealer_fee_percent);
        addNum(env.terrosCfDownPayment,   ip.downPayment ?? ip.down_payment);
        addNum(env.terrosCfFederalRebate, ip.federalRebate ?? ip.federal_rebate ?? ip.federal_rebate_total);

        // Equipment — install endpoint has flat `panel` and `inverter` objects
        const panel    = ip.panel    as Record<string, unknown> | undefined;
        const inverter = ip.inverter as Record<string, unknown> | undefined;
        add(env.terrosCfPanelModel,    panel?.name    ?? panel?.model    ?? ip.panelModel    ?? ip.panel_model);
        addNum(env.terrosCfPanelWattage, panel?.watts ?? panel?.capacity ?? ip.panelWattage  ?? ip.panel_wattage);
        add(env.terrosCfInverterModel, inverter?.name ?? inverter?.model ?? ip.inverterModel ?? ip.inverter_model);
      }
    } catch { /* best-effort */ }

    return cfs;
  }

  function buildBaseCounterFields(installCount: number): Record<string, unknown> {
    const cfs: Record<string, unknown> = {};
    if (netDealsCfId) cfs[netDealsCfId] = installCount;
    if (installsCfId) cfs[installsCfId] = installCount;
    return cfs;
  }

  const results: ExecuteResultRow[] = [];
  const stageId = closedStageId || knockStageId;

  for (const row of rows) {
    try {
      // Fetch full project details from the first install ID, then merge counters on top
      const projectCfs = row.installIds.length > 0
        ? await fetchInstallCustomFields(row.installIds[0]!, row.enerfloId)
        : {};
      const customFields = { ...projectCfs, ...buildBaseCounterFields(row.installCount) };

      if (row.action === "update" && row.terrosAccountId) {
        // ── Update existing Terros account ────────────────────────────────────
        // Read existing CFs first so we don't wipe unrelated fields
        let mergedCfs = { ...customFields };
        try {
          const getRes = await fetch(`${terrosBase}/account/get`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `ApiKey ${terrosKey}` },
            body: JSON.stringify({ accountId: row.terrosAccountId }),
          });
          if (getRes.ok) {
            const getRaw = await getRes.text();
            if (terrosSuccess(getRaw)) {
              const getParsed = JSON.parse(getRaw) as Record<string, unknown>;
              const acc = (getParsed.account ?? getParsed) as Record<string, unknown>;
              const existingCfs = acc.customFields as Record<string, unknown> | undefined;
              if (existingCfs && typeof existingCfs === "object") {
                mergedCfs = { ...existingCfs, ...customFields };
              }
            }
          }
        } catch { /* proceed with customFields only */ }

        const phone = row.phone ? row.phone.replace(/\D/g, "").slice(-10) : "";
        const { firstName: fn, lastName: ln } = splitName(row.name);
        const terrosOwnerIdForUpdate = row.salesRepEmail ? resolveTerrosOwner(row.salesRepEmail) : null;
        const updateBody: Record<string, unknown> = {
          accountId: row.terrosAccountId,
          id: row.terrosAccountId,
          ...(stageId ? { workflowStageId: stageId } : {}),
          ...(terrosOwnerIdForUpdate ? { ownerId: terrosOwnerIdForUpdate, assignedUserId: terrosOwnerIdForUpdate } : {}),
          ...(Object.keys(mergedCfs).length > 0 ? { customFields: mergedCfs } : {}),
          resident: {
            name: row.name || `${fn} ${ln}`.trim(),
            firstName: fn,
            lastName: ln,
            ...(row.email ? { email: row.email } : {}),
            ...(phone ? { phone } : {}),
          },
        };

        const res = await fetch(`${terrosBase}/account/update`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `ApiKey ${terrosKey}` },
          body: JSON.stringify({ account: updateBody }),
        });
        const text = await res.text();
        const ok = res.ok && terrosSuccess(text);

        if (ok) {
          results.push({ id: row.enerfloId, status: "created", targetId: row.terrosAccountId, installCount: row.installCount });
        } else {
          results.push({ id: row.enerfloId, status: "error", error: text.slice(0, 300) });
        }
      } else {
        // ── Create new Terros account ─────────────────────────────────────────
        const terrosOwnerId = row.salesRepEmail ? resolveTerrosOwner(row.salesRepEmail) : null;
        const { firstName, lastName } = splitName(row.name);

        const accountFields: Record<string, unknown> = {
          name:           row.name || "Unknown",
          externalLeadId: row.enerfloId,
          externalId:     row.enerfloId,
          sourceStatus:   "Project Submitted",
          ...(terrosOwnerId ? { ownerId: terrosOwnerId, assignedUserId: terrosOwnerId } : {}),
          ...(workflowId ? { workflowId } : {}),
          ...(stageId    ? { workflowStageId: stageId } : {}),
          ...(Object.keys(customFields).length > 0 ? { customFields } : {}),
          location: {
            line1: row.addressLine1 || "Unknown",
            ...(row.city      ? { locality:    row.city }      : {}),
            ...(row.stateCode ? { countrySubd: row.stateCode } : {}),
            ...(row.zip       ? { postal1:     row.zip }       : {}),
          },
          resident: {
            name: row.name || "Unknown",
            firstName,
            lastName,
            ...(row.email ? { email: row.email } : {}),
            ...(row.phone ? { phone: row.phone } : {}),
          },
        };

        // Use account/upsert — handles both new accounts and existing ones (matched by externalLeadId or email).
        // Then force Closed stage + CFs via account/update since upsert ignores workflowStageId on updates.
        const upsertRes = await fetch(`${terrosBase}/account/upsert`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `ApiKey ${terrosKey}` },
          body: JSON.stringify({ account: accountFields }),
        });
        const upsertText = await upsertRes.text();
        const upsertOk = upsertRes.ok && terrosSuccess(upsertText);

        if (upsertOk) {
          let parsed: Record<string, unknown> | undefined;
          try { parsed = JSON.parse(upsertText) as Record<string, unknown>; } catch { /* ignore */ }
          const acc = parsed?.account as Record<string, unknown> | undefined;
          const newAccountId = String(acc?.accountId ?? "");

          // Force Closed stage + CFs via a separate account/update.
          // Upsert ignores workflowStageId on existing accounts.
          if (newAccountId && stageId) {
            // Step 1: read existing CFs (best-effort — don't let failure block the stage update)
            let mergedCfs = { ...customFields };
            try {
              const getRes = await fetch(`${terrosBase}/account/get`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `ApiKey ${terrosKey}` },
                body: JSON.stringify({ accountId: newAccountId }),
              });
              if (getRes.ok) {
                const getRaw = await getRes.text();
                if (terrosSuccess(getRaw)) {
                  const existing = ((JSON.parse(getRaw) as Record<string,unknown>).account as Record<string,unknown> | undefined)
                    ?.customFields as Record<string,unknown> | undefined;
                  if (existing) mergedCfs = { ...existing, ...customFields };
                }
              }
            } catch { /* proceed with customFields only */ }

            // Step 2: force stage + owner + CFs — this must run regardless of step 1
            const phone = row.phone ? row.phone.replace(/\D/g, "").slice(-10) : "";
            const { firstName, lastName } = splitName(row.name);
            const updateRes = await fetch(`${terrosBase}/account/update`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `ApiKey ${terrosKey}` },
              body: JSON.stringify({
                account: {
                  accountId: newAccountId, id: newAccountId,
                  workflowStageId: stageId,
                  ...(terrosOwnerId ? { ownerId: terrosOwnerId, assignedUserId: terrosOwnerId } : {}),
                  ...(Object.keys(mergedCfs).length > 0 ? { customFields: mergedCfs } : {}),
                  resident: {
                    name: row.name || `${firstName} ${lastName}`.trim(),
                    firstName,
                    lastName,
                    ...(row.email ? { email: row.email } : {}),
                    ...(phone ? { phone } : {}),
                  },
                },
              }),
            });
            const updateText = await updateRes.text();
            if (!updateRes.ok || !terrosSuccess(updateText)) {
              // Stage update failed — report it so the user can see the real error
              results.push({ id: row.enerfloId, status: "error", targetId: newAccountId, error: `upsert OK but stage update failed: ${updateText.slice(0, 250)}` });
              continue;
            }
          }

          // Back-link Enerflo customer → Terros account ID (numeric Enerflo IDs only)
          if (newAccountId && enerfloKey && !row.enerfloId.includes("-")) {
            try {
              await fetch(`${enerfloBase}/api/v3/customers/${row.enerfloId}`, {
                method: "PUT",
                headers: { "api-key": enerfloKey, "Content-Type": "application/json" },
                body: JSON.stringify({ integration_record_id: newAccountId }),
              });
            } catch { /* best-effort */ }
          }

          results.push({ id: row.enerfloId, status: "created", targetId: newAccountId, installCount: row.installCount });
        } else {
          results.push({ id: row.enerfloId, status: "error", error: upsertText.slice(0, 300) });
        }
      }
    } catch (e) {
      results.push({ id: row.enerfloId, status: "error", error: e instanceof Error ? e.message : String(e) });
    }
  }

  return results;
}
