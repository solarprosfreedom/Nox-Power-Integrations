import { buildWorkUpn } from "@/lib/onboarding/normalize";
import { parseSequifiFields } from "@/lib/onboarding/sequifi-fields";
import type { SequifiUserRecord } from "@/lib/onboarding/types";
import { env } from "@/lib/env";
import {
  rosterFieldsToSheetRow,
  type RosterFieldValues,
  type RosterTabLayout,
} from "@/lib/google-sheets/tab-layout";

export type { RosterTabLayout };

export interface ParsedOffice {
  division: string;
  region: string;
  team: string;
}

/** e.g. "Dictate (Envision)" → team Dictate, region Envision; "Drivin" → team only */
export function parseOfficeName(officeName: string | null | undefined): ParsedOffice {
  const name = officeName?.trim() ?? "";
  if (!name) return { division: "", region: "", team: "" };

  const paren = name.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (paren) {
    return {
      team: paren[1]!.trim(),
      region: paren[2]!.trim(),
      division: "",
    };
  }

  return { division: "", region: "", team: name };
}

function workDomain(): string {
  return env.msDefaultDomain?.trim() || "noxpwr.com";
}

export interface RosterBuildContext {
  workEmail?: string;
  /** Legacy single nox email override. */
  noxEmail?: string;
}

function buildRosterFieldValues(
  user: SequifiUserRecord,
  ctx?: RosterBuildContext,
): RosterFieldValues {
  const raw = user.raw ?? {};
  const parsed = parseSequifiFields(raw);
  const office = parseOfficeName(user.office_name);
  const repName = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  const plainNox = buildWorkUpn(user.first_name, user.last_name, workDomain());
  const workEmail = ctx?.workEmail?.trim() || "";
  const noxEmail = ctx?.noxEmail?.trim() || workEmail || plainNox;

  return {
    repName,
    phoneNumber: user.mobile_no?.trim() ?? "",
    personalEmail: user.email.trim(),
    workEmail,
    noxEmail,
    division: office.division,
    region: office.region,
    team: office.team,
    role: user.position_name?.trim() ?? "",
    market: parsed.markets,
    redline: "",
    overridingEntity1: "",
    overridingEntity2: "",
    overridingEntity3: "",
    addis: "",
    dob: "",
    caHis: parsed.caHis,
    issueDate: parsed.hisIssueDate,
    expDate: parsed.hisExpDate,
  };
}

/** Manual row from the UI test form. */
export interface ManualRosterRow {
  dealer: string;
  repId: string;
  repName: string;
  phoneNumber: string;
  personalEmail: string;
  workEmail: string;
  noxEmail: string;
  division: string;
  region: string;
  team: string;
  role: string;
  market: string;
  redline: string;
  overridingEntity1: string;
  overridingEntity2: string;
  overridingEntity3: string;
  addis: string;
  dob: string;
  caHis: string;
  issueDate: string;
  expDate: string;
}

export const EMPTY_MANUAL_ROSTER_ROW: ManualRosterRow = {
  dealer: "",
  repId: "",
  repName: "",
  phoneNumber: "",
  personalEmail: "",
  workEmail: "",
  noxEmail: "",
  division: "",
  region: "",
  team: "",
  role: "",
  market: "",
  redline: "",
  overridingEntity1: "",
  overridingEntity2: "",
  overridingEntity3: "",
  addis: "",
  dob: "",
  caHis: "",
  issueDate: "",
  expDate: "",
};

export const SAMPLE_MANUAL_ROSTER_ROW: ManualRosterRow = {
  dealer: "",
  repId: "noxpwr000075",
  repName: "Test Rep",
  phoneNumber: "555-0100",
  personalEmail: "test.rep@example.com",
  workEmail: "",
  noxEmail: "testrep@noxpwr.com",
  division: "",
  region: "Envision",
  team: "Dictate",
  role: "Sales Rep",
  market: "",
  redline: "",
  overridingEntity1: "",
  overridingEntity2: "",
  overridingEntity3: "",
  addis: "",
  dob: "",
  caHis: "",
  issueDate: "",
  expDate: "",
};

/** Ensure every field is a string (avoids uncontrolled → controlled input warnings). */
export function normalizeManualRosterRow(row: Partial<ManualRosterRow>): ManualRosterRow {
  return { ...EMPTY_MANUAL_ROSTER_ROW, ...row };
}

export function manualRosterRowToSheetRow(row: ManualRosterRow, layout: RosterTabLayout): string[] {
  return rosterFieldsToSheetRow(
    {
      repName: row.repName,
      phoneNumber: row.phoneNumber,
      personalEmail: row.personalEmail,
      workEmail: row.workEmail,
      noxEmail: row.noxEmail,
      division: row.division,
      region: row.region,
      team: row.team,
      role: row.role,
      market: row.market,
      redline: row.redline,
      overridingEntity1: row.overridingEntity1,
      overridingEntity2: row.overridingEntity2,
      overridingEntity3: row.overridingEntity3,
      addis: row.addis,
      dob: row.dob,
      caHis: row.caHis,
      issueDate: row.issueDate,
      expDate: row.expDate,
    },
    layout,
  );
}

export function sequifiUserToRosterRow(
  user: SequifiUserRecord,
  layout: RosterTabLayout,
  ctx?: RosterBuildContext,
): string[] {
  return rosterFieldsToSheetRow(buildRosterFieldValues(user, ctx), layout);
}
