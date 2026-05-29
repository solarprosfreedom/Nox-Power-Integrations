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

const INSTALLER_DROPDOWNS: { fieldName: string; tabName: string }[] = [
  { fieldName: "Onboard to Axia?", tabName: "Axia" },
  { fieldName: "Onboard to Empwr?", tabName: "EMPWR" },
  { fieldName: "Onboard to Good Pwr?", tabName: "GoodPWR" },
  { fieldName: "Onboard to Tron?", tabName: "Tron" },
  { fieldName: "Onboard to Better Earth?", tabName: "Better Earth" },
];

export function parseSequifiFields(raw: Record<string, unknown>): ParsedSequifiFields {
  const installerTabs: string[] = [];

  for (const { fieldName, tabName } of INSTALLER_DROPDOWNS) {
    if (isSequifiYes(getSequifiFieldValue(raw, fieldName))) {
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
    onboardAxia: isSequifiYes(getSequifiFieldValue(raw, "Onboard to Axia?")),
    installerTabs: [...new Set(installerTabs)],
    markets,
    caHis,
    hisIssueDate: getSequifiFieldValue(raw, "HIS Issue Date") || getSequifiFieldValue(raw, "Issue Date"),
    hisExpDate: getSequifiFieldValue(raw, "HIS Exp Date") || getSequifiFieldValue(raw, "Exp Date"),
  };
}
