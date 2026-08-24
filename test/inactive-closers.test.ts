import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildInactiveCloserRows,
  closerRowsToCsv,
  inactiveCloserEmailHtml,
  manilaDateString,
} from "@/lib/inactive-closers/build-report";
import { inactiveCloserReportRecipients } from "@/lib/inactive-closers/recipients";
import { mergeCloserPeople } from "@/lib/inactive-closers/fetch";
import { INACTIVE_CLOSER_CSV_COLUMNS, type CloserPerson, type HubProject } from "@/lib/inactive-closers/types";

function person(overrides: Partial<CloserPerson> & Pick<CloserPerson, "name">): CloserPerson {
  return {
    id: 195,
    email: "closer@example.com",
    role: "Closer",
    source: "sequifi_inactive",
    deactivated: false,
    ...overrides,
  };
}

function project(overrides: Partial<HubProject> = {}): HubProject {
  return {
    projectId: "873191",
    projectName: "Gregory Farris",
    addressLine1: "1503 Tina Dr",
    city: "Murphysboro",
    state: "IL",
    zip: "62966",
    installer: "Tron",
    closerName: "Scott McCollester",
    closerEmail: "skmranchaz@gmail.com",
    setterName: "",
    setterEmail: "",
    salesAdvisorName: "",
    salesAdvisorEmail: "",
    sequifiPid: "873191",
    systemSizeKw: 11.25,
    remittance: { partner_commission: null, c0: null, total_sp_paid: null },
    ...overrides,
  };
}

test("Vercel cron emails inactive closer projects on Monday 11pm PHT", () => {
  const config = JSON.parse(readFileSync("vercel.json", "utf8")) as {
    crons: Array<{ path: string; schedule: string }>;
  };
  const schedule = new Map(config.crons.map(item => [item.path, item.schedule]));
  assert.equal(schedule.get("/api/cron/inactive-closer-report"), "0,10 15 * * 1");
  assert.notEqual(schedule.get("/api/cron/inactive-closer-report"), schedule.get("/api/cron/inactive-rep-report"));
});

test("closer report recipients are hardcoded to Sam and the shared inbox", () => {
  assert.deepEqual(inactiveCloserReportRecipients(), [
    "samjensen@noxpwr.com",
    "noxpwr@gmail.com",
  ]);
});

test("Manila date stays on the Monday of the 11pm PHT cron", () => {
  assert.equal(manilaDateString(new Date("2026-08-24T15:00:00.000Z")), "2026-08-24");
});

