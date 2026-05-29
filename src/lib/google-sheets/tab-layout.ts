export type RosterTabLayoutKind = "axia" | "standard" | "better_earth" | "owe";

export interface RosterTabLayout {
  kind: RosterTabLayoutKind;
  /** Range for append (e.g. A:S). */
  appendRange: string;
  /** Column letter used for dedup reads. */
  dedupColumn: string;
  /** Header row number (1-based). */
  headerRow: number;
  headers: readonly string[];
}

export const AXIA_HEADERS = [
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

export const STANDARD_HEADERS = [
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
  "DOB",
  "CA HIS",
  "Issue Date",
  "Exp Date",
] as const;

export const BETTER_EARTH_HEADERS = [
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

export const OWE_HEADERS = [
  "Onboarding Docs Sent Y/N",
  "Logins Provided",
  "Overrides Finalized Y/N",
  "Legal Name",
  "Personal Email",
  "Rep Email",
  "Rep Phone Number",
  "LR Setter M1 Amount",
  "LR Setter M2 Amount",
  "LR Setter M3 Amount",
  "LR Closer M1 Amount",
  "LR Closer M2 Amount",
  "LR Closer M3 Amount",
  "Market",
  "CA Closer",
  "Total Overrides",
  "Company",
  "Company Override",
  "Manager 1",
  "Manager 1 Override",
  "Manager 2",
  "Manager 2 Override",
  "Manager 3",
  "Manager 3 Override",
  "Manager 4",
  "Manager 4 Override",
  "Manager 5",
  "Manager 5 Override",
  "Manager 6",
  "Manager 6 Override",
  "Manager 7",
  "Manager 7 Override",
  "Manager 8",
  "Manager 8 Override",
  "CA HIS Number",
  "Issue Date",
  "Exp Date",
] as const;

function colLetter(count: number): string {
  let n = count;
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function appendRangeForHeaders(headers: readonly string[]): string {
  return `A:${colLetter(headers.length)}`;
}

export const AXIA_LAYOUT: RosterTabLayout = {
  kind: "axia",
  headers: AXIA_HEADERS,
  dedupColumn: "C",
  headerRow: 1,
  appendRange: appendRangeForHeaders(AXIA_HEADERS),
};

export const STANDARD_LAYOUT: RosterTabLayout = {
  kind: "standard",
  headers: STANDARD_HEADERS,
  dedupColumn: "C",
  headerRow: 1,
  appendRange: appendRangeForHeaders(STANDARD_HEADERS),
};

export const BETTER_EARTH_LAYOUT: RosterTabLayout = {
  kind: "better_earth",
  headers: BETTER_EARTH_HEADERS,
  dedupColumn: "C",
  headerRow: 1,
  appendRange: appendRangeForHeaders(BETTER_EARTH_HEADERS),
};

export const OWE_LAYOUT: RosterTabLayout = {
  kind: "owe",
  headers: OWE_HEADERS,
  dedupColumn: "F",
  headerRow: 3,
  appendRange: appendRangeForHeaders(OWE_HEADERS),
};

/** @deprecated use AXIA_HEADERS */
export const ROSTER_HEADERS = AXIA_HEADERS;

/** Known tab names → layout. */
export function rosterLayoutFromTabName(tabName: string): RosterTabLayout | null {
  const name = tabName.trim().toLowerCase();
  if (name === "axia" || name === "test sync") return AXIA_LAYOUT;
  if (name === "empwr" || name === "empower" || name === "goodpwr" || name === "ilum" || name === "tron") {
    return STANDARD_LAYOUT;
  }
  if (name === "better earth") return BETTER_EARTH_LAYOUT;
  if (name === "owe") return OWE_LAYOUT;
  return null;
}

export interface RosterFieldValues {
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

export function rosterFieldsToSheetRow(fields: RosterFieldValues, layout: RosterTabLayout): string[] {
  if (layout.kind === "owe") {
    return oweFieldsToSheetRow(fields);
  }

  const base = [
    fields.repName.trim(),
    fields.phoneNumber.trim(),
    fields.personalEmail.trim(),
    fields.workEmail.trim(),
  ];

  if (layout.kind === "better_earth") {
    return [
      ...base,
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

  const withNox = [...base, fields.noxEmail.trim()];

  const standardTail = [
    fields.division.trim(),
    fields.region.trim(),
    fields.team.trim(),
    fields.role.trim(),
    fields.market.trim(),
    fields.redline.trim(),
    fields.overridingEntity1.trim(),
    fields.overridingEntity2.trim(),
    fields.overridingEntity3.trim(),
  ];

  if (layout.kind === "axia") {
    return [
      ...withNox,
      ...standardTail,
      fields.addis.trim(),
      fields.dob.trim(),
      fields.caHis.trim(),
      fields.issueDate.trim(),
      fields.expDate.trim(),
    ];
  }

  return [
    ...withNox,
    ...standardTail,
    fields.dob.trim(),
    fields.caHis.trim(),
    fields.issueDate.trim(),
    fields.expDate.trim(),
  ];
}

function oweFieldsToSheetRow(fields: RosterFieldValues): string[] {
  const row = new Array(OWE_HEADERS.length).fill("");
  row[3] = fields.repName.trim();
  row[4] = "";
  row[5] = fields.personalEmail.trim();
  row[6] = fields.phoneNumber.trim();
  row[13] = fields.market.trim();
  row[34] = fields.caHis.trim();
  row[35] = fields.issueDate.trim();
  row[36] = fields.expDate.trim();
  return row;
}

export function headerRangeForLayout(tabName: string, layout: RosterTabLayout): string {
  const escaped = `'${tabName.replace(/'/g, "''")}'`;
  const end = colLetter(layout.headers.length);
  return `${escaped}!A${layout.headerRow}:${end}${layout.headerRow}`;
}
