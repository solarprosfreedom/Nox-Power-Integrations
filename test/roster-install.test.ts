import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { env } from "../src/lib/env";
import {
  INSTALL_SHEET_HEADERS,
  type InstallSheetHeader,
} from "../src/lib/install-sheet/headers";
import {
  buildLeadInstallPayload,
  buildTestRowValues,
  validateInstallSheetRow,
} from "../src/lib/install-sheet/map-row";
import {
  AXIA_LAYOUT,
  OWE_LAYOUT,
  headerRangeForLayout,
  rosterFieldsToSheetRow,
  rosterLayoutFromTabName,
} from "../src/lib/google-sheets/tab-layout";
import {
  SAMPLE_MANUAL_ROSTER_ROW,
  manualRosterRowToSheetRow,
  normalizeManualRosterRow,
  parseOfficeName,
  sequifiUserToRosterRow,
} from "../src/lib/google-sheets/roster-map";
import {
  accountDisplayName,
  groupAccountsByStage,
  historyNeedsLeaderboardFix,
  parseLeaderboardFixCsv,
  rewriteWorkflowHistory,
} from "../src/lib/terros/leaderboard-fix";

function installValues(overrides: Partial<Record<InstallSheetHeader, string>> = {}) {
  const base = Object.fromEntries(INSTALL_SHEET_HEADERS.map((header) => [header, ""])) as Record<
    InstallSheetHeader,
    string
  >;
  return {
    ...base,
    Assign_To_Email: "rep@noxpwr.com",
    Customer_First_Name: "Jane",
    Customer_Last_Name: "Doe",
    Customer_Email: "jane@example.com",
    Customer_Mobile: "9497352136",
    Customer_Address: "123 Main",
    Customer_City: "Austin",
    Customer_State: "tx",
    Customer_Zip: "78701",
    Complete_Previous_Milestones: "yes",
    System_Cost: "20000",
    System_Size: "8.1",
    Date_Signed: "2026-01-01",
    Install_Integration_ID: "install-1",
    Customer_Integration_ID: "customer-1",
    ...overrides,
  };
}

describe("install sheet row mapping", () => {
  test("validates required columns and state format", () => {
    assert.deepEqual(validateInstallSheetRow({ values: installValues() }), []);
    assert.deepEqual(validateInstallSheetRow({ values: installValues({ Customer_State: "Texas" }) }), [
      "Customer_State must be a 2-letter state code (e.g. TX)",
    ]);
    assert.ok(validateInstallSheetRow({ values: installValues({ Customer_Email: "" }) }).includes("Missing Customer_Email"));
  });

  test("builds Enerflo lead install payloads from sheet rows", () => {
    env.enerfloSurveyTypeId = "survey-123";
    env.installSheetAssignToEmail = "imports@noxpwr.com";

    const payload = buildLeadInstallPayload({ values: installValues() });
    assert.equal(payload.survey_type_id, "survey-123");
    assert.equal(payload.assign_to_email, "imports@noxpwr.com");
    assert.equal(payload.state, "TX");
    assert.equal(payload.complete_previous_milestones, true);
    assert.equal(payload.install_integration_record_type, "GoogleSheets");
    assert.equal(payload.customer_integration_record_type, "GoogleSheets");
  });

  test("builds a complete generated test row", () => {
    const row = buildTestRowValues();
    assert.equal(row.length, INSTALL_SHEET_HEADERS.length);
    assert.ok(row[INSTALL_SHEET_HEADERS.indexOf("Customer_Email")].startsWith("axia-test-"));
  });
});

