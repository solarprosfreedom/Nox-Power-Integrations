function opt(name: string, fallback?: string): string | undefined {
  const v = process.env[name];
  return v === "" ? fallback : (v ?? fallback);
}

export const env = {
  enerfloV1ApiKey: opt("ENERFLO_V1_API_KEY"),
  enerfloV1BaseUrl: opt("ENERFLO_V1_BASE_URL", "https://enerflo.io"),
  terrosApiBaseUrl: opt("TERROS_API_BASE_URL", "https://api.terros.com"),
  terrosApiKey: opt("TERROS_API_KEY"),
  terrosWorkflowId: opt("TERROS_WORKFLOW_ID"),
  terrosWorkflowStartStageId: opt("TERROS_WORKFLOW_START_STAGE_ID"),
  /** Terros Account custom field definition IDs (keys in `account.customFields`). From Settings → Custom Fields. */
  terrosCfEnerfloDealId: opt("TERROS_CF_ENERFLO_DEAL_ID"),
  terrosCfEnerfloShortCode: opt("TERROS_CF_ENERFLO_SHORT_CODE"),
  terrosCfProposalId: opt("TERROS_CF_PROPOSAL_ID"),
  terrosCfSystemSizeKw: opt("TERROS_CF_SYSTEM_SIZE_KW"),
  terrosCfFirstYearProductionKwh: opt("TERROS_CF_FIRST_YEAR_PRODUCTION_KWH"),
  terrosCfNetPpw: opt("TERROS_CF_NET_PPW"),
  terrosCfPanelCount: opt("TERROS_CF_PANEL_COUNT"),
  terrosCfFinanceProduct: opt("TERROS_CF_FINANCE_PRODUCT"),
  // Pricing fields
  terrosCfNetCost: opt("TERROS_CF_NET_COST"),
  terrosCfGrossCost: opt("TERROS_CF_GROSS_COST"),
  terrosCfGrossPpw: opt("TERROS_CF_GROSS_PPW"),
  terrosCfDownPayment: opt("TERROS_CF_DOWN_PAYMENT"),
  terrosCfDealerFee: opt("TERROS_CF_DEALER_FEE"),
  terrosCfFederalRebate: opt("TERROS_CF_FEDERAL_REBATE"),
  // Consumption / utility
  terrosCfUtilityCompany: opt("TERROS_CF_UTILITY_COMPANY"),
  terrosCfAnnualConsumption: opt("TERROS_CF_ANNUAL_CONSUMPTION"),
  terrosCfAvgMonthlyBill: opt("TERROS_CF_AVG_MONTHLY_BILL"),
  terrosCfSolarOffset: opt("TERROS_CF_SOLAR_OFFSET"),
  // Equipment
  terrosCfPanelModel: opt("TERROS_CF_PANEL_MODEL"),
  terrosCfPanelWattage: opt("TERROS_CF_PANEL_WATTAGE"),
  terrosCfInverterModel: opt("TERROS_CF_INVERTER_MODEL"),
  terrosCfMountingType: opt("TERROS_CF_MOUNTING_TYPE"),
  terrosCfBatteryCount: opt("TERROS_CF_BATTERY_COUNT"),
  // Deal state
  terrosCfFinancingStatus: opt("TERROS_CF_FINANCING_STATUS"),
  sequifiApiBaseUrl: opt("SEQUIFI_API_BASE_URL"),
  sequifiApiKey: opt("SEQUIFI_API_KEY"),
  supabaseUrl: opt("SUPABASE_URL"),
  supabaseServiceRoleKey: opt("SUPABASE_SERVICE_ROLE_KEY"),
};
