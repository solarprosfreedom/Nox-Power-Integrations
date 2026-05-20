function opt(name: string, fallback?: string): string | undefined {
  const v = process.env[name];
  return v === "" ? fallback : (v ?? fallback);
}

export const env = {
  enerfloV1ApiKey: opt("ENERFLO_V1_API_KEY"),
  enerfloV1BaseUrl: opt("ENERFLO_V1_BASE_URL", "https://enerflo.io"),
  /** Optional: scope /api/v3/users to a specific company so super-company API keys don't return sub-company users */
  enerfloCompanyId: opt("ENERFLO_COMPANY_ID"),
  /** Enerflo GraphQL v2 — generate from Settings → Users → Integrations → +Generate */
  enerfloGraphqlApiKey: opt("ENERFLO_GRAPHQL_API_KEY"),
  enerfloGraphqlBaseUrl: opt("ENERFLO_GRAPHQL_BASE_URL", "https://api.enerflo.io/graphql"),
  /** x-org header required by Enerflo GraphQL (your org slug, e.g. "solar-pros") */
  enerfloOrgSlug: opt("ENERFLO_ORG_SLUG"),
  /** Default owner email used when no lead owner can be resolved (e.g. "xlead@noxpwr.com") */
  defaultOwnerEmail: opt("DEFAULT_OWNER_EMAIL"),
  terrosApiBaseUrl: opt("TERROS_API_BASE_URL", "https://api.terros.com"),
  terrosApiKey: opt("TERROS_API_KEY"),
  /** If set, Terros webhooks must send the same value in `X-Terros-Webhook-Secret` or `X-Webhook-Secret`. */
  terrosWebhookSecret: opt("TERROS_WEBHOOK_SECRET"),
  terrosWorkflowId: opt("TERROS_WORKFLOW_ID"),
  terrosWorkflowStartStageId: opt("TERROS_WORKFLOW_START_STAGE_ID"),
  /** Stage to set when deal.projectSubmitted fires (net deal / closed). */
  terrosWorkflowClosedStageId: opt("TERROS_WORKFLOW_CLOSED_STAGE_ID"),
  /** Stage to set when an appointment is created. */
  terrosWorkflowAppointmentStageId: opt("TERROS_WORKFLOW_APPOINTMENT_STAGE_ID"),
  /** Workflow action ID for "Appointment" — links calendar events to the account's Appointments section. */
  terrosWorkflowAppointmentActionId: opt("TERROS_WORKFLOW_APPOINTMENT_ACTION_ID"),
  /** Stage to set when deal.created fires (rep opened a deal on the lead). */
  terrosWorkflowKnockStageId: opt("TERROS_WORKFLOW_KNOCK_STAGE_ID"),
  /**
   * JSON map of Enerflo status strings → Terros workflow stage IDs.
   * Example: {"closed":"S.xxx","appointment_set":"S.yyy","no_answer":"S.zzz"}
   * Keys are lowercased Enerflo status values; values are Terros stage IDs.
   */
  enerfloStatusToTerrosStageMap: opt("ENERFLO_STATUS_TO_TERROS_STAGE_MAP"),
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
  // Counter fields (incremented by events)
  terrosCfNetDeals: opt("TERROS_CF_NET_DEALS"),
  terrosCfInstalls: opt("TERROS_CF_INSTALLS"),
  terrosCfAppointments: opt("TERROS_CF_APPOINTMENTS"),
  sequifiApiBaseUrl: opt("SEQUIFI_API_BASE_URL"),
  sequifiApiKey: opt("SEQUIFI_API_KEY"),
  supabaseUrl: opt("SUPABASE_URL"),
  supabaseServiceRoleKey: opt("SUPABASE_SERVICE_ROLE_KEY"),
};
