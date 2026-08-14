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
  /** Public Lovable/Hub deal feeds used by the inactive-rep sales safeguard. */
  publicDealsApiBase: opt("PUBLIC_DEALS_API_BASE", "https://hub.noxpwr.com/api/public/deals"),
  publicDealsApiKey: opt("PUBLIC_DEALS_API_KEY"),
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
  /**
   * Sequifi office_name → Terros team aliases when Sequifi only stores the region/org
   * (e.g. `Envision:Scarface`). Comma-separated `From:To` pairs; merges with built-ins.
   */
  terrosOfficeTeamAliases: opt("TERROS_OFFICE_TEAM_ALIASES"),
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
  /**
   * Fallback DOB (YYYY-MM-DD) when Sequifi `dob` is null — used by partner forms
   * that require date of birth. Override with ONBOARDING_DEFAULT_DOB.
   */
  onboardingDefaultDob: opt("ONBOARDING_DEFAULT_DOB", "1990-01-01"),
  /**
   * Fallback US phone when Sequifi mobile is missing/invalid (NANP area/exchange
   * cannot start with 0/1). Used by partner forms with masked phone inputs.
   */
  onboardingDefaultPhone: opt("ONBOARDING_DEFAULT_PHONE", "4805550199"),
  /** BPS Primary Selling State when Sequifi markets don't overlap the form picklist. */
  bpsDefaultPrimaryState: opt("BPS_DEFAULT_PRIMARY_STATE", "UT"),
  /** JSON map: Sequifi role/position substring → { enerfloRoles, terrosRoles, welcomeTemplate } */
  onboardingRoleMapJson: opt("ONBOARDING_ROLE_MAP_JSON"),
  /** UPN domain for new Microsoft users (default noxpwr.com). */
  msDefaultDomain: opt("MS_DEFAULT_DOMAIN", "noxpwr.com"),
  cronSecret: opt("CRON_SECRET"),
  supabaseUrl: opt("SUPABASE_URL"),
  supabaseServiceRoleKey: opt("SUPABASE_SERVICE_ROLE_KEY"),
  /** Daily inactive-rep report recipient. */
  inactiveRepEmailTo: opt("INACTIVE_REP_EMAIL_TO", "noxpwr@gmail.com"),
  /** Additional recipients for every inactive-rep report. */
  inactiveRepEmailAdditionalRecipients: opt(
    "INACTIVE_REP_EMAIL_ADDITIONAL_RECIPIENTS",
    "admin@noxpwr.com",
  ),
  /** Fail-safe rollout switch: reports continue, but due accounts are untouched unless explicitly true. */
  inactiveRepDeactivationEnabled:
    opt("INACTIVE_REP_DEACTIVATION_ENABLED", "false") === "true",
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
  /** EMPWR partner onboarding — HubSpot form submit (NA2 unauthenticated API). */
  hubspotEmpwrPortalId: opt("HUBSPOT_EMPWR_PORTAL_ID", "244696383"),
  hubspotEmpwrFormGuid: opt("HUBSPOT_EMPWR_FORM_GUID", "bf39525c-6a76-4679-acca-459f92f20ded"),
  hubspotEmpwrApiBase: opt("HUBSPOT_EMPWR_API_BASE", "https://api-na2.hsforms.com"),
  hubspotEmpwrCompany: opt("HUBSPOT_EMPWR_COMPANY", "Nox Power"),
  /** Always on — Empwr HubSpot form submit uses public form IDs (no API key). */
  hubspotEmpwrEnabled: true,
  /**
   * Optional remote Chromium pack for Vercel when `@sparticuz/chromium/bin` is
   * missing from the serverless bundle. Defaults to the v149 x64 pack in code.
   */
  chromiumRemoteExecPath: opt("CHROMIUM_REMOTE_EXEC_PATH"),
  /**
   * Empower partner onboarding — "Empower New Rep Request" Typeform
   * (https://form.typeform.com/to/UvpPrheO). Triggered by Other Installers /
   * Empower tab (not Empwr HubSpot). Closers only (setters skip). Submitted via
   * headless Chromium. On by default for live testing.
   */
  empowerTypeformUrl: opt("EMPOWER_TYPEFORM_URL", "https://form.typeform.com/to/UvpPrheO"),
  empowerTypeformEnabled: opt("EMPOWER_TYPEFORM_ENABLED", "true") === "true",
  empowerTypeformTeamId: opt("EMPOWER_TYPEFORM_TEAM_ID", "803"),
  empowerTypeformEmailDomain: opt("EMPOWER_TYPEFORM_EMAIL_DOMAIN", "solarpros.io"),
  /**
   * Empower partner onboarding — Jobflo crash-course SMS (SOP step 6).
   * Uses Twilio. On by default; fails cleanly if Twilio vars are missing.
   */
  empowerJobfloVideoUrl: opt(
    "EMPOWER_JOBFLO_VIDEO_URL",
    "https://www.loom.com/share/8e99f6aa14ae47e8ac30f32ff42801ba",
  ),
  empowerSmsEnabled: opt("EMPOWER_SMS_ENABLED", "true") === "true",
  /**
   * Tron partner onboarding — JotForm "Log-In Request Form" submit.
   * Headless Chromium (CAPTCHA). On by default for live testing. Needs Sequifi DOB.
   */
  jotformTronFormId: opt("JOTFORM_TRON_FORM_ID", "252994617874071"),
  jotformTronEnabled: opt("JOTFORM_TRON_ENABLED", "true") === "true",
  /**
   * GoodPWR partner onboarding — "New Sales Rep Onboarding" JotForm
   * (https://form.jotform.com/261804783661160). SOP defaults: Sungage / LightReach.
   * Headless Chromium. On by default for live testing. Recheck # left blank.
   */
  jotformGoodPwrFormId: opt("JOTFORM_GOODPWR_FORM_ID", "261804783661160"),
  goodPwrFormEnabled: opt("GOODPWR_FORM_ENABLED", "true") === "true",
  /** "GoodPWR Links" link-tree URL, sent in the post-onboarding text to the rep. */
  goodPwrLinksUrl: opt("GOODPWR_LINKS_URL", "https://sites.google.com/goodpwr.com/goodpwr/sales-partners"),
  /**
   * GoodPWR partner onboarding — text message to the rep (Step 4 of the SOP).
   * Uses Twilio. On by default; fails cleanly if Twilio vars are missing.
   */
  goodPwrSmsEnabled: opt("GOODPWR_SMS_ENABLED", "true") === "true",
  twilioAccountSid: opt("TWILIO_ACCOUNT_SID"),
  twilioAuthToken: opt("TWILIO_AUTH_TOKEN"),
  /** E.164, e.g. +18005551234 */
  twilioFromNumber: opt("TWILIO_FROM_NUMBER"),
  /**
   * Better Earth partner onboarding — "Sales Rep Onboarding" Fillout form.
   * Direct REST (no browser). On by default for live testing.
   */
  betterEarthFormFlowId: opt("BETTER_EARTH_FORM_FLOW_ID", "961SCS6869us"),
  betterEarthFormEnabled: opt("BETTER_EARTH_FORM_ENABLED", "true") === "true",
  /** "Sales Company" field on the Better Earth form — no explicit value given
   * in the SOP; defaults to the same "NOX Power" branding used for Tron/EMPWR. */
  betterEarthSalesCompany: opt("BETTER_EARTH_SALES_COMPANY", "NOX Power"),
  /**
   * Bright Planet Solar (BPS) — Financier Portal Login Request (Smartsheet).
   * Triggered when Sequifi Other Installers? contains "BPS" or "Bright Planet
   * Solar". On by default for live testing.
   */
  bpsFormPublishKey: opt("BPS_FORM_PUBLISH_KEY", "60e97ea684894846927bfc564a5a2d9e"),
  bpsFormEnabled: opt("BPS_FORM_ENABLED", "true") === "true",
  bpsSalesOrganization: opt("BPS_SALES_ORGANIZATION", "NOX Power"),
  /**
   * Green Brilliance — shared roster Google Sheet for Bob/Amir (Blaze intake).
   * Triggered when Sequifi Other Installers? contains "Green Brilliance" (or
   * whole-word "GB"). Sungage Access is left blank. On by default for live testing.
   */
  greenBrillianceSpreadsheetId: opt(
    "GREEN_BRILLIANCE_SPREADSHEET_ID",
    "1MvCndbCtMLYf9Rr12T6DJ9Xj1wvASlz39Zc1bdRQ_X4",
  ),
  greenBrillianceRosterEnabled: opt("GREEN_BRILLIANCE_ROSTER_ENABLED", "true") === "true",
  /**
   * Icon Power — Sales Rep Onboarding Smartsheet form (Freedom Pros).
   * Triggered when Sequifi Other Installers? contains "Icon Power" or
   * whole-word "Icon". On by default for live testing.
   */
  iconPowerFormPublishKey: opt("ICON_POWER_FORM_PUBLISH_KEY", "019adb83223c7b2180542e382343d5f1"),
  iconPowerFormEnabled: opt("ICON_POWER_FORM_ENABLED", "true") === "true",
  /**
   * SolQ — LeadConnector Employee Submission form + link-tree SMS.
   * Trigger: Other Installers? contains SolQ/SOLQ. Headless Chromium.
   * On by default for live testing.
   */
  solqFormUrl: opt("SOLQ_FORM_URL", "https://msg.black33.io/widget/form/zEAvzxnz1cl1TTDNNMSz"),
  solqFormEnabled: opt("SOLQ_FORM_ENABLED", "true") === "true",
  solqFormSubmitterName: opt("SOLQ_FORM_SUBMITTER_NAME", "Nox Power Admin"),
  solqOutsideOrgName: opt("SOLQ_OUTSIDE_ORG_NAME", "Solar Pros"),
  solqLinksUrl: opt("SOLQ_LINKS_URL", "https://solarquotespv.com/sq/tools/lt-freedompros.php"),
  solqSmsEnabled: opt("SOLQ_SMS_ENABLED", "true") === "true",
};
