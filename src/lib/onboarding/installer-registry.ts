import type { RosterTabLayout } from "@/lib/google-sheets/tab-layout";
import { rosterLayoutFromTabName, STANDARD_LAYOUT } from "@/lib/google-sheets/tab-layout";

export interface InstallerDestination {
  tabName: string;
  layout: RosterTabLayout;
}

/** Resolve Google Sheets tab + layout for a Sequifi installer name. */
export function destinationForInstallerTab(tabName: string): InstallerDestination {
  const trimmed = tabName.trim();
  const layout = rosterLayoutFromTabName(trimmed) ?? STANDARD_LAYOUT;
  return { tabName: trimmed, layout };
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
