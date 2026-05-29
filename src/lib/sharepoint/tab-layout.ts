import {
  rosterFieldsToSheetRow,
  rosterLayoutFromTabName,
  STANDARD_LAYOUT,
  type RosterFieldValues,
  type RosterTabLayout,
} from "@/lib/google-sheets/tab-layout";

export type SharePointRosterLayout = RosterTabLayout;

export function sharePointLayoutFromWorksheet(worksheetName: string): RosterTabLayout {
  return rosterLayoutFromTabName(worksheetName) ?? STANDARD_LAYOUT;
}

export function rosterFieldsToSharePointRow(
  fields: RosterFieldValues,
  layout: RosterTabLayout,
): string[] {
  return rosterFieldsToSheetRow(fields, layout);
}

/** @deprecated LAZARUS test layout — use sharePointLayoutFromWorksheet for production tabs. */
export const LAZARUS_LAYOUT = STANDARD_LAYOUT;

export const LAZARUS_ROSTER_HEADERS = STANDARD_LAYOUT.headers;

export const LAZARUS_COLUMNS = STANDARD_LAYOUT.headers.map((header, index) => ({
  column: String.fromCharCode(65 + index),
  header,
}));
