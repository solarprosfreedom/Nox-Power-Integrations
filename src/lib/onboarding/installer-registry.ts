import type { RosterTabLayout } from "@/lib/google-sheets/tab-layout";
import { rosterLayoutFromTabName, STANDARD_LAYOUT } from "@/lib/google-sheets/tab-layout";
import { env } from "@/lib/env";

export interface InstallerDestination {
  tabName: string;
  layout: RosterTabLayout;
}

/** Known Sequifi installer tab → Enerflo email suffix (+suffix@noxpwr.com). */
const INSTALLER_SUFFIX_BY_TAB: Record<string, string> = {
  axia: "axia",
  tron: "tron",
  empwr: "empwr",
  "good pwr": "goodpwr",
  goodpwr: "goodpwr",
  "better earth": "betterearth",
};

export type InstallerTabName = string;

function workDomain(): string {
  return env.msDefaultDomain?.trim() || "noxpwr.com";
}

function localPartFromName(firstName: string, lastName: string): string {
  return `${firstName}${lastName}`.toLowerCase().replace(/[^a-z0-9]/g, "") || "user";
}

/** Slugify free-text installer names for the +suffix (e.g. "Some Co" → "someco"). */
export function slugifyInstallerSuffix(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
  return slug || "installer";
}

/** Resolve Enerflo +suffix from a roster / Sequifi installer tab name. */
export function installerEmailSuffix(tabName: string): string {
  const key = tabName.trim().toLowerCase();
  return INSTALLER_SUFFIX_BY_TAB[key] ?? slugifyInstallerSuffix(tabName);
}

/** @deprecated Use buildWorkUpn — one company email for Microsoft, Enerflo, and Terros. */
export function enerfloEmailForInstaller(
  firstName: string,
  lastName: string,
  tabName: string,
  domain = workDomain(),
): string {
  const suffix = installerEmailSuffix(tabName);
  return `${localPartFromName(firstName, lastName)}+${suffix}@${domain}`;
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
