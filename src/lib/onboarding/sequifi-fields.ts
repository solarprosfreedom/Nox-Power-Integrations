export interface SequifiCustomField {
  id?: number;
  field_name?: string;
  field_type?: string;
  value?: string | null;
}

export interface ParsedSequifiFields {
  onboardAxia: boolean;
  installerTabs: string[];
  markets: string;
  caHis: string;
  hisIssueDate: string;
  hisExpDate: string;
}

function readFieldArray(raw: Record<string, unknown>, key: string): SequifiCustomField[] {
  const value = raw[key];
  return Array.isArray(value) ? (value as SequifiCustomField[]) : [];
}

export function getSequifiFieldValue(
  raw: Record<string, unknown>,
  fieldName: string,
): string {
  const arrays = [
    ...readFieldArray(raw, "employee_admin_only_fields"),
    ...readFieldArray(raw, "employee_personal_detail"),
  ];
  const match = arrays.find(
    f => String(f.field_name ?? "").trim().toLowerCase() === fieldName.trim().toLowerCase(),
  );
  return String(match?.value ?? "").trim();
}

export function isSequifiYes(value: string | null | undefined): boolean {
  return String(value ?? "").trim().toLowerCase() === "yes";
}

/**
 * Sequifi has, at least once (Axia, around 2026-07-17), silently renamed a
 * custom-field question's label — the short "Onboard to Axia?" became
 * "Please select which installer(s) the user needs to be onboarded to.
 * Must select at least one. Would you like to onboard the user to Axia?"
 * An exact-match lookup on the old label then silently drops the answer
 * for anyone whose form rendered the new one (confirmed: 4 real reps had
 * their "Yes" answer invisible to us this way).
 *
 * To survive future relabels without needing a code change every time,
 * fall back to a fuzzy match: any admin-only dropdown field whose name
 * contains "onboard" plus every word of the installer's name (e.g. both
 * "good" and "pwr" for "Good Pwr") is treated as that installer's
 * question, regardless of the exact surrounding sentence.
 */
function getSequifiInstallerFieldValue(raw: Record<string, unknown>, installerName: string): string {
  const exact = getSequifiFieldValue(raw, `Onboard to ${installerName}?`);
  if (exact) return exact;

  const words = installerName.toLowerCase().split(/\s+/).filter(Boolean);
  const fields = readFieldArray(raw, "employee_admin_only_fields");
  const fuzzy = fields.find(f => {
    const name = String(f.field_name ?? "").toLowerCase();
    return name.includes("onboard") && words.every(word => name.includes(word));
  });
  return String(fuzzy?.value ?? "").trim();
}

const INSTALLER_DROPDOWNS: { installerName: string; tabName: string }[] = [
  { installerName: "Axia", tabName: "Axia" },
  { installerName: "Empwr", tabName: "EMPWR" },
  { installerName: "Good Pwr", tabName: "GoodPWR" },
  { installerName: "Tron", tabName: "Tron" },
  { installerName: "Better Earth", tabName: "Better Earth" },
];

export function parseSequifiFields(raw: Record<string, unknown>): ParsedSequifiFields {
  const installerTabs: string[] = [];

  for (const { installerName, tabName } of INSTALLER_DROPDOWNS) {
    if (isSequifiYes(getSequifiInstallerFieldValue(raw, installerName))) {
      installerTabs.push(tabName);
    }
  }

  const otherInstallers = getSequifiFieldValue(raw, "Other Installers?");
  if (otherInstallers) {
    for (const part of otherInstallers.split(/[,;/]+/)) {
      const tab = part.trim();
      if (tab) installerTabs.push(tab);
    }
  }

  const markets =
    getSequifiFieldValue(raw, "Please provide the market(s) you will be working in?") ||
    String(raw.state_code ?? "").trim();

  const caHis =
    getSequifiFieldValue(raw, "HIS License Number") ||
    getSequifiFieldValue(raw, "CA HIS License Number") ||
    getSequifiFieldValue(raw, "CA HIS Number");

  return {
    onboardAxia: isSequifiYes(getSequifiInstallerFieldValue(raw, "Axia")),
    installerTabs: [...new Set(installerTabs)],
    markets,
    caHis,
    hisIssueDate: getSequifiFieldValue(raw, "HIS Issue Date") || getSequifiFieldValue(raw, "Issue Date"),
    hisExpDate: getSequifiFieldValue(raw, "HIS Exp Date") || getSequifiFieldValue(raw, "Exp Date"),
  };
}
