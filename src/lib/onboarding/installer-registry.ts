import type { RosterTabLayout } from "@/lib/google-sheets/tab-layout";
import { rosterLayoutFromTabName, STANDARD_LAYOUT } from "@/lib/google-sheets/tab-layout";

export interface InstallerDestination {
  tabName: string;
  layout: RosterTabLayout;
}

const ROSTER_TAB_ALIASES: Record<string, string> = {
  ilum: "ILUM",
  illum: "ILUM",
};

const SHAREPOINT_ROSTER_TAB_ALIASES: Record<string, string> = {
  "quality solar": "Quality",
  "our world energy": "OWE",
};

export type InstallerTabName = string;

/** Resolve Google Sheets tab + layout for a Sequifi installer name. */
export function destinationForInstallerTab(tabName: string): InstallerDestination {
  const trimmed = tabName.trim();
  const canonical = ROSTER_TAB_ALIASES[trimmed.toLowerCase()] ?? trimmed;
  const layout = rosterLayoutFromTabName(canonical) ?? STANDARD_LAYOUT;
  return { tabName: canonical, layout };
}

/** Resolve installer names to the existing SharePoint workbook worksheet. */
export function sharePointWorksheetNameForInstallerTab(tabName: string): string {
  const canonical = destinationForInstallerTab(tabName).tabName;
  return SHAREPOINT_ROSTER_TAB_ALIASES[canonical.toLowerCase()] ?? canonical;
}

export function destinationsForInstallerTabs(tabNames: string[]): InstallerDestination[] {
  const out: InstallerDestination[] = [];
  const seen = new Set<string>();
  for (const name of tabNames) {
    const trimmed = name.trim();
    if (!trimmed) continue;
    const dest = destinationForInstallerTab(trimmed);
    const key = dest.tabName.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(dest);
  }
  return out;
}
