import { env } from "@/lib/env";

/** Proposal pricingOutputs shape (webhook payload or survey GET response). */
interface PricingOutputs {
  totalSystemSizeWatts?: number;
  netPPW?: number;
  grossPPW?: number;
  netCost?: number;
  grossCost?: number;
  downPayment?: number;
  dealerFeePercent?: number;
  federalRebateTotal?: number;
  financeProduct?: { name?: string };
  design?: {
    totalSystemSizeWatts?: number;
    firstYearProduction?: number;
    offset?: number;
    mountingType?: string;
    batteryCount?: number;
    arrays?: Array<{ moduleCount?: number; module?: { name?: string; capacity?: number } }>;
    inverters?: Array<{ name?: string }>;
    consumptionProfile?: {
      utility?: { name?: string };
      annualConsumption?: number;
      averageMonthlyBill?: number;
    };
  };
}

export interface ProjectFieldSources {
  dealId?: string;
  dealShortCode?: string;
  financingStatus?: string;
  proposalId?: string;
  financeProductName?: string;
  systemSizeKw?: number | null;
  pricingOutputs?: PricingOutputs;
  survey?: Record<string, unknown>;
  install?: Record<string, unknown>;
}

function putStr(out: Record<string, unknown>, fieldId: string | undefined, value: unknown) {
  if (!fieldId?.trim() || value === undefined || value === null) return;
  const t = String(value).trim();
  if (!t) return;
  out[fieldId.trim()] = t;
}

function putNum(out: Record<string, unknown>, fieldId: string | undefined, value: unknown) {
  if (!fieldId?.trim()) return;
  const n = typeof value === "number" ? value : typeof value === "string" ? parseFloat(value) : NaN;
  if (!Number.isFinite(n) || n === 0) return;
  out[fieldId.trim()] = n;
}

function parsePositiveNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = typeof value === "number" ? value : parseFloat(String(value).replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

interface SurveyDataFields {
  systemSizeKw?: number | null;
  panelCount?: number | null;
  solarOffset?: number | null;
  annualConsumption?: number | null;
  firstYearProduction?: number | null;
  avgMonthlyBill?: number | null;
  totalCost?: number | null;
}

/** Enerflo v1 survey `data` object — often has design values when install root fields are zero. */
function extractSurveyDataFields(survey: Record<string, unknown> | null): SurveyDataFields {
  const nested = survey?.data as Record<string, unknown> | undefined;
  const data =
    nested && typeof nested === "object"
      ? nested
      : survey &&
          (survey.solar_system_size !== undefined ||
            survey.solar_data_panel_count !== undefined ||
            survey.solar_data_system_production !== undefined)
        ? survey
        : undefined;
  if (!data || typeof data !== "object") return {};
  return {
    systemSizeKw: parsePositiveNumber(
      data.solar_system_size ?? data.system_size ?? data.system_size_kw ?? data.kw,
    ),
    panelCount: parsePositiveNumber(
      data.solar_data_panel_count ?? data.panel_count ?? data.module_count,
    ),
    solarOffset: parsePositiveNumber(data.solar_data_solar_offset ?? data.solar_offset),
    annualConsumption: parsePositiveNumber(
      data.solar_data_current_usage ?? data.annual_consumption ?? data.annual_usage,
    ),
    firstYearProduction: parsePositiveNumber(
      data.solar_data_system_production ?? data.first_year_production ?? data.annual_production,
    ),
    avgMonthlyBill: parsePositiveNumber(
      data.solar_proposal_monthly_power_bill ?? data.avg_monthly_bill ?? data.average_monthly_bill,
    ),
    totalCost: parsePositiveNumber(
      data.solar_data_total_cost_after_fees ?? data.total_cost ?? data.system_cost_gross,
    ),
  };
}

function resolveSystemSizeKw(
  install: Record<string, unknown> | null | undefined,
  survey: Record<string, unknown> | null | undefined,
  pricingOutputs?: PricingOutputs,
): number | null {
  const surveyData = extractSurveyDataFields(survey ?? null);
  const panelObj = (
    install?.panel ??
    (install?.equipment as Record<string, unknown> | undefined)?.panel
  ) as Record<string, unknown> | undefined;

  const direct = parsePositiveNumber(
    install?.system_size ?? install?.system_size_kw ?? install?.kw,
  );
  if (direct) return direct;

  if (surveyData.systemSizeKw) return surveyData.systemSizeKw;

  const poWatts =
    pricingOutputs?.totalSystemSizeWatts ??
    pricingOutputs?.design?.totalSystemSizeWatts;
  if (poWatts && poWatts > 0) return poWatts / 1000;

  const watts = parsePositiveNumber(
    survey?.system_size_watts ?? survey?.systemSizeWatts,
  );
  if (watts) return watts / 1000;

  const panelCount = parsePositiveNumber(install?.panel_count) ?? surveyData.panelCount;
  const panelWatts = parsePositiveNumber(panelObj?.watts ?? panelObj?.capacity);
  if (panelCount && panelWatts) return (panelCount * panelWatts) / 1000;

  return null;
}

/** Map Enerflo install/survey data to Terros customFields (same env keys as webhook handler). */
export function buildTerrosProjectCustomFields(sources: ProjectFieldSources): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const po = sources.pricingOutputs;
  const survey = sources.survey;
  const install = sources.install;
  const surveyData = extractSurveyDataFields(survey ?? null);

  putStr(out, env.terrosCfEnerfloDealId, sources.dealId);
  putStr(out, env.terrosCfEnerfloShortCode, sources.dealShortCode);
  putStr(out, env.terrosCfProposalId, sources.proposalId);

  const kw = resolveSystemSizeKw(install, survey ?? null, po) ?? sources.systemSizeKw;
  if (kw != null) putNum(out, env.terrosCfSystemSizeKw, kw);

  const firstYear =
    po?.design?.firstYearProduction ??
    surveyData.firstYearProduction ??
    survey?.firstYearProduction ?? survey?.first_year_production ?? survey?.annual_production;
  putNum(out, env.terrosCfFirstYearProductionKwh, firstYear);

  const netPpw = po?.netPPW ?? install?.ppw_net ?? install?.netPpw ?? install?.net_ppw;
  putNum(out, env.terrosCfNetPpw, netPpw);

  let panelCount: number | undefined;
  const arrays = po?.design?.arrays;
  if (Array.isArray(arrays) && arrays.length > 0) {
    panelCount = arrays.reduce((sum, arr) => sum + (arr.moduleCount ?? 0), 0);
  }
  if (!panelCount) {
    const raw = surveyData.panelCount ??
      install?.panel_count ?? survey?.panelCount ?? survey?.panel_count ?? survey?.moduleCount ??
      survey?.module_count ?? survey?.number_of_panels;
    const n = typeof raw === "number" ? raw : typeof raw === "string" ? parseFloat(raw) : NaN;
    if (Number.isFinite(n) && n > 0) panelCount = n;
  }
  putNum(out, env.terrosCfPanelCount, panelCount);

  const financeProductName =
    sources.financeProductName ??
    po?.financeProduct?.name ??
    survey?.finance_product ?? survey?.financeProductName ?? survey?.loan_product;
  putStr(out, env.terrosCfFinanceProduct, financeProductName);

  putNum(out, env.terrosCfNetCost,
    po?.netCost ?? install?.system_cost_base_adders ?? install?.system_cost_net ?? install?.netCost ?? install?.net_cost);
  putNum(out, env.terrosCfGrossCost,
    po?.grossCost ?? surveyData.totalCost ??
    install?.system_cost_gross ?? install?.grossCost ?? install?.gross_cost);
  putNum(out, env.terrosCfGrossPpw,
    po?.grossPPW ?? install?.ppw_gross ?? install?.ppw_full ?? install?.grossPpw ?? install?.gross_ppw);
  putNum(out, env.terrosCfDownPayment, po?.downPayment ?? install?.down_payment ?? install?.downpayment);
  putNum(out, env.terrosCfDealerFee,
    po?.dealerFeePercent ?? install?.dealer_fee_percent ?? install?.dealer_fees ?? install?.dealerFee ?? install?.dealer_fee);
  putNum(out, env.terrosCfFederalRebate,
    po?.federalRebateTotal ?? install?.federal_rebate_total ?? install?.federalRebate ?? install?.federal_rebate);

  const cp = po?.design?.consumptionProfile;
  putStr(out, env.terrosCfUtilityCompany,
    cp?.utility?.name ??
    install?.utility_company ??
    (install?.utility as Record<string, unknown> | undefined)?.name ??
    (survey?.utility as Record<string, unknown> | undefined)?.name ??
    survey?.utility_company ?? survey?.utilityCompany ?? survey?.utility);
  putNum(out, env.terrosCfAnnualConsumption,
    cp?.annualConsumption ?? surveyData.annualConsumption ??
    survey?.annualConsumption ?? survey?.annual_consumption ?? survey?.annual_usage);
  putNum(out, env.terrosCfAvgMonthlyBill,
    cp?.averageMonthlyBill ?? surveyData.avgMonthlyBill ??
    survey?.avgMonthlyBill ?? survey?.avg_monthly_bill ?? survey?.average_monthly_bill);

  const offsetRaw =
    po?.design?.offset ?? surveyData.solarOffset ??
    survey?.offset ?? survey?.solarOffset ?? survey?.solar_offset ?? survey?.solar_coverage;
  if (typeof offsetRaw === "number" && Number.isFinite(offsetRaw)) {
    const pct = offsetRaw <= 1
      ? Math.round(offsetRaw * 10000) / 100
      : Math.round(offsetRaw * 100) / 100;
    putStr(out, env.terrosCfSolarOffset, String(pct));
  }

  const firstArray = po?.design?.arrays?.[0];
  const panel = install?.panel as Record<string, unknown> | undefined;
  putStr(out, env.terrosCfPanelModel,
    firstArray?.module?.name ?? panel?.name ?? panel?.model ?? install?.panelModel ?? install?.panel_model);
  putNum(out, env.terrosCfPanelWattage,
    firstArray?.module?.capacity ?? panel?.watts ?? panel?.capacity ?? install?.panelWattage ?? install?.panel_wattage);

  const firstInverter = po?.design?.inverters?.[0];
  const inverter = install?.inverter as Record<string, unknown> | undefined;
  putStr(out, env.terrosCfInverterModel,
    firstInverter?.name ?? inverter?.name ?? inverter?.model ?? install?.inverterModel ?? install?.inverter_model);

  putStr(out, env.terrosCfMountingType,
    po?.design?.mountingType ?? survey?.mountingType ?? survey?.mounting_type ?? survey?.mount_type);
  putNum(out, env.terrosCfBatteryCount,
    po?.design?.batteryCount ?? survey?.batteryCount ?? survey?.battery_count ?? survey?.batteries);
  putStr(out, env.terrosCfFinancingStatus,
    sources.financingStatus ??
    (survey?.state as Record<string, unknown> | undefined)?.financingStatus ??
    survey?.financingStatus ?? survey?.financing_status);

  return out;
}

