import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildCandidateCsv,
  buildInactiveRepCandidates,
  evaluateAccountActivity,
} from "@/lib/inactive-reps/evaluate";
import { buildIdentityKey, fuzzyNameScore, matchSaleAttribution } from "@/lib/inactive-reps/identity";
import { inactiveRepReportRecipients } from "@/lib/inactive-reps/recipients";
import {
  inactiveRepDeactivationDueBefore,
  INACTIVE_REP_DEACTIVATION_DELAY_HOURS,
  phoenixDateString,
} from "@/lib/inactive-reps/orchestrator";
import type { InactiveRepSourceSnapshot, SourceAccount } from "@/lib/inactive-reps/sources";
import type { SequifiUserRecord } from "@/lib/onboarding/types";

const now = new Date("2026-08-14T15:00:00.000Z");
const cutoff = new Date("2026-07-15T15:00:00.000Z");

function sequifi(options: {
  id: number;
  name: string;
  email: string;
  role?: string;
  status?: number;
  manager?: boolean;
}): SequifiUserRecord {
  const [first_name, ...last] = options.name.split(" ");
  return {
    id: options.id,
    employee_id: String(options.id),
    first_name,
    last_name: last.join(" "),
    email: options.email,
    position_name: "Sales Rep",
    sub_position_name: options.role ?? "Closer",
    status_id: options.status ?? 1,
    raw: { is_manager: options.manager ?? false },
  };
}

function account(options: Partial<SourceAccount> & Pick<SourceAccount, "platform" | "id" | "email">): SourceAccount {
  return {
    name: options.email,
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    lastLoginAt: null,
    roles: [],
    isAdmin: false,
    evidenceSource: "test",
    ...options,
  };
}

function sourceSnapshot(): InactiveRepSourceSnapshot {
  const sequifiUsers = [
    sequifi({ id: 1, name: "Alice Active", email: "aliceactive@noxpwr.com" }),
    sequifi({ id: 2, name: "Bob Inactive", email: "bobinactive@noxpwr.com" }),
    sequifi({ id: 3, name: "Carol Schroeder", email: "carolschroeder@noxpwr.com" }),
    sequifi({ id: 4, name: "Krista Admin", email: "kristaadmin@noxpwr.com", role: "Administrator" }),
    sequifi({ id: 5, name: "Terry Unknown", email: "terryunknown@noxpwr.com" }),
  ];
  return {
    sequifiUsers,
    accounts: {
      enerflo: [
        account({ platform: "enerflo", id: "ef-alice", email: "aliceactive@noxpwr.com" }),
        account({ platform: "enerflo", id: "ef-bob", email: "bobinactive@noxpwr.com" }),
        account({ platform: "enerflo", id: "ef-carol", email: "carolschroeder@noxpwr.com" }),
        account({ platform: "enerflo", id: "ef-krista", email: "kristaadmin@noxpwr.com" }),
      ],
      microsoft: [
        account({
          platform: "microsoft",
          id: "ms-alice",
          email: "aliceactive@noxpwr.com",
          lastLoginAt: "2026-08-10T00:00:00.000Z",
        }),
        account({ platform: "microsoft", id: "ms-bob", email: "bobinactive@noxpwr.com" }),
        account({ platform: "microsoft", id: "ms-carol", email: "carolschroeder@noxpwr.com" }),
      ],
      terros: [
        account({
          platform: "terros",
          id: "tr-terry",
          email: "terryunknown@noxpwr.com",
          createdAt: null,
          lastLoginAt: null,
          roles: ["Closer_Only"],
        }),
      ],
    },
    salesFeeds: [
      {
        installer: "axia",
        table: "axia_imports",
        primaryKey: "id",
        rows: [
          {
            project: { contract_signed_date: "2026-08-01", setter_name: "Carol Shoeder" },
            raw: {},
          },
        ],
      },
    ],
    sourceSummary: {
      sequifiUsers: sequifiUsers.length,
      enerfloRestUsers: 4,
      enerfloGraphqlUsers: 4,
      microsoftUsers: 3,
      terrosUsers: 1,
      salesRows: { axia: 1 },
    },
  };
}

test("Phoenix date uses Arizona wall-clock time", () => {
  assert.equal(phoenixDateString(new Date("2026-08-15T06:30:00.000Z")), "2026-08-14");
  assert.equal(phoenixDateString(new Date("2026-08-15T15:00:00.000Z")), "2026-08-15");
});

