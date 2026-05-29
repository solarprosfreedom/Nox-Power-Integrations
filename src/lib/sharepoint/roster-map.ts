import type { SequifiUserRecord } from "@/lib/onboarding/types";
import type { ManualRosterRow, RosterBuildContext } from "@/lib/google-sheets/roster-map";
import { parseOfficeName } from "@/lib/google-sheets/roster-map";
import { auroraEmailFromName, buildWorkUpn } from "@/lib/onboarding/normalize";
import { parseSequifiFields } from "@/lib/onboarding/sequifi-fields";
import { env } from "@/lib/env";
import {
  rosterFieldsToSharePointRow,
  sharePointLayoutFromWorksheet,
  type SharePointRosterLayout,
} from "@/lib/sharepoint/tab-layout";
import type { RosterFieldValues } from "@/lib/google-sheets/tab-layout";

export type { ManualRosterRow, RosterBuildContext };

function workDomain(): string {
  return env.msDefaultDomain?.trim() || "noxpwr.com";
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
  const axiaNox = auroraEmailFromName(user.first_name, user.last_name);

  return {
    repName,
    phoneNumber: user.mobile_no?.trim() ?? "",
    personalEmail: user.email.trim(),
    workEmail: ctx?.workEmail?.trim() || "",
    noxEmail: ctx?.noxEmail?.trim() || (parsed.onboardAxia ? axiaNox : plainNox),
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

export function manualRosterRowToSharePointRow(
  row: ManualRosterRow,
  layout: SharePointRosterLayout,
): string[] {
  return rosterFieldsToSharePointRow(
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

export function sequifiUserToSharePointRow(
  user: SequifiUserRecord,
  worksheetName: string,
  ctx?: RosterBuildContext,
): string[] {
  const layout = sharePointLayoutFromWorksheet(worksheetName);
  return rosterFieldsToSharePointRow(buildRosterFieldValues(user, ctx), layout);
}