function unwrapRecord(parsed: Record<string, unknown>, keys: string[]): Record<string, unknown> | null {
  for (const k of keys) {
    const v = parsed[k];
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  }
  return parsed && typeof parsed === "object" ? parsed : null;
}

async function enerfloGet(
  base: string,
  key: string,
  url: string,
  unwrapKeys: string[],
): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { "api-key": key, "Content-Type": "application/json" },
    });
    if (!res.ok) return null;
    const parsed = JSON.parse(await res.text()) as Record<string, unknown>;
    const record = unwrapRecord(parsed, unwrapKeys);
    return record && Object.keys(record).length > 0 ? record : null;
  } catch {
    return null;
  }
}

export async function fetchEnerfloCustomerV3(
  base: string,
  key: string,
  customerId: string,
): Promise<Record<string, unknown> | null> {
  return enerfloGet(base, key, `${base}/api/v3/customers/${encodeURIComponent(customerId)}`, ["customer", "data"]);
}

function extractSalesRepEmail(record: Record<string, unknown>): string | null {
  const ownerObj = (record.owner ?? record.agent ?? record.leadOwner) as Record<string, unknown> | undefined;
  const agentUser = record.agent_user as Record<string, unknown> | undefined;
  const setterUser = record.setter_user as Record<string, unknown> | undefined;
  for (const candidate of [ownerObj?.email, agentUser?.email, setterUser?.email]) {
    const email = String(candidate ?? "").trim().toLowerCase();
    if (email) return email;
  }
  return null;
}