test("builds one project per closer line with a single installer", () => {
  const rows = buildInactiveCloserRows({
    people: [
      person({ id: 195, name: "Scott McCollester", email: "skmranchaz@gmail.com" }),
      person({ id: 25, name: "Daniel Larsen", email: "daniellarsen@noxpwr.com" }),
    ],
    projects: [
      project(),
      project({
        projectId: "18278145",
        projectName: "Sharon Russell",
        installer: "Empwr",
        closerName: "Daniel Larsen",
        closerEmail: "daniellarsen@noxpwr.com",
        sequifiPid: "18278145",
        remittance: { partner_commission: 100, c0: 60, total_sp_paid: 100 },
        systemSizeKw: 6.56,
      }),
    ],
    sales: [
      {
        pid: "873191",
        closerId: 195,
        closerName: "Scott McCollester",
        installPartner: "Tron",
        totalCommission: 0,
        kw: 11.25,
        customerAddress: "",
        customerState: "",
        customerZip: "",
      },
    ],
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.closer_name, "Daniel Larsen");
  assert.equal(rows[0]?.installer, "Empwr");
  assert.equal(rows[0]?.partner_commission, "100");
  assert.equal(rows[1]?.installer, "Tron");
  assert.equal(rows[1]?.address, "1503 Tina Dr, Murphysboro, IL, 62966");
  assert.doesNotMatch(rows[1]?.installer ?? "", /;/);
});

test("treats sales advisor as closer only when Hub closer fields are blank", () => {
  const rows = buildInactiveCloserRows({
    people: [person({ id: 272, name: "Joshua Wintle", email: "j.wintle47@gmail.com" })],
    projects: [
      project({
        projectId: "1003544",
        closerName: "",
        closerEmail: "",
        salesAdvisorName: "Joshua Wintle",
        salesAdvisorEmail: "joshuawintle+axia@noxpwr.com",
      }),
    ],
    sales: [],
  });
  assert.equal(rows[0]?.match_via, "hub_sales_advisor");
  assert.equal(rows[0]?.closer_name, "Joshua Wintle");
});

test("does not add deactivated setter-only people or test users", () => {
  const rows = buildInactiveCloserRows({
    people: [
      person({
        id: null,
        name: "Dominic Potter",
        email: "dominicpotter@noxpwr.com",
        role: "agent, setter",
        source: "deactivated_accounts",
        deactivated: true,
      }),
      person({
        id: null,
        name: "Test User - Sales Rep",
        email: "yolo@yahoo.com",
        source: "deactivated_accounts",
        deactivated: true,
      }),
    ],
    projects: [
      project({
        projectId: "917167",
        closerName: "Dominic Potter",
        closerEmail: "dominicpotter@noxpwr.com",
      }),
      project({
        projectId: "2982808",
        closerName: "Test User - Sales Rep",
        closerEmail: "yolo@yahoo.com",
      }),
    ],
    sales: [],
  });
  assert.equal(rows.length, 0);
});

test("CSV keeps project-first column order", () => {
  const csv = closerRowsToCsv([
    {
      project_id: "873191",
      project_name: "Gregory Farris",
      address: "1503 Tina Dr, Murphysboro, IL, 62966",
      installer: "Tron",
      closer_name: "Scott McCollester",
      closer_email: "skmranchaz@gmail.com",
      partner_commission: "",
      partner_incentive: "",
      spif: "",
      c0: "",
      c1: "",
      c2: "",
      adjusted_c2: "",
      c0_paid: "",
      c1_paid: "",
      c2_paid: "",
      incentive_paid: "",
      clawback: "",
      others: "",
      total_sp_paid: "",
      sequifi_total_commission: "0",
      system_size_kw: "11.25",
      match_via: "sequifi_closer",
    },
  ]);
  assert.equal(csv.split("\n")[0], INACTIVE_CLOSER_CSV_COLUMNS.join(","));
  assert.match(csv, /^project_id,project_name,address,installer,closer_name,closer_email,/);
});

test("email body describes closer projects, not account deactivation", () => {
  const html = inactiveCloserEmailHtml({
    reportDate: "2026-08-24",
    rows: [
      {
        project_id: "873191",
        project_name: "Gregory Farris",
        address: "1503 Tina Dr",
        installer: "Tron",
        closer_name: "Scott McCollester",
        closer_email: "skmranchaz@gmail.com",
        partner_commission: "",
        partner_incentive: "",
        spif: "",
        c0: "",
        c1: "",
        c2: "",
        adjusted_c2: "",
        c0_paid: "",
        c1_paid: "",
        c2_paid: "",
        incentive_paid: "",
        clawback: "",
        others: "",
        total_sp_paid: "",
        sequifi_total_commission: "",
        system_size_kw: "11.25",
        match_via: "sequifi_closer",
      },
    ],
  });
  assert.match(html, /inactive closers and the projects tied to them/i);
  assert.match(html, /not the daily inactive-rep account deactivation report/i);
  assert.match(html, /Scott McCollester — 1/);
});

test("merge prefers Sequifi-inactive identity and marks deactivated overlap", () => {
  const merged = mergeCloserPeople(
    [person({ name: "Kenneth Mercado Torres", email: "kennethtorresmercado@noxpwr.com" })],
    [
      person({
        id: 170,
        name: "Kenneth Mercado Torres",
        email: "kennethtorresmercado@noxpwr.com",
        role: "Sales Rep / Closer",
        source: "deactivated_accounts",
        deactivated: true,
      }),
    ],
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.source, "sequifi_inactive");
  assert.equal(merged[0]?.deactivated, true);
});