describe("Google Sheets roster mapping", () => {
  test("resolves roster layouts and header ranges", () => {
    assert.equal(rosterLayoutFromTabName("Axia")?.kind, "axia");
    assert.equal(rosterLayoutFromTabName("Tron")?.kind, "standard");
    assert.equal(rosterLayoutFromTabName("Better Earth")?.kind, "better_earth");
    assert.equal(rosterLayoutFromTabName("OWE")?.kind, "owe");
    assert.equal(rosterLayoutFromTabName("Unknown"), null);
    assert.equal(headerRangeForLayout("Bob's Team", AXIA_LAYOUT), "'Bob''s Team'!A1:S1");
  });

  test("maps office names and manual rows", () => {
    assert.deepEqual(parseOfficeName("Dictate (Envision)"), {
      division: "",
      region: "Envision",
      team: "Dictate",
    });
    assert.deepEqual(parseOfficeName("Drivin"), { division: "", region: "", team: "Drivin" });
    assert.deepEqual(normalizeManualRosterRow({ repName: "Jane Doe" }).repName, "Jane Doe");

    const row = manualRosterRowToSheetRow(SAMPLE_MANUAL_ROSTER_ROW, AXIA_LAYOUT);
    assert.equal(row[0], "Test Rep");
    assert.equal(row[2], "test.rep@example.com");
    assert.equal(row[4], "testrep@noxpwr.com");
  });

  test("maps Sequifi users to installer roster rows", () => {
    const row = sequifiUserToRosterRow(
      {
        id: 1,
        employee_id: "E1",
        first_name: "Jane",
        last_name: "Doe",
        email: "personal@example.com",
        mobile_no: "555-0100",
        position_name: "Sales Rep",
        sub_position_name: null,
        office_name: "Dictate (Envision)",
        worker_type: null,
        status_id: null,
        onboarding_complete: 1,
        created_at: null,
        updated_at: null,
        raw: {
          employee_admin_only_fields: [{ field_name: "HIS License Number", value: "HIS-123" }],
          employee_personal_detail: [],
          state_code: "AZ",
        },
      },
      AXIA_LAYOUT,
      { workEmail: "jane@noxpwr.com" },
    );
    assert.equal(row[0], "Jane Doe");
    assert.equal(row[2], "personal@example.com");
    assert.equal(row[3], "jane@noxpwr.com");
    assert.equal(row[6], "Envision");
    assert.equal(row[7], "Dictate");
    assert.equal(row[16], "HIS-123");
  });

  test("maps OWE rows into fixed column positions", () => {
    const row = rosterFieldsToSheetRow(
      {
        repName: "Jane Doe",
        phoneNumber: "555-0100",
        personalEmail: "personal@example.com",
        workEmail: "jane@noxpwr.com",
        noxEmail: "jane@noxpwr.com",
        division: "",
        region: "",
        team: "",
        role: "Sales Rep",
        market: "CA",
        redline: "",
        overridingEntity1: "",
        overridingEntity2: "",
        overridingEntity3: "",
        addis: "",
        dob: "",
        caHis: "HIS-123",
        issueDate: "2026-01-01",
        expDate: "2027-01-01",
      },
      OWE_LAYOUT,
    );
    assert.equal(row.length, OWE_LAYOUT.headers.length);
    assert.equal(row[3], "Jane Doe");
    assert.equal(row[5], "personal@example.com");
    assert.equal(row[13], "CA");
    assert.equal(row[34], "HIS-123");
  });
});

describe("Terros leaderboard fix helpers", () => {
  test("parses CSV rows with quoted JSON snapshots", () => {
    const snapshot = JSON.stringify({
      workflowHistory: [
        { userId: "source", stageId: "Stage.closed" },
        { userId: "owner-1", stageId: "Stage.knock" },
      ],
    }).replace(/"/g, '""');
    const csv = [
      "accountId,ownerId,workflowStageId,residentFirstName,residentLastName,line1,locality,snapshot",
      `Account.1,owner-1,Stage.closed,Jane,Doe,123 Main,Austin,"${snapshot}"`,
      `Account.2,source,Stage.closed,Skip,Me,456 Main,Austin,"${snapshot}"`,
    ].join("\n");

    const rows = parseLeaderboardFixCsv(csv, "source");
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.accountId, "Account.1");
    assert.equal(rows[0]?.jonasEntryCount, 1);
    assert.equal(accountDisplayName(rows[0]!), "Jane Doe");
  });

  test("groups, rewrites, and detects workflow history fixes", () => {
    const history = [{ userId: "source" }, { userId: "other" }];
    assert.equal(historyNeedsLeaderboardFix(history, "source"), true);
    assert.deepEqual(rewriteWorkflowHistory(history, "source", "target"), [
      { userId: "target" },
      { userId: "other" },
    ]);

    const groups = groupAccountsByStage(
      [
        {
          accountId: "Account.1",
          ownerId: "owner",
          workflowStageId: "Stage.knock",
          residentFirstName: "A",
          residentLastName: "Zulu",
          line1: "",
          locality: "",
          workflowHistory: [],
          jonasEntryCount: 1,
        },
        {
          accountId: "Account.2",
          ownerId: "owner",
          workflowStageId: "Stage.closed",
          residentFirstName: "B",
          residentLastName: "Alpha",
          line1: "",
          locality: "",
          workflowHistory: [],
          jonasEntryCount: 1,
        },
      ],
      { "Stage.closed": "Closed", "Stage.knock": "Knock" },
    );
    assert.equal(groups[0]?.stageId, "Stage.closed");
    assert.equal(groups[1]?.stageId, "Stage.knock");
  });
});
