import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { env } from "../src/lib/env";
import {
  enerfloEmailForInstaller,
  installerEmailSuffix,
  slugifyInstallerSuffix,
  destinationsForInstallerTabs,
} from "../src/lib/onboarding/installer-registry";
import {
  buildWorkUpn,
  normalizeEmail,
  sequifiRoleLabel,
  sequifiUserFromApi,
} from "../src/lib/onboarding/normalize";
import {
  enerfloRolesIncludeManager,
  resolveRoleMapping,
  resolveRoleMappingFromSequifi,
  sequifiPositionContextFromJob,
  sequifiPositionContextFromUser,
} from "../src/lib/onboarding/role-map";
import {
  getSequifiFieldValue,
  isSequifiYes,
  parseSequifiFields,
} from "../src/lib/onboarding/sequifi-fields";
import { renderWelcomeTemplate } from "../src/lib/onboarding/welcome-templates";
import {
  buildEmpwrHubSpotPayload,
  empwrHubSpotAlreadySent,
  jobHasEmpwrInstallerTab,
  mapEmpwrHubSpotRole,
  validateEmpwrHubSpotPayload,
} from "../src/lib/onboarding/empwr-hubspot";
import {
  buildEmpowerTypeformEmail,
  buildEmpowerTypeformFields,
  EMPOWER_FINANCIERS_EXCEPT_GOODLEAP,
  EMPOWER_HOME_SERVICES,
  empowerTypeformAlreadySent,
  isEmpowerTabName,
  jobHasEmpowerInstallerTab,
  mapEmpowerTypeformAccess,
  normalizeEmpowerTypeformDate,
  resolveEmpowerTypeformStates,
  shouldSkipEmpowerTypeformForSetter,
  validateEmpowerTypeformFields,
} from "../src/lib/onboarding/empower-typeform";
import { buildEmpowerTextMessage, empowerTextAlreadySent } from "../src/lib/onboarding/empower-text";
import {
  buildTronJotFormBody,
  buildTronJotFormFields,
  jobHasTronInstallerTab,
  resolveDob,
  resolveSalesManagerName,
  resolveTronPlatforms,
  tronJotFormAlreadySent,
} from "../src/lib/onboarding/tron-jotform";
import {
  buildGoodPwrFormBody,
  buildGoodPwrFormFields,
  goodPwrFormAlreadySent,
  jobHasGoodPwrInstallerTab,
  resolveGoodPwrLender,
  resolveGoodPwrTpo,
} from "../src/lib/onboarding/goodpwr-form";
import { buildGoodPwrTextMessage, goodPwrTextAlreadySent } from "../src/lib/onboarding/goodpwr-text";
import { toE164UsPhone } from "../src/lib/onboarding/sms";
import {
  betterEarthFormAlreadySent,
  buildBetterEarthContinuePayload,
  buildBetterEarthFormFields,
  jobHasBetterEarthInstallerTab,
  resolveBetterEarthStates,
} from "../src/lib/onboarding/better-earth-form";
import {
  bpsFormAlreadySent,
  buildBpsFormFields,
  buildBpsSubmitData,
  isBpsTabName,
  jobHasBpsInstallerTab,
  resolveBpsMarketStates,
} from "../src/lib/onboarding/bps-form";
import {
  buildGreenBrillianceRosterRow,
  greenBrillianceRosterAlreadySent,
  greenBrillianceRowToSheetValues,
  isGreenBrillianceTabName,
  jobHasGreenBrillianceInstallerTab,
} from "../src/lib/onboarding/green-brilliance-roster";
import {
  buildIconPowerFormFields,
  buildIconPowerSubmitData,
  iconPowerFormAlreadySent,
  isIconPowerTabName,
  jobHasIconPowerInstallerTab,
  resolveIconPowerStartDate,
} from "../src/lib/onboarding/icon-power-form";
import {
  buildSolqFormFields,
  buildSolqNotes,
  isSolqTabName,
  jobHasSolqInstallerTab,
  mapSolqPosition,
  resolveSolqMarkets,
  resolveSolqStartDate,
  solqFormAlreadySent,
  validateSolqFormFields,
} from "../src/lib/onboarding/solq-form";
import { buildSolqTextMessage, solqTextAlreadySent } from "../src/lib/onboarding/solq-text";
import {
  buildTerrosTeamCatalog,
  canonicalTeamKey,
  matchTerrosTeamForOffice,
} from "../src/lib/onboarding/terros-team";

const sequifiRaw = {
  employee_admin_only_fields: [
    { field_name: "Onboard to Axia?", value: "Yes" },
    { field_name: "Onboard to Empwr?", value: "yes" },
    { field_name: "HIS License Number", value: "HIS-123" },
  ],
  employee_personal_detail: [
    { field_name: "Other Installers?", value: "Tron; Custom Co, Axia" },
    { field_name: "Please provide the market(s) you will be working in?", value: "CA, NV" },
    { field_name: "HIS Issue Date", value: "2026-01-01" },
    { field_name: "HIS Exp Date", value: "2027-01-01" },
  ],
  state_code: "AZ",
};

