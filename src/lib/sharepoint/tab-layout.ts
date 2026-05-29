export interface SharePointRosterLayout {
  /** Worksheet tab name (e.g. LAZARUS). */
  worksheetName: string;
  /** Column range for append (A:S = 19 columns). */
  appendRange: "A:S";
  /** Column letter for Personal Email dedup reads. */
  personalEmailColumn: "E";
  hasDealerColumn: true;
  hasRepIdColumn: true;
  /** LAZARUS has Work Email but no separate Nox Email or Addis columns. */
  hasNoxEmailColumn: false;
  hasAddisColumn: false;
}

export const LAZARUS_ROSTER_HEADERS = [
  "Dealer",
  "Rep ID",
  "Rep Name",
  "Phone Number",
  "Personal Email",
  "Work Email",
  "Division",
  "Region",
  "Team",
  "Role",
  "Market",
  "Redline",
  "Overriding Entity 1",
  "Overriding Entity 2",
  "Overriding Entity 3",
  "DOB",
  "CA HIS",
  "Issue Date",
  "Exp Date",
] as const;

/** Column letter → header label for LAZARUS (A–S). */
export const LAZARUS_COLUMNS = LAZARUS_ROSTER_HEADERS.map((header, index) => ({
  column: String.fromCharCode(65 + index),
  header,
}));

export const LAZARUS_LAYOUT: SharePointRosterLayout = {
  worksheetName: "LAZARUS",
  appendRange: "A:S",
  personalEmailColumn: "E",
  hasDealerColumn: true,
  hasRepIdColumn: true,
  hasNoxEmailColumn: false,
  hasAddisColumn: false,
};

export function rosterFieldsToSharePointRow(
  fields: {
    dealer?: string;
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
    dob: string;
    caHis: string;
    issueDate: string;
    expDate: string;
  },
  layout: SharePointRosterLayout,
): string[] {
  const workEmail = fields.workEmail.trim() || fields.noxEmail.trim();

  return [
    (fields.dealer ?? "").trim(),
    fields.repId.trim(),
    fields.repName.trim(),
    fields.phoneNumber.trim(),
    fields.personalEmail.trim(),
    workEmail,
    fields.division.trim(),
    fields.region.trim(),
    fields.team.trim(),
    fields.role.trim(),
    fields.market.trim(),
    fields.redline.trim(),
    fields.overridingEntity1.trim(),
    fields.overridingEntity2.trim(),
    fields.overridingEntity3.trim(),
    fields.dob.trim(),
    fields.caHis.trim(),
    fields.issueDate.trim(),
    fields.expDate.trim(),
  ];
}
