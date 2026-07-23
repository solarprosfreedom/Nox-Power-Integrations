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
    const sales = renderWelcomeTemplate("sales_rep", {
      firstName: "Jane",
      username: "jane@noxpwr.com",
      password: "Secret123",
      installerTabs: ["Axia", "EMPWR"],
      onboardAxia: true,
    });
    assert.equal(sales.subject, "Welcome to Axia — your Nox Power email");
    assert.match(sales.body, /Hello Jane,/);
    assert.match(sales.body, /Axia, EMPWR/);
    assert.match(sales.body, /Planner tips:/);

    const setter = renderWelcomeTemplate("appt_setter", {
      username: "setter@noxpwr.com",
      password: "Secret123",
    });
    assert.equal(setter.subject, "Welcome — your Nox Power email");
    assert.doesNotMatch(setter.body, /Planner tips:/);
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
    assert.equal(resolveDob({ raw_sequifi_payload: { dob: null } } as never), null);
    assert.equal(resolveDob({ raw_sequifi_payload: { dob: "not-a-date" } } as never), null);
    assert.equal(resolveDob({ raw_sequifi_payload: {} } as never), null);
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

describe("GoodPWR Google Form submission and text message", () => {
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

  test("Preferred Lender/TPO have no source in Sequifi today, but pick up a custom field if one is added later", () => {
    assert.equal(resolveGoodPwrLender({ raw_sequifi_payload: goodPwrRaw } as never), "");
    assert.equal(resolveGoodPwrTpo({ raw_sequifi_payload: goodPwrRaw } as never), "");

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

  test("builds GoodPWR form fields (static SOP values) and the urlencoded submission body", () => {
    env.msDefaultDomain = "noxpwr.com";
    const job = onboardingJob({
      phone: "555-111-2222",
      microsoft_upn: "janedoe@noxpwr.com",
      raw_sequifi_payload: {
        ...goodPwrRaw,
        employee_personal_detail: [
          { field_name: "Preferred Lender", value: "GoodLeap" },
          { field_name: "Preferred TPO", value: "SunRun" },
        ],
      },
    });

    const fields = buildGoodPwrFormFields(job as never);
    assert.equal(fields.firstName, "Jane");
    assert.equal(fields.lastName, "Doe");
    assert.equal(fields.email, "janedoe@noxpwr.com");
    assert.equal(fields.phone, "555-111-2222");
    assert.equal(fields.salesOrganization, "Solar Pros");
    assert.deepEqual(fields.markets, ["New York", "Oregon", "Illinois"]);
    assert.equal(fields.hisLicense, "Not selling in these markets");
    assert.equal(fields.usingEnerflo, "Yes");
    assert.equal(fields.preferredLender, "GoodLeap");
    assert.equal(fields.preferredTpo, "SunRun");
    assert.equal(fields.comments, "");

    const body = buildGoodPwrFormBody(fields);
    assert.equal(body.get("entry.897722329"), "Jane");
    assert.equal(body.get("entry.1646665289"), "Doe");
    assert.equal(body.get("entry.219209550"), "janedoe@noxpwr.com");
    assert.equal(body.get("entry.41757151"), "555-111-2222");
    assert.equal(body.get("entry.1235168892"), "Solar Pros");
    assert.deepEqual(body.getAll("entry.1790700221"), ["New York", "Oregon", "Illinois"]);
    assert.equal(body.get("entry.1717147781"), "Not selling in these markets");
    assert.equal(body.get("entry.1551533457"), "Yes");
    assert.equal(body.get("entry.1667807314"), "GoodLeap");
    assert.equal(body.get("entry.879013296"), "SunRun");
  });

  test("builds the exact GoodPWR SOP text message with the links URL", () => {
    env.goodPwrLinksUrl = "https://sites.google.com/goodpwr.com/goodpwr/sales-partners";
    const message = buildGoodPwrTextMessage();
    assert.match(message, /Hello! You have been onboarded for GoodPWR\./);
    assert.match(message, /https:\/\/sites\.google\.com\/goodpwr\.com\/goodpwr\/sales-partners/);
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
