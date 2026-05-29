import { buildWorkUpn } from "@/lib/onboarding/normalize";
import type { SequifiUserRecord } from "@/lib/onboarding/types";
import { env } from "@/lib/env";
import {
  LAZARUS_LAYOUT,
  rosterFieldsToSharePointRow,
  type SharePointRosterLayout,
} from "@/lib/sharepoint/tab-layout";
import type { ManualRosterRow } from "@/lib/google-sheets/roster-map";
import { parseOfficeName } from "@/lib/google-sheets/roster-map";

export type { ManualRosterRow };

function workDomain(): string {
  return env.msDefaultDomain?.trim() || "noxpwr.com";
}

export function manualRosterRowToSharePointRow(
  row: ManualRosterRow,
  layout: SharePointRosterLayout = LAZARUS_LAYOUT,
): string[] {
  return rosterFieldsToSharePointRow(
    {
      dealer: row.dealer,
      repId: row.repId,
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
  layout: SharePointRosterLayout = LAZARUS_LAYOUT,
): string[] {
  const office = parseOfficeName(user.office_name);
  const repName = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  const noxEmail = buildWorkUpn(user.first_name, user.last_name, workDomain());

  return rosterFieldsToSharePointRow(
    {
      dealer: "",
      repId: user.employee_id.trim(),
      repName,
      phoneNumber: user.mobile_no?.trim() ?? "",
      personalEmail: user.email.trim(),
      workEmail: "",
      noxEmail,
      division: office.division,
      region: office.region,
      team: office.team,
      role: user.position_name?.trim() ?? "",
      market: "",
      redline: "",
      overridingEntity1: "",
      overridingEntity2: "",
      overridingEntity3: "",
      dob: "",
      caHis: "",
      issueDate: "",
      expDate: "",
    },
    layout,
  );
}
