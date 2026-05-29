export type RosterTabLayoutKind = "axia" | "empwr";

export interface RosterTabLayout {
  kind: RosterTabLayoutKind;
  /** Range for append/update (e.g. A:T or B:T). */
  appendRange: string;
  /** Column letter for Personal Email dedup reads. */
  personalEmailColumn: "D";
  hasRepIdColumn: boolean;
}

export const EMPWR_ROSTER_HEADERS = [
  "Rep ID",
  "Rep Name",
  "Phone Number",
  "Personal Email",
  "Work Email",
  "Nox Email",
  "Division",
  "Region",
  "Team",
  "Role",
  "Market",
  "Redline",
  "Overriding Entity 1",
  "Overriding Entity 2",
  "Overriding Entity 3",
  "Addis",
  "DOB",
  "CA HIS",
  "Issue Date",
  "Exp Date",
] as const;

export const EMPWR_LAYOUT: RosterTabLayout = {
  kind: "empwr",
  appendRange: "A:T",
  personalEmailColumn: "D",
  hasRepIdColumn: true,
};

export const AXIA_LAYOUT: RosterTabLayout = {
  kind: "axia",
  appendRange: "B:T",
  personalEmailColumn: "D",
  hasRepIdColumn: false,
};

/** Known tab names → layout (EMPWR has Rep ID in column A; Axia leaves A blank). */
export function rosterLayoutFromTabName(tabName: string): RosterTabLayout | null {
  const name = tabName.trim().toLowerCase();
  if (name === "empwr" || name === "empower") return EMPWR_LAYOUT;
  if (name === "axia" || name === "test sync") return AXIA_LAYOUT;
  return null;
}

export function rosterFieldsToSheetRow(
  fields: {
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
  },
  layout: RosterTabLayout,
): string[] {
  const core = [
    fields.repName.trim(),
    fields.phoneNumber.trim(),
    fields.personalEmail.trim(),
    fields.workEmail.trim(),
    fields.noxEmail.trim(),
    fields.division.trim(),
    fields.region.trim(),
    fields.team.trim(),
    fields.role.trim(),
    fields.market.trim(),
    fields.redline.trim(),
    fields.overridingEntity1.trim(),
    fields.overridingEntity2.trim(),
    fields.overridingEntity3.trim(),
    fields.addis.trim(),
    fields.dob.trim(),
    fields.caHis.trim(),
    fields.issueDate.trim(),
    fields.expDate.trim(),
  ];
  if (layout.hasRepIdColumn) {
    return [fields.repId.trim(), ...core];
  }
  return core;
}