function onboardingJob(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-1",
    sequifi_user_id: "100",
    sequifi_employee_id: "E100",
    email: "personal@example.com",
    email_normalized: "personal@example.com",
    first_name: "Jane",
    last_name: "Doe",
    phone: "555-0100",
    role_label: "Sales Rep",
    welcome_email_to: null,
    raw_sequifi_payload: sequifiRaw,
    status: "completed",
    microsoft_status: "success",
    enerflo_status: "success",
    terros_status: "success",
    welcome_email_status: "success",
    microsoft_user_id: null,
    microsoft_upn: null,
    enerflo_user_id: null,
    terros_user_id: null,
    temp_password: null,
    last_error: null,
    step_errors: {},
    attempt_count: 0,
    next_retry_at: null,
    max_attempts: 5,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    completed_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("Sequifi normalization and custom field parsing", () => {
  test("normalizes emails and builds company UPNs", () => {
    assert.equal(normalizeEmail(" Rep+Axia@NoxPwr.com "), "rep@noxpwr.com");
    assert.equal(buildWorkUpn("Jane-Marie", "O'Doe", "noxpwr.com"), "janemarieodoe@noxpwr.com");
    assert.equal(buildWorkUpn("", "", "noxpwr.com"), "user@noxpwr.com");
  });

  test("parses Sequifi user records and role labels", () => {
    const user = sequifiUserFromApi({
      id: "123",
      employee_id: "E123",
      email: "rep@example.com",
      first_name: "Jane",
      last_name: "Doe",
      sub_position_name: "Closer",
      position_name: "Sales",
    });
    assert.equal(user?.id, 123);
    assert.equal(user?.first_name, "Jane");
    assert.equal(sequifiRoleLabel(user!), "Closer");
    assert.equal(sequifiUserFromApi({ id: "bad", employee_id: "", email: "" }), null);
  });

  test("extracts Sequifi field values case-insensitively", () => {
    assert.equal(getSequifiFieldValue(sequifiRaw, "his license number"), "HIS-123");
    assert.equal(isSequifiYes(" YES "), true);
    assert.equal(isSequifiYes("true"), false);

    const parsed = parseSequifiFields(sequifiRaw);
    assert.equal(parsed.onboardAxia, true);
    assert.deepEqual(parsed.installerTabs, ["Axia", "EMPWR", "Tron", "Custom Co"]);
    assert.equal(parsed.markets, "CA, NV");
    assert.equal(parsed.caHis, "HIS-123");
    assert.equal(parsed.hisIssueDate, "2026-01-01");
    assert.equal(parsed.hisExpDate, "2027-01-01");
  });

  test("still recognizes the Axia question after Sequifi silently renamed its label (~2026-07-17)", () => {
    // Real label seen live on affected reps (Justin Lopez, Charles Liddle,
    // Lucie Uwimbabazi, Jahsiahia Stewart) — an exact match on the old
    // "Onboard to Axia?" string missed this and silently dropped their
    // "Yes" answer (no Enerflo account, no Axia notification email).
    const renamedRaw = {
      employee_admin_only_fields: [
        {
          field_name:
            "Please select which installer(s) the user needs to be onboarded to. Must select at " +
            "least one. Would you like to onboard the user to Axia?",
          value: "Yes",
        },
        { field_name: "Onboard to Tron?", value: "No" },
      ],
    };
    const parsed = parseSequifiFields(renamedRaw);
    assert.equal(parsed.onboardAxia, true);
    assert.deepEqual(parsed.installerTabs, ["Axia"]);
  });

  test("renamed-label fallback still respects a 'No' answer and doesn't false-positive other installers", () => {
    const renamedNo = {
      employee_admin_only_fields: [
        {
          field_name: "Would you like to onboard the user to Axia?",
          value: "No",
        },
      ],
    };
    const parsed = parseSequifiFields(renamedNo);
    assert.equal(parsed.onboardAxia, false);
    assert.deepEqual(parsed.installerTabs, []);
  });

  test("reads markets from Sequifi state(s) question when market(s) label is absent", () => {
    const parsed = parseSequifiFields({
      state_code: "CA",
      employee_admin_only_fields: [
        {
          field_name: "Please provide the state(s) you will be working in.",
          value: "AZ",
        },
      ],
    });
    assert.equal(parsed.markets, "AZ");
  });
});

describe("installer registry and role mapping", () => {
  test("builds installer email suffixes and destinations", () => {
    assert.equal(slugifyInstallerSuffix("Some Co, LLC"), "somecollc");
    assert.equal(installerEmailSuffix("Good Pwr"), "goodpwr");
    assert.equal(enerfloEmailForInstaller("Jane", "Doe", "Axia", "noxpwr.com"), "janedoe+axia@noxpwr.com");

    const destinations = destinationsForInstallerTabs([" Axia ", "axia", "Custom Co"]);
    assert.equal(destinations.length, 2);
    assert.equal(destinations[0]?.tabName, "Axia");
    assert.equal(destinations[0]?.layout.kind, "axia");
    assert.equal(destinations[1]?.layout.kind, "standard");
  });

  test("resolves role mappings from Sequifi context and env overrides", () => {
    assert.deepEqual(resolveRoleMapping("Appt Setter"), {
      enerfloRoles: ["Setter"],
      terrosRoles: ["Setter"],
      welcomeTemplate: "appt_setter",
    });
    assert.deepEqual(resolveRoleMappingFromSequifi({ positionName: "Sales", subPositionName: "Manager" }), {
      enerfloRoles: ["Sales Rep Manager"],
      terrosRoles: ["Self Gen & Closer"],
      welcomeTemplate: "sales_rep",
    });
    assert.deepEqual(
      resolveRoleMappingFromSequifi(
        { positionName: "Closer", subPositionName: "" },
        '{"Closer":{"enerfloRoles":["Custom"],"terrosRoles":["Closer"],"welcomeTemplate":"sales_rep"}}',
      ),
      {
        enerfloRoles: ["Custom"],
        terrosRoles: ["Closer"],
        welcomeTemplate: "sales_rep",
      },
    );
    assert.equal(enerfloRolesIncludeManager(["Setter", "Sales Rep Manager"]), true);
  });

  test("derives position context from users and jobs", () => {
    assert.deepEqual(
      sequifiPositionContextFromUser({
        position_name: "",
        sub_position_name: "",
        raw: { position_name: "Sales Rep", sub_position_name: "Appt Setter" },
      }),
      { positionName: "Sales Rep", subPositionName: "Appt Setter" },
    );
    assert.deepEqual(
      sequifiPositionContextFromJob({
        role_label: "Fallback",
        raw_sequifi_payload: { position_name: "Sales", sub_position_name: "Manager" },
      } as never),
      { positionName: "Sales", subPositionName: "Manager" },
    );
  });
});

describe("welcome and EMPWR HubSpot payloads", () => {
  test("renders sales rep and appointment setter welcome templates", () => {
    const axia = renderWelcomeTemplate("sales_rep", {
      firstName: "Jane",
      username: "jane@noxpwr.com",
      password: "Secret123",
      installerTabs: ["Axia", "EMPWR"],
      onboardAxia: true,
    });
    assert.equal(axia.subject, "Welcome to Axia — your Nox Power email");
    assert.match(axia.body, /Hello Jane,/);
    assert.match(axia.body, /Axia, EMPWR/);
    assert.match(axia.body, /Planner tips:/);
    assert.match(axia.body, /Aurora: support@aurorasolar.com/);
    assert.match(axia.body, /Email admin@noxpwr.com for questions/);
    assert.doesNotMatch(axia.body, /Reply to this email/);

    // Non-Axia installers get a generic email — no Aurora / EnFin / Recheck / planner tips.
    const generic = renderWelcomeTemplate("sales_rep", {
      firstName: "Drew",
      username: "drewcollum@noxpwr.com",
      password: "Secret123",
      installerTabs: ["EMPWR"],
      onboardAxia: false,
    });
    assert.equal(generic.subject, "Welcome — your Nox Power email");
    assert.match(generic.body, /Outlook, Enerflo, and Terros/);
    assert.match(generic.body, /Email admin@noxpwr.com for questions/);
    assert.doesNotMatch(generic.body, /Planner tips:/);
    assert.doesNotMatch(generic.body, /Aurora/);
    assert.doesNotMatch(generic.body, /Reply to this email/);

    // Quality Solar does not use Enerflo — systems list omits it.
    const qualitySolar = renderWelcomeTemplate("sales_rep", {
      firstName: "Drew",
      username: "drewcollum@noxpwr.com",
      password: "Secret123",
      installerTabs: ["Quality Solar"],
      onboardAxia: false,
      includeEnerflo: false,
    });
    assert.match(qualitySolar.body, /Outlook and Terros/);
    assert.doesNotMatch(qualitySolar.body, /Enerflo/);

    const setter = renderWelcomeTemplate("appt_setter", {
      username: "setter@noxpwr.com",
      password: "Secret123",
    });
    assert.equal(setter.subject, "Welcome — your Nox Power email");
    assert.doesNotMatch(setter.body, /Planner tips:/);
    assert.doesNotMatch(setter.body, /Aurora/);
    assert.match(setter.body, /Email admin@noxpwr.com for questions/);
  });

  test("builds and validates EMPWR HubSpot payloads", () => {
    env.msDefaultDomain = "noxpwr.com";
    env.hubspotEmpwrCompany = "Nox Power";

    const job = onboardingJob();
    assert.equal(jobHasEmpwrInstallerTab(job as never), true);
    assert.equal(empwrHubSpotAlreadySent(onboardingJob({ step_errors: { empwr_hubspot: "sent" } }) as never), true);
    assert.equal(mapEmpwrHubSpotRole(onboardingJob({ raw_sequifi_payload: { position_name: "Sales", sub_position_name: "Manager" } }) as never), "District Manager");

    const payload = buildEmpwrHubSpotPayload(job as never);
    const byName = Object.fromEntries(payload.fields.map((f) => [f.name, f.value]));
    assert.equal(byName.firstname, "Jane");
    assert.equal(byName.lastname, "Doe");
    assert.equal(byName.email, "janedoe@noxpwr.com");
    assert.equal(byName.company, "Nox Power");
    assert.equal(validateEmpwrHubSpotPayload(payload), null);
    assert.equal(
      validateEmpwrHubSpotPayload({ ...payload, fields: payload.fields.filter((f) => f.name !== "phone") }),
      "Missing required field: phone",
    );
  });
});

describe("Empower Typeform submission and text message", () => {
  const empowerRaw = {
    employee_personal_detail: [
      { field_name: "Other Installers?", value: "Empower" },
      { field_name: "Please provide the market(s) you will be working in?", value: "CA, UT" },
      { field_name: "HIS License Number", value: "HIS-999" },
      { field_name: "HIS Issue Date", value: "01/15/2026" },
      { field_name: "HIS Exp Date", value: "01/15/2028" },
    ],
  };

  test("detects Empower (not Empwr) and prior sends", () => {
    const job = onboardingJob({ raw_sequifi_payload: empowerRaw });
    assert.equal(isEmpowerTabName("Empower"), true);
    assert.equal(isEmpowerTabName("Empower Home"), true);
    assert.equal(isEmpowerTabName("EMPWR"), false);
    assert.equal(isEmpowerTabName("Empwr"), false);
    assert.equal(jobHasEmpowerInstallerTab(job as never), true);
    assert.equal(jobHasEmpowerInstallerTab(onboardingJob() as never), false);
    assert.equal(
      jobHasEmpowerInstallerTab(
        onboardingJob({
          raw_sequifi_payload: {
            employee_admin_only_fields: [{ field_name: "Onboard to Empwr?", value: "yes" }],
          },
        }) as never,
      ),
      false,
    );
    assert.equal(empowerTypeformAlreadySent(job as never), false);
    assert.equal(
      empowerTypeformAlreadySent(onboardingJob({ step_errors: { empower_typeform: "sent" } }) as never),
      true,
    );
    assert.equal(empowerTextAlreadySent(job as never), false);
    assert.equal(
      empowerTextAlreadySent(onboardingJob({ step_errors: { empower_text: "sent" } }) as never),
      true,
    );
  });

  test("skips Typeform for Appt Setters / Setters; Admin maps to Admin access", () => {
    assert.equal(
      shouldSkipEmpowerTypeformForSetter({
        raw_sequifi_payload: { position_name: "Sales", sub_position_name: "Appt Setter" },
        role_label: null,
      } as never),
      true,
    );
    assert.equal(
      shouldSkipEmpowerTypeformForSetter({
        raw_sequifi_payload: { position_name: "Sales", sub_position_name: "Closer" },
        role_label: null,
      } as never),
      false,
    );
    assert.equal(
      shouldSkipEmpowerTypeformForSetter({
        raw_sequifi_payload: { position_name: "Setter", sub_position_name: "" },
        role_label: null,
      } as never),
      true,
    );
    assert.equal(
      mapEmpowerTypeformAccess({
        raw_sequifi_payload: { position_name: "Admin", sub_position_name: "" },
        role_label: null,
      } as never),
      "Admin",
    );
    assert.equal(
      mapEmpowerTypeformAccess({
        raw_sequifi_payload: { position_name: "Sales", sub_position_name: "Closer" },
        role_label: null,
      } as never),
      "Closer",
    );
  });

  test("builds SOP Typeform fields (+emp email, Team 803, no Goodleap)", () => {
    env.empowerTypeformEmailDomain = "solarpros.io";
    env.empowerTypeformTeamId = "803";
    assert.equal(buildEmpowerTypeformEmail("Jane", "Doe"), "janedoe+emp@solarpros.io");
    assert.equal(buildEmpowerTypeformEmail("Jane-Marie", "O'Doe"), "janemarieodoe+emp@solarpros.io");

    const job = onboardingJob({
      phone: "555-111-2222",
      raw_sequifi_payload: {
        ...empowerRaw,
        position_name: "Sales",
        sub_position_name: "Closer",
      },
    });
    const fields = buildEmpowerTypeformFields(job as never);
    assert.equal(fields.email, "janedoe+emp@solarpros.io");
    assert.equal(fields.teamId, "803");
    assert.equal(fields.newToEmpower, "New to Empower");
    assert.equal(fields.accessNeeded, "Closer");
    assert.deepEqual(fields.homeServices, [...EMPOWER_HOME_SERVICES]);
    assert.deepEqual(fields.financiers, [...EMPOWER_FINANCIERS_EXCEPT_GOODLEAP]);
    assert.ok(!(fields.financiers as readonly string[]).includes("Goodleap"));
    assert.deepEqual(fields.states, ["CA", "UT"]);
    assert.equal(fields.his?.licenseNumber, "HIS-999");
    assert.equal(fields.his?.issueDate, "2026-01-15");
    assert.equal(fields.his?.expirationDate, "2028-01-15");
    assert.equal(validateEmpowerTypeformFields(fields), null);

    assert.deepEqual(
      resolveEmpowerTypeformStates({
        raw_sequifi_payload: {
          employee_personal_detail: [
            { field_name: "Please provide the market(s) you will be working in?", value: "Arizona" },
          ],
        },
      } as never),
      ["AZ"],
    );
    assert.equal(normalizeEmpowerTypeformDate("01/15/2026"), "2026-01-15");
    assert.equal(normalizeEmpowerTypeformDate("2026-01-15"), "2026-01-15");

    const nonCa = buildEmpowerTypeformFields(
      onboardingJob({
        phone: "555-111-2222",
        raw_sequifi_payload: {
          employee_personal_detail: [
            { field_name: "Other Installers?", value: "Empower" },
            { field_name: "Please provide the market(s) you will be working in?", value: "UT" },
          ],
        },
      }) as never,
    );
    assert.equal(nonCa.his, null);
    assert.equal(validateEmpowerTypeformFields(nonCa), null);

    const noState = buildEmpowerTypeformFields(
      onboardingJob({
        phone: "555-111-2222",
        raw_sequifi_payload: {
          employee_personal_detail: [{ field_name: "Other Installers?", value: "Empower" }],
        },
      }) as never,
    );
    assert.match(validateEmpowerTypeformFields(noState) ?? "", /No Empower Typeform states/);
  });

  test("builds the Empower SOP text with Jobflo video URL", () => {
    env.empowerJobfloVideoUrl = "https://www.loom.com/share/8e99f6aa14ae47e8ac30f32ff42801ba";
    const message = buildEmpowerTextMessage();
    assert.match(message, /Hello! You have been onboarded for Empower\./);
    assert.match(message, /10 Min Crash Course on Jobflo/);
    assert.match(message, /https:\/\/www\.loom\.com\/share\/8e99f6aa14ae47e8ac30f32ff42801ba/);
    assert.match(message, /Thanks!$/);
  });
});

describe("Tron JotForm submission", () => {
  test("detects the Tron installer tab and prior sends", () => {
    const job = onboardingJob();
    assert.equal(jobHasTronInstallerTab(job as never), true);
    assert.equal(
      jobHasTronInstallerTab(onboardingJob({ raw_sequifi_payload: {} }) as never),
      false,
    );
    assert.equal(tronJotFormAlreadySent(job as never), false);
    assert.equal(
      tronJotFormAlreadySent(onboardingJob({ step_errors: { tron_jotform: "sent" } }) as never),
      true,
    );
  });

  test("picks Aurora-only for Setter/Appt Setter, all platforms otherwise — ignoring closer capability", () => {
    // Pure Appt Setter — Aurora only.
    assert.deepEqual(
      resolveTronPlatforms({
        raw_sequifi_payload: { position_name: "Appt Setter", sub_position_name: "" },
        role_label: null,
      } as never),
      ["Aurora"],
    );
    // Sales Rep — full platform list.
    assert.deepEqual(
      resolveTronPlatforms({
        raw_sequifi_payload: { position_name: "Closer", sub_position_name: "Sales Rep" },
        role_label: null,
      } as never),
      ["Aurora", "Sunrun", "Palmetto", "Dividend", "Coperniq", "GroupMe Access", "Enfin"],
    );
    // Hybrid — sub_position_name "Appt Setter" with position_name "Closer" (Sequifi's
    // "May act as both Setter and Closer: Yes") still only gets Aurora.
    assert.deepEqual(
      resolveTronPlatforms({
        raw_sequifi_payload: { position_name: "Closer", sub_position_name: "Appt Setter" },
        role_label: null,
      } as never),
      ["Aurora"],
    );
  });

  test("resolves the Sales Manager name from Sequifi's manager object, with fallbacks", () => {
    // Real Sequifi /v1/users shape: manager is a structured object, not a custom field.
    assert.equal(
      resolveSalesManagerName({
        raw_sequifi_payload: {
          manager: { id: 29, first_name: "Deepak", last_name: "Sharma", email: "deepaksharma@noxpwr.com" },
        },
      } as never),
      "Deepak Sharma",
    );
    assert.equal(
      resolveSalesManagerName({
        raw_sequifi_payload: {
          employee_admin_only_fields: [{ field_name: "Manager", value: "Marcelino Huizar" }],
        },
      } as never),
      "Marcelino Huizar",
    );
    assert.equal(
      resolveSalesManagerName({
        raw_sequifi_payload: { manager_name: "Fallback Manager" },
      } as never),
      "Fallback Manager",
    );
    assert.equal(resolveSalesManagerName({ raw_sequifi_payload: {} } as never), "");
    assert.equal(resolveSalesManagerName({ raw_sequifi_payload: { manager: null } } as never), "");
  });

  test("parses Sequifi's top-level dob field ('YYYY-MM-DD') into month/day/year", () => {
    assert.deepEqual(resolveDob({ raw_sequifi_payload: { dob: "2005-04-20" } } as never), {
      month: "04",
      day: "20",
      year: "2005",
    });
    assert.deepEqual(resolveDob({ raw_sequifi_payload: { dob: "5/7/1990" } } as never), {
      month: "05",
      day: "07",
      year: "1990",
    });
    // Null / missing Sequifi dob falls back to ONBOARDING_DEFAULT_DOB (1990-01-01).
    assert.deepEqual(resolveDob({ raw_sequifi_payload: { dob: null } } as never), {
      month: "01",
      day: "01",
      year: "1990",
    });
    assert.deepEqual(resolveDob({ raw_sequifi_payload: { dob: "not-a-date" } } as never), {
      month: "01",
      day: "01",
      year: "1990",
    });
    assert.deepEqual(resolveDob({ raw_sequifi_payload: {} } as never), {
      month: "01",
      day: "01",
      year: "1990",
    });
  });

  test("builds Tron JotForm fields and urlencoded submission body", () => {
    env.msDefaultDomain = "noxpwr.com";
    const job = onboardingJob({
      phone: "5551234567",
      microsoft_upn: "janedoe@noxpwr.com",
      raw_sequifi_payload: {
        ...sequifiRaw,
        position_name: "Closer",
        sub_position_name: "Sales Rep",
        manager: { id: 29, first_name: "Marcelino", last_name: "Huizar", email: "marcelinohuizar@noxpwr.com" },
        dob: "1990-11-03",
      },
    });

    const fields = buildTronJotFormFields(job as never);
    assert.equal(fields.firstName, "Jane");
    assert.equal(fields.lastName, "Doe");
    assert.equal(fields.salesOrganization, "NOX Power");
    assert.equal(fields.email, "janedoe@noxpwr.com");
    assert.equal(fields.phone, "(555) 123-4567");
    assert.equal(fields.salesManager, "Marcelino Huizar");
    assert.equal(fields.notes, "");
    assert.deepEqual(fields.dob, { month: "11", day: "03", year: "1990" });
    assert.deepEqual(fields.platforms, [
      "Aurora",
      "Sunrun",
      "Palmetto",
      "Dividend",
      "Coperniq",
      "GroupMe Access",
      "Enfin",
    ]);

    const body = buildTronJotFormBody(fields, "252994617874071");
    assert.equal(body.get("formID"), "252994617874071");
    assert.equal(body.get("simple_spc"), "252994617874071");
    assert.equal(body.get("website"), "");
    assert.equal(body.get("q3_name[first]"), "Jane");
    assert.equal(body.get("q3_name[last]"), "Doe");
    assert.equal(body.get("q9_typeA"), "NOX Power");
    assert.equal(body.get("q5_email"), "janedoe@noxpwr.com");
    assert.equal(body.get("q6_phoneNumber[full]"), "(555) 123-4567");
    assert.equal(body.get("q7_dateOf[month]"), "11");
    assert.equal(body.get("q7_dateOf[day]"), "03");
    assert.equal(body.get("q7_dateOf[year]"), "1990");
    assert.equal(body.get("q18_pleaseInput"), "Marcelino Huizar");
    assert.equal(body.get("q15_notes"), "");
    assert.deepEqual(body.getAll("q4_platformsLogins[]"), [
      "Aurora",
      "Sunrun",
      "Palmetto",
      "Dividend",
      "Coperniq",
      "GroupMe Access",
      "Enfin",
    ]);
  });
});

describe("GoodPWR JotForm submission and text message", () => {
  const goodPwrRaw = {
    employee_admin_only_fields: [{ field_name: "Onboard to Good Pwr?", value: "Yes" }],
  };

  test("detects the GoodPWR installer tab and prior sends", () => {
    const job = onboardingJob({ raw_sequifi_payload: goodPwrRaw });
    assert.equal(jobHasGoodPwrInstallerTab(job as never), true);
    assert.equal(jobHasGoodPwrInstallerTab(onboardingJob() as never), false);
    assert.equal(goodPwrFormAlreadySent(job as never), false);
    assert.equal(
      goodPwrFormAlreadySent(onboardingJob({ step_errors: { goodpwr_form: "sent" } }) as never),
      true,
    );
    assert.equal(goodPwrTextAlreadySent(job as never), false);
    assert.equal(
      goodPwrTextAlreadySent(onboardingJob({ step_errors: { goodpwr_text: "sent" } }) as never),
      true,
    );
  });

  test("Preferred Lender/TPO default to Sungage / LightReach; Sequifi custom fields override", () => {
    assert.equal(resolveGoodPwrLender({ raw_sequifi_payload: goodPwrRaw } as never), "Sungage");
    assert.equal(resolveGoodPwrTpo({ raw_sequifi_payload: goodPwrRaw } as never), "LightReach");

    const withLenderField = {
      ...goodPwrRaw,
      employee_personal_detail: [
        { field_name: "Preferred Lender", value: "GoodLeap" },
        { field_name: "Preferred TPO", value: "SunRun" },
      ],
    };
    assert.equal(resolveGoodPwrLender({ raw_sequifi_payload: withLenderField } as never), "GoodLeap");
    assert.equal(resolveGoodPwrTpo({ raw_sequifi_payload: withLenderField } as never), "SunRun");
  });

  test("builds GoodPWR JotForm fields (static SOP values) and the urlencoded submission body", () => {
    env.msDefaultDomain = "noxpwr.com";
    const job = onboardingJob({
      phone: "555-111-2222",
      microsoft_upn: "janedoe@noxpwr.com",
      raw_sequifi_payload: goodPwrRaw,
    });

    const fields = buildGoodPwrFormFields(job as never);
    assert.equal(fields.firstName, "Jane");
    assert.equal(fields.lastName, "Doe");
    assert.equal(fields.email, "janedoe@noxpwr.com");
    assert.equal(fields.phone, "(555) 111-2222");
    assert.equal(fields.salesOrganization, "Solar Pros");
    assert.equal(fields.recheck, "");
    assert.deepEqual(fields.markets, ["New York", "Oregon", "Illinois"]);
    assert.equal(fields.hisLicense, "Not selling in these markets");
    assert.equal(fields.usingEnerflo, "Yes");
    assert.equal(fields.preferredLender, "Sungage");
    assert.equal(fields.preferredTpo, "LightReach");
    assert.equal(fields.comments, "");

    const body = buildGoodPwrFormBody(fields, "261804783661160");
    assert.equal(body.get("formID"), "261804783661160");
    assert.equal(body.get("q3_repFull[first]"), "Jane");
    assert.equal(body.get("q3_repFull[last]"), "Doe");
    assert.equal(body.get("q31_email"), "janedoe@noxpwr.com");
    assert.equal(body.get("q51_phoneNumber[full]"), "(555) 111-2222");
    assert.equal(body.get("q26_salesPartner"), "Solar Pros");
    assert.equal(body.get("q35_recheck"), null);
    assert.deepEqual(body.getAll("q45_marketsselect[]"), ["New York", "Oregon", "Illinois"]);
    assert.equal(body.get("q46_hisLicense[]"), "Not selling in these markets");
    assert.equal(body.get("q47_willYou"), "Yes");
    assert.equal(body.get("q48_preferredLender"), "Sungage");
    assert.equal(body.get("q49_preferredTpo"), "LightReach");
  });

  test("builds the exact GoodPWR SOP text message with the links URL", () => {
    env.goodPwrLinksUrl = "https://sites.google.com/goodpwr.com/goodpwr/sales-partners";
    const message = buildGoodPwrTextMessage();
    assert.match(message, /Hello! You have been onboarded for GoodPWR\./);
    assert.match(message, /https:\/\/sites\.google\.com\/goodpwr\.com\/goodpwr\/sales-partners/);
    assert.match(message, /reach out to admin@noxpwr\.com or your manager/);
    assert.match(message, /Thanks!$/);
  });

  test("normalizes US phone numbers to E.164 for Twilio", () => {
    assert.equal(toE164UsPhone("555-111-2222"), "+15551112222");
    assert.equal(toE164UsPhone("(555) 111-2222"), "+15551112222");
    assert.equal(toE164UsPhone("15551112222"), "+15551112222");
    assert.equal(toE164UsPhone("123"), null);
    assert.equal(toE164UsPhone(null), null);
  });
});

describe("Better Earth form submission (Fillout.com — direct REST, no browser needed)", () => {
  const betterEarthRaw = {
    employee_admin_only_fields: [{ field_name: "Onboard to Better Earth?", value: "Yes" }],
    employee_personal_detail: [
      { field_name: "Please provide the market(s) you will be working in?", value: "CA, NV" },
      { field_name: "HIS License Number", value: "HIS-123" },
      { field_name: "HIS Exp Date", value: "2027-01-01" },
    ],
    dob: "1990-05-15",
  };

  test("detects the Better Earth installer tab and prior sends", () => {
    const job = onboardingJob({ raw_sequifi_payload: betterEarthRaw });
    assert.equal(jobHasBetterEarthInstallerTab(job as never), true);
    assert.equal(jobHasBetterEarthInstallerTab(onboardingJob() as never), false);
    assert.equal(betterEarthFormAlreadySent(job as never), false);
    assert.equal(
      betterEarthFormAlreadySent(onboardingJob({ step_errors: { better_earth_form: "sent" } }) as never),
      true,
    );
  });

  test("maps Sequifi markets to Better Earth's 4 supported states, surfacing unsupported ones separately", () => {
    assert.deepEqual(resolveBetterEarthStates({ raw_sequifi_payload: betterEarthRaw } as never), {
      supported: ["California"],
      unsupported: ["NV"],
    });
    assert.deepEqual(
      resolveBetterEarthStates({ raw_sequifi_payload: { state_code: "TX" } } as never),
      { supported: ["Texas"], unsupported: [] },
    );
    assert.deepEqual(
      resolveBetterEarthStates({
        raw_sequifi_payload: {
          employee_personal_detail: [
            { field_name: "Please provide the state(s) you will be working in.", value: "Tx IL" },
          ],
        },
      } as never),
      { supported: ["Texas"], unsupported: ["IL"] },
    );
    assert.deepEqual(
      resolveBetterEarthStates({
        raw_sequifi_payload: {
          employee_personal_detail: [
            { field_name: "Please provide the market(s) you will be working in?", value: "Arizona/Florida" },
          ],
        },
      } as never),
      { supported: ["Arizona", "Florida"], unsupported: [] },
    );
  });

  test("builds form fields from Sequifi data, including CA's HIS license fields", () => {
    env.msDefaultDomain = "noxpwr.com";
    env.betterEarthSalesCompany = "NOX Power";
    const job = onboardingJob({
      phone: "555-111-2222",
      microsoft_upn: "janedoe@noxpwr.com",
      welcome_email_to: "jane.personal@example.com",
      raw_sequifi_payload: betterEarthRaw,
    });

    const fields = buildBetterEarthFormFields(job as never);
    assert.equal(fields.salesCompany, "NOX Power");
    assert.equal(fields.firstName, "Jane");
    assert.equal(fields.lastName, "Doe");
    assert.equal(fields.phone, "+15551112222");
    assert.equal(fields.companyEmail, "janedoe@noxpwr.com");
    assert.equal(fields.personalEmail, "jane.personal@example.com");
    assert.equal(fields.dob, "1990-05-15");
    assert.deepEqual(fields.states, { supported: ["California"], unsupported: ["NV"] });
    assert.equal(fields.hisLicenseNumber, "HIS-123");
    assert.equal(fields.hisLicenseExpDate, "2027-01-01");
  });

  test("builds the exact Fillout /continue payload shape confirmed live against the real flow", () => {
    const fields = buildBetterEarthFormFields(
      onboardingJob({
        phone: "555-111-2222",
        microsoft_upn: "janedoe@noxpwr.com",
        raw_sequifi_payload: betterEarthRaw,
      }) as never,
    );
    const payload = buildBetterEarthContinuePayload(fields, "SESSION_TOKEN_123", "SUBMISSION_ID_456");
    assert.equal(payload.mode, "live");
    assert.equal(payload.sessionToken, "SESSION_TOKEN_123");
    assert.equal(payload.stepId, "x8AY");
    const model = (payload.model as Record<string, unknown>).x8AY as Record<
      string,
      { value: unknown; selectedOptionIds?: string[] }
    >;
    assert.equal(model.tFfy.value, "NOX Power");
    assert.equal(model.p1rc.value, "Jane");
    assert.equal(model.oWvu.value, "Doe");
    assert.equal(model.rnVh.value, "+15551112222");
    assert.equal(model.h2FG.value, "janedoe@noxpwr.com");
    assert.equal(model.p6Ha.value, "1990-05-15");
    assert.deepEqual(model.iY8D.value, ["California"]);
    assert.deepEqual(model.iY8D.selectedOptionIds, ["bjGZ"]);
    assert.equal(model["8zDR"].value, "HIS-123");
    assert.equal(model.geCw.value, "2027-01-01");
  });
});

describe("BPS Smartsheet form submission (Financier Portal Login Request)", () => {
  const bpsRaw = {
    employee_personal_detail: [
      { field_name: "Other Installers?", value: "BPS" },
      { field_name: "Please provide the market(s) you will be working in?", value: "IL" },
    ],
    dob: "1990-05-15",
  };

  test("detects BPS / Bright Planet Solar from Other Installers? free text", () => {
    assert.equal(isBpsTabName("BPS"), true);
    assert.equal(isBpsTabName("Bright Planet Solar"), true);
    assert.equal(isBpsTabName("bps (CA)"), true);
    assert.equal(isBpsTabName("Quality Solar"), false);
    assert.equal(jobHasBpsInstallerTab(onboardingJob({ raw_sequifi_payload: bpsRaw }) as never), true);
    assert.equal(
      jobHasBpsInstallerTab(
        onboardingJob({
          raw_sequifi_payload: {
            employee_personal_detail: [{ field_name: "Other Installers?", value: "Bright Planet Solar" }],
          },
        }) as never,
      ),
      true,
    );
    assert.equal(jobHasBpsInstallerTab(onboardingJob() as never), false);
    assert.equal(
      bpsFormAlreadySent(onboardingJob({ step_errors: { bps_form: "sent" } }) as never),
      true,
    );
  });

  test("maps Sequifi markets to CA/CT yes-no and a primary selling state", () => {
    assert.deepEqual(resolveBpsMarketStates({ raw_sequifi_payload: bpsRaw } as never), ["IL"]);
    assert.deepEqual(
      resolveBpsMarketStates({
        raw_sequifi_payload: {
          employee_personal_detail: [
            { field_name: "Please provide the market(s) you will be working in?", value: "CA, NJ" },
          ],
        },
      } as never),
      ["CA", "NJ"],
    );
    // Explicit markets=AZ must not pull CA from a stale top-level state_code.
    assert.deepEqual(
      resolveBpsMarketStates({
        raw_sequifi_payload: {
          state_code: "CA",
          employee_personal_detail: [
            { field_name: "Please provide the state(s) you will be working in.", value: "AZ" },
          ],
        },
      } as never),
      [],
    );
  });

  test("builds BPS fields and the Smartsheet submit payload (no CA/CT license when No)", () => {
    env.msDefaultDomain = "noxpwr.com";
    env.bpsSalesOrganization = "NOX Power";
    const job = onboardingJob({
      phone: "555-111-2222",
      microsoft_upn: "janedoe@noxpwr.com",
      raw_sequifi_payload: bpsRaw,
    });
    const fields = buildBpsFormFields(job as never);
    assert.equal(fields.salesOrganization, "NOX Power");
    assert.equal(fields.email, "janedoe@noxpwr.com");
    assert.equal(fields.sellInCalifornia, "No");
    assert.equal(fields.sellInConnecticut, "No");
    assert.equal(fields.primarySellingState, "IL");
    assert.equal(fields.dob, "1990-05-15");

    const data = buildBpsSubmitData(fields);
    assert.equal(data.Qvjp0mW.value, "NOX Power");
    assert.equal(data.G1qOPYQ.value, "Jane");
    assert.equal(data["8a3XzMb"].value, "Doe");
    assert.deepEqual(data.bXQrd3d.value, { email: "janedoe@noxpwr.com", name: "Jane Doe" });
    assert.equal(data.dZ0JJPw.value, "No");
    assert.equal(data.nXwglbY0w.value, "No");
    assert.equal(data.anrdPpe.value, "IL");
    assert.equal(data.jMyn5Q0.value, "1990-05-15");
    assert.equal(data.DweMv7o, undefined); // CA HIS omitted when CA=No
    assert.equal(data.kXkvQ1Wq8, undefined); // CT HIS omitted when CT=No
  });

  test("includes CA HIS fields when selling in California", () => {
    const job = onboardingJob({
      microsoft_upn: "janedoe@noxpwr.com",
      raw_sequifi_payload: {
        employee_personal_detail: [
          { field_name: "Other Installers?", value: "Bright Planet Solar" },
          { field_name: "Please provide the market(s) you will be working in?", value: "CA" },
          { field_name: "HIS License Number", value: "123456" },
          { field_name: "HIS Exp Date", value: "2027-06-01" },
        ],
        dob: "1990-05-15",
      },
    });
    const fields = buildBpsFormFields(job as never);
    assert.equal(fields.sellInCalifornia, "Yes");
    assert.equal(fields.caHisNumber, "123456");
    const data = buildBpsSubmitData(fields);
    assert.equal(data.DweMv7o.value, "123456");
    assert.equal(data["5glzDNa"].value, "2027-06-01");
  });
});

describe("Green Brilliance shared roster sheet", () => {
  const gbRaw = {
    employee_personal_detail: [
      { field_name: "Other Installers?", value: "Green Brilliance" },
      { field_name: "Please provide the market(s) you will be working in?", value: "MD" },
      { field_name: "HIS License Number", value: "HIS-MD-99" },
    ],
  };

  test("detects Green Brilliance / GB from Other Installers?", () => {
    assert.equal(isGreenBrillianceTabName("Green Brilliance"), true);
    assert.equal(isGreenBrillianceTabName("GB"), true);
    assert.equal(isGreenBrillianceTabName("gb (MD)"), true);
    assert.equal(isGreenBrillianceTabName("Quality Solar"), false);
    assert.equal(jobHasGreenBrillianceInstallerTab(onboardingJob({ raw_sequifi_payload: gbRaw }) as never), true);
    assert.equal(jobHasGreenBrillianceInstallerTab(onboardingJob() as never), false);
    assert.equal(
      greenBrillianceRosterAlreadySent(
        onboardingJob({ step_errors: { green_brilliance_roster: "sent" } }) as never,
      ),
      true,
    );
  });

  test("builds roster row from Sequifi with Sungage Access left blank", () => {
    env.msDefaultDomain = "noxpwr.com";
    const job = onboardingJob({
      phone: "555-111-2222",
      microsoft_upn: "janedoe@noxpwr.com",
      raw_sequifi_payload: gbRaw,
    });
    const row = buildGreenBrillianceRosterRow(job as never, new Date("2026-07-27T12:00:00Z"));
    assert.equal(row.firstName, "Jane");
    assert.equal(row.lastName, "Doe");
    assert.equal(row.phone, "555-111-2222");
    assert.equal(row.email, "janedoe@noxpwr.com");
    assert.equal(row.licenseHis, "HIS-MD-99");
    assert.equal(row.sungageAccess, "");
    assert.equal(row.market, "MD");
    assert.equal(row.dateAdded, "2026-07-27");
    assert.deepEqual(greenBrillianceRowToSheetValues(row), [
      "Jane",
      "Doe",
      "555-111-2222",
      "janedoe@noxpwr.com",
      "HIS-MD-99",
      "",
      "MD",
      "2026-07-27",
      "",
    ]);
  });
});

describe("Icon Power Smartsheet form submission", () => {
  const iconRaw = {
    employee_personal_detail: [{ field_name: "Other Installers?", value: "Icon Power" }],
    sub_position_name: "Sales Rep",
    manager: { first_name: "Jordan", last_name: "Bastian", email: "jordan@example.com" },
    created_at: "2026-07-20T15:00:00Z",
  };

  test("detects Icon Power / Icon from Other Installers?", () => {
    assert.equal(isIconPowerTabName("Icon Power"), true);
    assert.equal(isIconPowerTabName("Icon"), true);
    assert.equal(isIconPowerTabName("icon (NV)"), true);
    assert.equal(isIconPowerTabName("Quality Solar"), false);
    assert.equal(jobHasIconPowerInstallerTab(onboardingJob({ raw_sequifi_payload: iconRaw }) as never), true);
    assert.equal(jobHasIconPowerInstallerTab(onboardingJob() as never), false);
    assert.equal(
      iconPowerFormAlreadySent(onboardingJob({ step_errors: { icon_power_form: "sent" } }) as never),
      true,
    );
  });

  test("uses Sequifi values and N/A fallbacks; start date from Sequifi created_at", () => {
    env.msDefaultDomain = "noxpwr.com";
    const job = onboardingJob({
      phone: "555-111-2222",
      microsoft_upn: "janedoe@noxpwr.com",
      role_label: "Sales Rep",
      raw_sequifi_payload: iconRaw,
    });
    const fields = buildIconPowerFormFields(job as never, new Date("2026-07-27T12:00:00Z"));
    assert.equal(fields.employeeName, "Jane Doe");
    assert.equal(fields.jobTitle, "Sales Rep");
    assert.equal(fields.manager, "Jordan Bastian");
    assert.equal(fields.payRate, "N/A"); // no Sequifi pay rate
    assert.equal(fields.startDate, "2026-07-20");
    assert.equal(fields.phone, "555-111-2222");
    assert.equal(fields.email, "janedoe@noxpwr.com");

    const data = buildIconPowerSubmitData(fields);
    assert.equal(data.Ya3M6Yq3D.value, "Jane Doe");
    assert.equal(data.wNK1350nb.value, "Sales Rep");
    assert.equal(data.zA0QopXnq.value, "Jordan Bastian");
    assert.equal(data["2waJbzkL3"].value, "N/A");
    assert.equal(data.Z5aE3wRDP.value, "2026-07-20");
    assert.equal(data.J9Qgy3nXm.value, "555-111-2222");
    assert.equal(data["1z36lw19J"].value, "janedoe@noxpwr.com");
  });

  test("falls back start date to today when Sequifi has no date", () => {
    assert.equal(
      resolveIconPowerStartDate(
        { raw_sequifi_payload: {}, created_at: "" } as never,
        new Date("2026-07-27T12:00:00Z"),
      ),
      "2026-07-27",
    );
  });
});

describe("SolQ LeadConnector form submission and text message", () => {
  const solqRaw = {
    employee_personal_detail: [
      { field_name: "Other Installers?", value: "SolQ" },
      { field_name: "Please provide the market(s) you will be working in?", value: "IA" },
      { field_name: "Team", value: "Alpha" },
    ],
    office_name: "Des Moines",
    sub_position_name: "Closer",
    manager: { first_name: "Pat", last_name: "Lee" },
  };

  test("detects SolQ / SOLQ (not other installers) and prior sends", () => {
    assert.equal(isSolqTabName("SolQ"), true);
    assert.equal(isSolqTabName("SOLQ"), true);
    assert.equal(isSolqTabName("solq"), true);
    assert.equal(isSolqTabName("SolQ Iowa"), false);
    assert.equal(isSolqTabName("Quality Solar"), false);
    assert.equal(jobHasSolqInstallerTab(onboardingJob({ raw_sequifi_payload: solqRaw }) as never), true);
    assert.equal(
      jobHasSolqInstallerTab(
        onboardingJob({
          raw_sequifi_payload: {
            employee_personal_detail: [{ field_name: "Other Installers?", value: "SOLQ" }],
          },
        }) as never,
      ),
      true,
    );
    assert.equal(jobHasSolqInstallerTab(onboardingJob() as never), false);
    assert.equal(
      solqFormAlreadySent(onboardingJob({ step_errors: { solq_form: "sent" } }) as never),
      true,
    );
    assert.equal(
      solqTextAlreadySent(onboardingJob({ step_errors: { solq_text: "sent" } }) as never),
      true,
    );
  });

  test("maps position/markets/start date and builds SOP form fields", () => {
    env.solqFormSubmitterName = "Nox Power Admin";
    env.solqOutsideOrgName = "Solar Pros";

    assert.equal(
      mapSolqPosition({
        raw_sequifi_payload: { sub_position_name: "Appt Setter" },
        role_label: null,
      } as never),
      "Setter",
    );
    assert.equal(
      mapSolqPosition({
        raw_sequifi_payload: { sub_position_name: "Closer" },
        role_label: null,
      } as never),
      "Closer",
    );
    assert.deepEqual(resolveSolqMarkets({ raw_sequifi_payload: solqRaw } as never), ["Iowa"]);
    assert.deepEqual(
      resolveSolqMarkets({
        raw_sequifi_payload: {
          employee_personal_detail: [
            { field_name: "Please provide the market(s) you will be working in?", value: "NV" },
          ],
        },
      } as never),
      ["Other"],
    );
    assert.equal(
      resolveSolqStartDate(
        { raw_sequifi_payload: {}, created_at: "" } as never,
        new Date("2026-07-30T12:00:00Z"),
      ),
      "2026-07-30",
    );

    const job = onboardingJob({
      phone: "555-111-2222",
      email: "jane.personal@example.com",
      raw_sequifi_payload: solqRaw,
    });
    const fields = buildSolqFormFields(job as never, new Date("2026-07-30T12:00:00Z"));
    assert.equal(fields.submitterName, "Nox Power Admin");
    assert.equal(fields.firstName, "Jane");
    assert.equal(fields.lastName, "Doe");
    assert.equal(fields.email, "jane.personal@example.com");
    assert.equal(fields.phone, "555-111-2222");
    assert.equal(fields.position, "Closer");
    assert.equal(fields.employmentType, "Full Time");
    assert.equal(fields.internalOrOutside, "Outside Org Rep");
    assert.equal(fields.outsideOrgName, "Solar Pros");
    assert.deepEqual(fields.markets, ["Iowa"]);
    assert.match(fields.notes, /Team: Alpha/);
    assert.match(fields.notes, /Manager: Pat Lee/);
    assert.equal(validateSolqFormFields(fields), null);
    assert.match(buildSolqNotes(job as never), /Office: Des Moines/);
  });

  test("builds the SolQ SOP text with Freedom Pros link tree URL", () => {
    env.solqLinksUrl = "https://solarquotespv.com/sq/tools/lt-freedompros.php";
    const message = buildSolqTextMessage();
    assert.match(message, /Hello! You have been onboarded for SolQ\./);
    assert.match(message, /https:\/\/solarquotespv\.com\/sq\/tools\/lt-freedompros\.php/);
    assert.match(message, /Thanks!$/);
  });
});

describe("Terros team resolution (POST /user/add now requires a team)", () => {
  // Mirrors the real catalog shape seen live: teams sometimes carry their own
  // "(Region)" suffix (Prosper), sometimes Sequifi's office_name does
  // instead (Scarface), and some team names collide outright (Drivin x3).
  const terrosUsers = [
    { userId: "U.1", memberOf: [{ teamId: "Team.1rCXqxgG", name: "Beast Coast (Abundance)" }] },
    { userId: "U.2", memberOf: [{ teamId: "Team.e4SgFcv3", name: "Scarface" }] },
    { userId: "U.3", memberOf: [{ teamId: "Team.d6YVAlHT", name: "Prosper (Mambas)" }] },
    { userId: "U.4", memberOf: [{ teamId: "Team.J2GVBUlK", name: "Drivin" }] },
    { userId: "U.5", memberOf: [{ teamId: "Team.WfKU5obc", name: "Drivin" }] },
    { userId: "U.6", memberOf: [] },
    { userId: "U.7" }, // no memberOf at all — must not throw
  ];

  test("canonicalizes team names by stripping a trailing (Region) suffix", () => {
    assert.equal(canonicalTeamKey("Beast Coast (Abundance)"), "beast coast");
    assert.equal(canonicalTeamKey("Scarface"), "scarface");
    assert.equal(canonicalTeamKey("  Prosper (Mambas)  "), "prosper");
  });

  test("builds a deduped {name -> teams} catalog from a raw Terros /user/list response", () => {
    const catalog = buildTerrosTeamCatalog(terrosUsers as never);
    assert.deepEqual(catalog.get("beast coast"), [
      { teamId: "Team.1rCXqxgG", teamName: "Beast Coast (Abundance)" },
    ]);
    assert.equal(catalog.get("drivin")?.length, 2);
  });

  test("matches when Sequifi's office_name suffix differs from Terros's own suffix", () => {
    const catalog = buildTerrosTeamCatalog(terrosUsers as never);

    const exact = matchTerrosTeamForOffice("Beast Coast (Abundance)", catalog);
    assert.deepEqual(exact, { ok: true, team: { teamId: "Team.1rCXqxgG", teamName: "Beast Coast (Abundance)" } });

    // Sequifi says "Scarface (Envision)"; Terros's team is plain "Scarface".
    const terrosHasNoSuffix = matchTerrosTeamForOffice("Scarface (Envision)", catalog);
    assert.deepEqual(terrosHasNoSuffix, { ok: true, team: { teamId: "Team.e4SgFcv3", teamName: "Scarface" } });

    // Sequifi office is only the region "Envision" — alias to Terros team Scarface.
    const regionOnly = matchTerrosTeamForOffice("Envision", catalog);
    assert.deepEqual(regionOnly, { ok: true, team: { teamId: "Team.e4SgFcv3", teamName: "Scarface" } });

    // Sequifi says plain "Prosper"; Terros's team is "Prosper (Mambas)".
    const sequifiHasNoSuffix = matchTerrosTeamForOffice("Prosper", catalog);
    assert.deepEqual(sequifiHasNoSuffix, { ok: true, team: { teamId: "Team.d6YVAlHT", teamName: "Prosper (Mambas)" } });
  });

  test("fails cleanly (never guesses) when a team name is ambiguous or missing", () => {
    const catalog = buildTerrosTeamCatalog(terrosUsers as never);

    const ambiguous = matchTerrosTeamForOffice("Drivin", catalog);
    assert.equal(ambiguous.ok, false);
    assert.match((ambiguous as { reason: string }).reason, /Ambiguous Terros team/);

    const missing = matchTerrosTeamForOffice("Nowhere (Made Up)", catalog);
    assert.equal(missing.ok, false);
    assert.match((missing as { reason: string }).reason, /No Terros team found/);

    const blank = matchTerrosTeamForOffice(null, catalog);
    assert.equal(blank.ok, false);
    assert.match((blank as { reason: string }).reason, /No Sequifi office_name/);
  });
});