export async function fetchSalesRepEmailFromInstall(
  base: string,
  key: string,
  installId: string,
): Promise<string | null> {
  const install = await enerfloGet(
    base,
    key,
    `${base}/api/v3/installs/${encodeURIComponent(installId)}`,
    ["install", "data", "result"],
  );
  if (!install) return null;
  return extractSalesRepEmail(install);
}

function extractPricingOutputsFromSurvey(survey: Record<string, unknown>): PricingOutputs | undefined {
  const proposal = survey.proposal as Record<string, unknown> | undefined;
  const po = proposal?.pricingOutputs ?? survey.pricingOutputs ?? survey.pricing_outputs;
  return po && typeof po === "object" ? (po as PricingOutputs) : undefined;
}

function normalizeInstallRecord(raw: Record<string, unknown>): Record<string, unknown> {
  const cost = raw.cost as Record<string, unknown> | undefined;
  const surveyPricing = raw.survey as Record<string, unknown> | undefined;
  const equipment = raw.equipment as Record<string, unknown> | undefined;
  const utility = raw.utility as Record<string, unknown> | undefined;
  const loan = raw.loan as Record<string, unknown> | undefined;
  const customer = raw.customer as Record<string, unknown> | undefined;
  const deals = customer?.deals as Record<string, unknown>[] | undefined;
  const primaryDeal = Array.isArray(deals) ? deals[0] : undefined;

  const panel = equipment?.panel ?? surveyPricing?.panel ?? raw.panel;
  const inverter = equipment?.inverter ?? surveyPricing?.inverter ?? raw.inverter;

  const utilityCompany =
    typeof utility?.company === "object" && utility?.company !== null
      ? (utility.company as Record<string, unknown>).name
      : utility?.company ?? utility?.name;

  const systemSize = parsePositiveNumber(raw.system_size) ??
    parsePositiveNumber(surveyPricing?.system_size);

  return {
    ...raw,
    deal_id: raw.v2_survey_id ?? raw.survey_id ?? primaryDeal?.EnerfloV2DealId ?? primaryDeal?.EnerfloV1DealId,
    ppw_gross: cost?.ppw_gross ?? surveyPricing?.ppw_gross,
    ppw_net: cost?.ppw_net ?? surveyPricing?.ppw_net,
    system_cost_gross: cost?.system_cost_gross ?? surveyPricing?.system_cost_gross,
    system_cost_base_adders: cost?.system_cost_base_adders ?? surveyPricing?.system_cost_base_adders,
    system_cost_net: cost?.system_cost_net ?? cost?.system_cost_base,
    dealer_fees: cost?.dealer_fees ?? surveyPricing?.dealer_fees,
    dealer_fee_percent: cost?.dealer_fee_percent ?? surveyPricing?.dealer_fees,
    down_payment: cost?.downpayment ?? cost?.downPayment,
    federal_rebate_total: cost?.itc_total ?? cost?.rebates_total,
    panel,
    inverter,
    panel_count: parsePositiveNumber(raw.panel_count) ?? raw.panel_count,
    system_size_kw: systemSize,
    kw: systemSize,
    system_size: systemSize ?? raw.system_size,
    utility_company: utilityCompany,
    finance_product: typeof loan?.lender === "string" ? loan.lender : (loan?.lender as Record<string, unknown> | undefined)?.name,
    proposal_id: raw.v2_survey_id ?? primaryDeal?.EnerfloV2DealId,
    short_code: primaryDeal?.DealName,
  };
}

function projectSourcesFromSurveyAndInstall(
  survey: Record<string, unknown> | null,
  installRaw: Record<string, unknown> | null,
  installId: string,
): ProjectFieldSources {
  const install = installRaw ? normalizeInstallRecord(installRaw) : null;
  const proposal = survey?.proposal as Record<string, unknown> | undefined;
  const deal = (survey?.deal ?? proposal?.deal) as Record<string, unknown> | undefined;
  const po = survey ? extractPricingOutputsFromSurvey(survey) : undefined;

  return {
    dealId: String(
      deal?.id ?? install?.deal_id ?? install?.v2_survey_id ?? install?.survey_id ?? survey?.id ?? installId,
    ),
    dealShortCode: String(
      deal?.shortCode ?? deal?.short_code ?? survey?.shortCode ?? install?.short_code ?? "",
    ),
    financingStatus: String(
      (deal?.state as Record<string, unknown> | undefined)?.financingStatus ?? "",
    ) || undefined,
    proposalId: String(
      proposal?.id ?? install?.proposal_id ?? survey?.proposalId ?? survey?.proposal_id ?? "",
    ),
    financeProductName: String(
      (proposal?.financeProduct as Record<string, unknown> | undefined)?.name ??
      (po?.financeProduct as { name?: string } | undefined)?.name ??
      install?.finance_product ?? "",
    ) || undefined,
    systemSizeKw: resolveSystemSizeKw(install, survey, po),
    pricingOutputs: po,
    survey: survey ?? undefined,
    install: install ?? undefined,
  };
}