test("deactivation batches become due after 23 hours", () => {
  assert.equal(INACTIVE_REP_DEACTIVATION_DELAY_HOURS, 23);
  assert.equal(
    inactiveRepDeactivationDueBefore(new Date("2026-08-15T14:15:00.000Z")).toISOString(),
    "2026-08-14T15:15:00.000Z",
  );
});

test("Vercel cron runs deactivation, preparation, and delivery on Phoenix weekdays", () => {
  const config = JSON.parse(readFileSync("vercel.json", "utf8")) as {
    crons: Array<{ path: string; schedule: string }>;
  };
  const schedule = new Map(config.crons.map(item => [item.path, item.schedule]));
  assert.equal(schedule.get("/api/cron/inactive-rep-deactivation"), "0,15,30 14 * * 1-5");
  assert.equal(schedule.get("/api/cron/inactive-rep-report-prepare"), "45 14 * * 1-5");
  assert.equal(schedule.get("/api/cron/inactive-rep-report"), "0,5,10,20 15 * * 1-5");
});

test("no-login history requires an account older than 30 days", () => {
  assert.equal(
    evaluateAccountActivity(account({ platform: "enerflo", id: "1", email: "a@example.com" }), cutoff).activityState,
    "inactive",
  );
  assert.equal(
    evaluateAccountActivity(
      account({
        platform: "enerflo",
        id: "2",
        email: "b@example.com",
        createdAt: "2026-08-01T00:00:00.000Z",
      }),
      cutoff,
    ).activityState,
    "recent",
  );
  assert.equal(
    evaluateAccountActivity(
      account({ platform: "terros", id: "3", email: "c@example.com", createdAt: null }),
      cutoff,
    ).activityState,
    "unknown",
  );
});

test("safe fuzzy attribution recognizes a unique last-name typo", () => {
  assert.ok(fuzzyNameScore("Carol Shoeder", "Carol Schroeder"));
  const identityKey = buildIdentityKey();
  const result = matchSaleAttribution(
    [],
    [{ value: "Carol Shoeder", path: "project.setter_name" }],
    [
      {
        identityKey: identityKey("carolschroeder@noxpwr.com"),
        identityEmail: "carolschroeder@noxpwr.com",
        name: "Carol Schroeder",
      },
    ],
    identityKey,
  );
  assert.equal(result.matches.get("carolschroeder@noxpwr.com")?.method, "fuzzy_unique_best_name");
  assert.equal(result.ambiguousIdentityKeys.size, 0);
});

test("inactive-rep reports include and deduplicate additional recipients", () => {
  assert.deepEqual(
    inactiveRepReportRecipients(
      "noxpwr@gmail.com",
      "admin@noxpwr.com, NOXPWR@gmail.com;admin@noxpwr.com",
    ),
    ["noxpwr@gmail.com", "admin@noxpwr.com"],
  );
});

test("candidate criteria use AND across logins, exclude admins, unknown evidence, and recent sales", () => {
  const result = buildInactiveRepCandidates(sourceSnapshot(), now);
  assert.deepEqual(result.candidates.map(candidate => candidate.name), ["Bob Inactive"]);
  assert.equal(result.candidates[0]?.targets.length, 2);
  assert.equal(result.exclusions["recent platform login or new-account grace period"], 1);
  assert.equal(result.exclusions["sales activity within the last 30 days"], 1);
  assert.equal(result.exclusions["Sequifi non-rep, inactive, admin, or manager"], 1);
  assert.equal(result.exclusions["missing or conflicting platform activity evidence"], 1);
});

test("CSV uses one row per representative with separate platform account fields", () => {
  const result = buildInactiveRepCandidates(sourceSnapshot(), now);
  const csv = buildCandidateCsv(result.candidates);
  const lines = csv.trimEnd().split("\n");
  assert.equal(lines.length, result.candidates.length + 1);
  assert.match(csv, /account_email,microsoft_email,microsoft_account_id/);
  assert.match(csv, /terros_email,terros_account_id/);
  assert.match(csv, /enerflo_email,enerflo_account_id/);
  assert.match(csv, /reason_for_deactivation/);
  assert.match(csv, /bobinactive@noxpwr\.com/);
  assert.match(csv, /ef-bob/);
  assert.match(csv, /ms-bob/);
});
