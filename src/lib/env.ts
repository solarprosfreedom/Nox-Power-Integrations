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
  /**
   * JSON map of Enerflo email → Terros email (or vice versa) for reps whose local parts differ.
   * Example: {"leightonmdimando@solarpros.io":"leightondimando@noxpwr.com"}
   */
  userEmailAliasesJson: opt("USER_EMAIL_ALIASES_JSON"),
  /** Coperniq REST API (Settings → Integrations → API key) */
  coperniqApiKey: opt("COPERNIQ_API_KEY"),
  coperniqApiBaseUrl: opt("COPERNIQ_API_BASE_URL", "https://api.coperniq.io"),
  /** Enerflo deal template ID for POST /api/v1/lead-installs (from Enerflo Build Team) */
  enerfloSurveyTypeId: opt("ENERFLO_SURVEY_TYPE_ID"),
  /** Fallback assign_to_email when DEFAULT_OWNER_EMAIL is unset */
  enerfloDefaultAssignEmail: opt("ENERFLO_DEFAULT_ASSIGN_EMAIL"),
  terrosApiBaseUrl: opt("TERROS_API_BASE_URL", "https://api.terros.com"),
  terrosApiKey: opt("TERROS_API_KEY"),
  /** If set, Terros webhooks must send the same value in `X-Terros-Webhook-Secret` or `X-Webhook-Secret`. */
  terrosWebhookSecret: opt("TERROS_WEBHOOK_SECRET"),
  /**
   * JSON array of Terros proxy consumers.
   * Rep filter: { installerId, secret, ownerEmail }
   * Team filter: { installerId, secret, filter: "team", teamName: "Scarface" }
   */
  terrosProxyAccessJson: opt("TERROS_PROXY_ACCESS_JSON"),
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
  sequifiApiBaseUrl: opt("SEQUIFI_API_BASE_URL", "https://marketplace-api.sequifi.com"),
  sequifiApiKey: opt("SEQUIFI_API_KEY"),
  sequifiAccessToken: opt("SEQUIFI_ACCESS_TOKEN"),
  sequifiRefreshToken: opt("SEQUIFI_REFRESH_TOKEN"),
  /** ISO date — only process Sequifi users created on/after this (avoids backfill). */
  onboardingGoLiveAt: opt("ONBOARDING_GO_LIVE_AT"),
  /** When true (default), only provision reps with Sequifi onboarding_complete = 1. */
  onboardingRequireSequifiComplete:
    opt("ONBOARDING_REQUIRE_SEQUIFI_COMPLETE", "true") !== "false",
  /** When true, log actions but do not create accounts or send email. */
  onboardingDryRun: opt("ONBOARDING_DRY_RUN", "true") === "true",
  /** When true, assign Microsoft 365 license after user create (default false for testing). */
  onboardingAssignMsLicense: opt("ONBOARDING_ASSIGN_MS_LICENSE", "false") === "true",
  /** Graph subscribedSkus skuId — e.g. Exchange Online (Plan 1). */
  msLicenseSkuId: opt("MS_LICENSE_SKU_ID"),
  /** ISO 3166-1 alpha-2 country — required before assignLicense (default US). */
  msUsageLocation: opt("MS_USAGE_LOCATION", "US"),
  /** Initial M365 password for new hires (included in welcome email). */
  onboardingDefaultPassword: opt("ONBOARDING_DEFAULT_PASSWORD", "Solar123"),
  /** JSON map: Sequifi role/position substring → { enerfloRoles, terrosRoles, welcomeTemplate } */
  onboardingRoleMapJson: opt("ONBOARDING_ROLE_MAP_JSON"),
  /** UPN domain for new Microsoft users (default noxpwr.com). */
  msDefaultDomain: opt("MS_DEFAULT_DOMAIN", "noxpwr.com"),
  cronSecret: opt("CRON_SECRET"),
  supabaseUrl: opt("SUPABASE_URL"),
  supabaseServiceRoleKey: opt("SUPABASE_SERVICE_ROLE_KEY"),
  /** Microsoft Entra / Graph — welcome email & onboarding */
  azureTenantId: opt("AZURE_TENANT_ID"),
  azureClientId: opt("AZURE_CLIENT_ID"),
  azureClientSecret: opt("AZURE_CLIENT_SECRET"),
  welcomeEmailFrom: opt("WELCOME_EMAIL_FROM"),
  welcomeEmailTestTo: opt("WELCOME_EMAIL_TEST_TO"),
  /** Google Sheets roster sync — spreadsheet ID from the URL */
  googleSheetsSpreadsheetId: opt("GOOGLE_SHEETS_SPREADSHEET_ID"),
  /** Production roster tab (e.g. Axia) */
  googleSheetsTabName: opt("GOOGLE_SHEETS_TAB_NAME", "Axia"),
  /** Isolated tab for sync testing (created automatically if missing) */
  googleSheetsTestTabName: opt("GOOGLE_SHEETS_TEST_TAB_NAME", "Test Sync"),
  googleServiceAccountEmail: opt("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
  /** PEM private key; use \\n for line breaks in .env */
  googleServiceAccountPrivateKey: opt("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY"),
  /** SharePoint Excel roster — site URL (e.g. https://tenant.sharepoint.com/sites/SiteName) */
  sharepointSiteUrl: opt("SHAREPOINT_SITE_URL"),
  /** Path from site drive root, e.g. Shared Documents/Roster - 3rd Party Installers.xlsx */
  sharepointExcelPath: opt("SHAREPOINT_EXCEL_PATH"),
  /** Worksheet tab for sync testing (e.g. LAZARUS) */
  sharepointTestWorksheetName: opt("SHAREPOINT_TEST_WORKSHEET_NAME", "LAZARUS"),
  /** Paragon partner sheet — spreadsheet ID from shared Google Sheet URL */
  paragonSheetsSpreadsheetId: opt("PARAGON_SHEETS_SPREADSHEET_ID"),
  /** Paragon sheet tab name (case-sensitive) */
  paragonSheetsTabName: opt("PARAGON_SHEETS_TAB_NAME"),
  /** When false, cron skips writes (UI manual run still writes). Default false. */
  paragonSyncEnabled: opt("PARAGON_SYNC_ENABLED", "false") === "true",
  /** Axia install backlog sheet — spreadsheet ID from Google Sheet URL */
  installSheetsSpreadsheetId: opt("INSTALL_SHEETS_SPREADSHEET_ID"),
  /** Axia install backlog tab name (case-sensitive) */
  installSheetsTabName: opt("INSTALL_SHEETS_TAB_NAME", "Sheet1"),
  /** When false, cron skips Enerflo creates (dashboard manual run still creates). Default false. */
  installSheetSyncEnabled: opt("INSTALL_SHEET_SYNC_ENABLED", "false") === "true",
  /** Fixed assign_to_email for Axia install sheet imports (overrides sheet Assign_To_Email column). */
  installSheetAssignToEmail: opt("INSTALL_SHEET_ASSIGN_TO_EMAIL", "jonaslim@noxpwr.com"),
  /** EMPWR partner onboarding — HubSpot form submit (NA2 unauthenticated API) */
  hubspotEmpwrPortalId: opt("HUBSPOT_EMPWR_PORTAL_ID", "244696383"),
  hubspotEmpwrFormGuid: opt("HUBSPOT_EMPWR_FORM_GUID", "bf39525c-6a76-4679-acca-459f92f20ded"),
  hubspotEmpwrApiBase: opt("HUBSPOT_EMPWR_API_BASE", "https://api-na2.hsforms.com"),
  hubspotEmpwrCompany: opt("HUBSPOT_EMPWR_COMPANY", "Nox Power"),
  hubspotEmpwrEnabled: opt("HUBSPOT_EMPWR_ENABLED", "true") === "true",
  /**
   * Tron partner onboarding — JotForm "Log-In Request Form" submit.
   * Both prior blockers are resolved:
   *  1. DOB — Sequifi's GET /v1/users now returns a top-level `dob` field
   *     ("YYYY-MM-DD"), confirmed live against real data.
   *  2. CAPTCHA — JotForm's public submit endpoint rejects plain scripted POSTs,
   *     but the integration now drives a real headless browser (puppeteer-core +
   *     @sparticuz/chromium) to fill and submit the form, which produces the same
   *     anti-bot signals (jsExecutionTracker, timeToSubmit, etc.) a genuine
   *     browser session generates. Confirmed live: a manual dry run reached
   *     JotForm's real "Thank You!" page with no CAPTCHA.
   * Still defaults to disabled pending one full end-to-end run against a real
   * onboarded Tron rep (via the cron) to confirm the headless-Chromium path
   * works the same way on Vercel's serverless runtime as it did locally.
   * Flip JOTFORM_TRON_ENABLED=true once that's confirmed.
   */
  jotformTronFormId: opt("JOTFORM_TRON_FORM_ID", "252994617874071"),
  jotformTronEnabled: opt("JOTFORM_TRON_ENABLED", "false") === "true",
};
