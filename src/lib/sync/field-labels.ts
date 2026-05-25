import { env } from "@/lib/env";

export type ProjectFieldPreviewItem = {
  key: string;
  label: string;
  terrosFieldId: string | null;
  envVar: string;
  configured: boolean;
  value: string | number | null;
  hasValue: boolean;
};

type FieldDef = {
  key: string;
  label: string;
  envKey: keyof typeof env;
  envVar: string;
};

const FIELD_DEFS: FieldDef[] = [
  { key: "enerfloDealId", label: "Enerflo Deal ID", envKey: "terrosCfEnerfloDealId", envVar: "TERROS_CF_ENERFLO_DEAL_ID" },
  { key: "enerfloShortCode", label: "Enerflo Short Code", envKey: "terrosCfEnerfloShortCode", envVar: "TERROS_CF_ENERFLO_SHORT_CODE" },
  { key: "proposalId", label: "Proposal ID", envKey: "terrosCfProposalId", envVar: "TERROS_CF_PROPOSAL_ID" },
  { key: "systemSizeKw", label: "System Size (kW)", envKey: "terrosCfSystemSizeKw", envVar: "TERROS_CF_SYSTEM_SIZE_KW" },
  { key: "firstYearProductionKwh", label: "First Year Production (kWh)", envKey: "terrosCfFirstYearProductionKwh", envVar: "TERROS_CF_FIRST_YEAR_PRODUCTION_KWH" },
  { key: "netPpw", label: "Net PPW", envKey: "terrosCfNetPpw", envVar: "TERROS_CF_NET_PPW" },
  { key: "panelCount", label: "Panel Count", envKey: "terrosCfPanelCount", envVar: "TERROS_CF_PANEL_COUNT" },
  { key: "financeProduct", label: "Finance Product", envKey: "terrosCfFinanceProduct", envVar: "TERROS_CF_FINANCE_PRODUCT" },
  { key: "netCost", label: "Net Cost", envKey: "terrosCfNetCost", envVar: "TERROS_CF_NET_COST" },
  { key: "grossCost", label: "Gross Cost", envKey: "terrosCfGrossCost", envVar: "TERROS_CF_GROSS_COST" },
  { key: "grossPpw", label: "Gross PPW", envKey: "terrosCfGrossPpw", envVar: "TERROS_CF_GROSS_PPW" },
  { key: "downPayment", label: "Down Payment", envKey: "terrosCfDownPayment", envVar: "TERROS_CF_DOWN_PAYMENT" },
  { key: "dealerFee", label: "Dealer Fee", envKey: "terrosCfDealerFee", envVar: "TERROS_CF_DEALER_FEE" },
  { key: "federalRebate", label: "Federal Rebate", envKey: "terrosCfFederalRebate", envVar: "TERROS_CF_FEDERAL_REBATE" },
  { key: "utilityCompany", label: "Utility Company", envKey: "terrosCfUtilityCompany", envVar: "TERROS_CF_UTILITY_COMPANY" },
  { key: "annualConsumption", label: "Annual Consumption", envKey: "terrosCfAnnualConsumption", envVar: "TERROS_CF_ANNUAL_CONSUMPTION" },
  { key: "avgMonthlyBill", label: "Avg Monthly Bill", envKey: "terrosCfAvgMonthlyBill", envVar: "TERROS_CF_AVG_MONTHLY_BILL" },
  { key: "solarOffset", label: "Solar Offset (%)", envKey: "terrosCfSolarOffset", envVar: "TERROS_CF_SOLAR_OFFSET" },
  { key: "panelModel", label: "Panel Model", envKey: "terrosCfPanelModel", envVar: "TERROS_CF_PANEL_MODEL" },
  { key: "panelWattage", label: "Panel Wattage", envKey: "terrosCfPanelWattage", envVar: "TERROS_CF_PANEL_WATTAGE" },
  { key: "inverterModel", label: "Inverter Model", envKey: "terrosCfInverterModel", envVar: "TERROS_CF_INVERTER_MODEL" },
  { key: "mountingType", label: "Mounting Type", envKey: "terrosCfMountingType", envVar: "TERROS_CF_MOUNTING_TYPE" },
  { key: "batteryCount", label: "Battery Count", envKey: "terrosCfBatteryCount", envVar: "TERROS_CF_BATTERY_COUNT" },
  { key: "financingStatus", label: "Financing Status", envKey: "terrosCfFinancingStatus", envVar: "TERROS_CF_FINANCING_STATUS" },
  { key: "netDeals", label: "Net Deals (counter)", envKey: "terrosCfNetDeals", envVar: "TERROS_CF_NET_DEALS" },
  { key: "installs", label: "Installs (counter)", envKey: "terrosCfInstalls", envVar: "TERROS_CF_INSTALLS" },
];

function formatValue(value: unknown): string | number | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const t = value.trim();
    return t || null;
  }
  return String(value);
}

export function formatProjectFieldsForPreview(
  customFields: Record<string, unknown>,
): ProjectFieldPreviewItem[] {
  return FIELD_DEFS.map((def) => {
    const terrosFieldId = (env[def.envKey] as string | undefined)?.trim() || null;
    const configured = Boolean(terrosFieldId);
    const raw = configured && terrosFieldId ? customFields[terrosFieldId] : undefined;
    const value = formatValue(raw);
    return {
      key: def.key,
      label: def.label,
      terrosFieldId,
      envVar: def.envVar,
      configured,
      value,
      hasValue: value !== null,
    };
  });
}

/** Env var names (TERROS_CF_*) that are not set on the server. */
export function getUnconfiguredTerrosFieldEnvVars(): string[] {
  return FIELD_DEFS.filter((def) => !env[def.envKey]).map((def) => def.envVar);
}

export function extractFieldSummary(
  fieldPreview: ProjectFieldPreviewItem[],
): { systemSizeKw?: number | null; netPpw?: number | null; financeProduct?: string | null } {
  const pick = (key: string) => fieldPreview.find((f) => f.key === key)?.value ?? null;
  const num = (key: string) => {
    const v = pick(key);
    return typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : null;
  };
  const str = (key: string) => {
    const v = pick(key);
    return v != null ? String(v) : null;
  };
  return {
    systemSizeKw: num("systemSizeKw"),
    netPpw: num("netPpw"),
    financeProduct: str("financeProduct"),
  };
}