/** Fetch install + survey from Enerflo and map to Terros project custom fields. */
export async function fetchInstallProjectCustomFields(
  enerfloBase: string,
  enerfloKey: string,
  installId: string,
  customerId?: string,
): Promise<Record<string, unknown>> {
  let numericId = customerId?.trim() ?? "";
  let customerUuid = "";

  if (numericId && /^[0-9a-f-]{36}$/i.test(numericId)) {
    customerUuid = numericId;
    numericId = "";
  }

  if (numericId || customerUuid) {
    const customer = await fetchEnerfloCustomerV3(
      enerfloBase,
      enerfloKey,
      numericId || customerUuid,
    );
    if (customer) {
      if (!numericId) numericId = String(customer.id ?? "").trim();
      const maps = customer.integration_maps as Record<string, unknown>[] | undefined;
      const fromMaps = Array.isArray(maps)
        ? maps.find(m => typeof m.external_id === "string" && /^[0-9a-f-]{36}$/i.test(m.external_id))
        : undefined;
      customerUuid =
        String(customer.uuid ?? customer.external_id ?? fromMaps?.external_id ?? customerUuid).trim();
    }
  }

  const install = await enerfloGet(
    enerfloBase,
    enerfloKey,
    `${enerfloBase}/api/v3/installs/${encodeURIComponent(installId)}`,
    ["install", "data", "result"],
  );

  let survey: Record<string, unknown> | null = null;
  const numericSurveyId = String(install?.survey_id ?? "").trim();
  if (numericSurveyId && /^\d+$/.test(numericSurveyId)) {
    survey = await enerfloGet(
      enerfloBase,
      enerfloKey,
      `${enerfloBase}/api/v3/surveys/${encodeURIComponent(numericSurveyId)}`,
      ["survey", "result"],
    );
  }

  const dealId = String(
    install?.v2_survey_id ?? install?.survey_id ?? install?.deal_id ?? install?.dealId ?? "",
  ).trim();

  if (!survey && dealId && /^\d+$/.test(dealId)) {
    survey = await enerfloGet(
      enerfloBase,
      enerfloKey,
      `${enerfloBase}/api/v3/surveys/${encodeURIComponent(dealId)}`,
      ["survey", "result"],
    );
  }

  if (!survey && customerUuid) {
    try {
      const res = await fetch(
        `${enerfloBase}/api/v3/surveys?customer_uuid=${encodeURIComponent(customerUuid)}&per_page=50&page=1`,
        { method: "GET", headers: { "api-key": enerfloKey, "Content-Type": "application/json" } },
      );
      if (res.ok) {
        const parsed = JSON.parse(await res.text()) as Record<string, unknown>;
        const list = (parsed.data ?? parsed.surveys ?? parsed.results ?? parsed.items) as unknown[] | undefined;
        if (Array.isArray(list)) {
          const match = numericId
            ? list.find(s => String((s as Record<string, unknown>).customer_id ?? "") === numericId)
            : undefined;
          survey = (match ?? list[list.length - 1]) as Record<string, unknown> | undefined ?? null;
        }
      }
    } catch { /* best-effort */ }
  }

  const sources = projectSourcesFromSurveyAndInstall(survey, install, installId);
  return buildTerrosProjectCustomFields(sources);
}

/** Installs backfill counters — project submitted = Net Deals only; Installs stays 0 until actual install event. */
export function buildInstallCounterFields(installCount: number): Record<string, unknown> {
  const cfs: Record<string, unknown> = {};
  if (env.terrosCfNetDeals) cfs[env.terrosCfNetDeals] = installCount;
  if (env.terrosCfInstalls) cfs[env.terrosCfInstalls] = 0;
  return cfs;
}
