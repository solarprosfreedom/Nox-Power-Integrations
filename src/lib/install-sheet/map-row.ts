import { env } from "@/lib/env";
import {
  INSTALL_SHEET_HEADERS,
  INSTALL_SHEET_REQUIRED_HEADERS,
  type InstallSheetHeader,
} from "@/lib/install-sheet/headers";

export interface InstallSheetRowInput {
  values: Record<InstallSheetHeader, string>;
}

export interface LeadInstallPayload {
  survey_type_id: string;
  assign_to_email: string;
  first_name: string;
  last_name: string;
  email: string;
  mobile: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  unit?: string;
  notes?: string;
  last_completed_milestone?: string;
  complete_previous_milestones?: boolean;
  system_cost?: string;
  system_size?: string;
  date_signed?: string;
  install_integration_id?: string;
  install_integration_record_type?: string;
  customer_integration_id?: string;
  customer_integration_record_type?: string;
}

function parseBoolean(value: string): boolean | undefined {
  const v = value.trim().toLowerCase();
  if (!v) return undefined;
  if (["true", "1", "yes", "y"].includes(v)) return true;
  if (["false", "0", "no", "n"].includes(v)) return false;
  return undefined;
}

function optionalField(value: string): string | undefined {
  const v = value.trim();
  return v || undefined;
}

export function validateInstallSheetRow(row: InstallSheetRowInput): string[] {
  const errors: string[] = [];
  for (const header of INSTALL_SHEET_REQUIRED_HEADERS) {
    if (!row.values[header]?.trim()) {
      errors.push(`Missing ${header}`);
    }
  }
  const state = row.values.Customer_State.trim();
  if (state && state.length !== 2) {
    errors.push("Customer_State must be a 2-letter state code (e.g. TX)");
  }
  return errors;
}

export function buildLeadInstallPayload(row: InstallSheetRowInput): LeadInstallPayload {
  const surveyTypeId = env.enerfloSurveyTypeId?.trim();
  if (!surveyTypeId) {
    throw new Error("ENERFLO_SURVEY_TYPE_ID is not set.");
  }

  const v = row.values;
  const payload: LeadInstallPayload = {
    survey_type_id: surveyTypeId,
    assign_to_email: resolveInstallSheetAssignToEmail(),
    first_name: v.Customer_First_Name.trim(),
    last_name: v.Customer_Last_Name.trim(),
    email: v.Customer_Email.trim(),
    mobile: v.Customer_Mobile.trim(),
    address: v.Customer_Address.trim(),
    city: v.Customer_City.trim(),
    state: v.Customer_State.trim().toUpperCase(),
    zip: v.Customer_Zip.trim(),
  };

  const unit = optionalField(v.Customer_Unit);
  if (unit) payload.unit = unit;

  const notes = optionalField(v.Notes);
  if (notes) payload.notes = notes;

  const milestone = optionalField(v.Last_Completed_Milestone);
  if (milestone) payload.last_completed_milestone = milestone;

  const completePrevious = parseBoolean(v.Complete_Previous_Milestones);
  if (completePrevious != null) payload.complete_previous_milestones = completePrevious;

  const systemCost = optionalField(v.System_Cost);
  if (systemCost) payload.system_cost = systemCost;

  const systemSize = optionalField(v.System_Size);
  if (systemSize) payload.system_size = systemSize;

  const dateSigned = optionalField(v.Date_Signed);
  if (dateSigned) payload.date_signed = dateSigned;

  const installIntegrationId = optionalField(v.Install_Integration_ID);
  if (installIntegrationId) {
    payload.install_integration_id = installIntegrationId;
    payload.install_integration_record_type =
      optionalField(v.Install_Integration_Record_Type) ?? "GoogleSheets";
  }

  const customerIntegrationId = optionalField(v.Customer_Integration_ID);
  if (customerIntegrationId) {
    payload.customer_integration_id = customerIntegrationId;
    payload.customer_integration_record_type =
      optionalField(v.Customer_Integration_Record_Type) ?? "GoogleSheets";
  }

  return payload;
}

export function buildTestRowValues(): string[] {
  const stamp = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  const assignToEmail = resolveInstallSheetAssignToEmail();
  const byHeader: Record<InstallSheetHeader, string> = {
    Assign_To_Email: assignToEmail,
    Customer_First_Name: "Test",
    Customer_Last_Name: "Install",
    Customer_Email: `axia-test-${stamp}@example.com`,
    Customer_Mobile: "9532567709",
    Customer_Address: "4708 Greenham Ln.",
    Customer_Unit: "",
    Customer_City: "Crowley",
    Customer_State: "TX",
    Customer_Zip: "76036",
    Notes: "Middleware test row — safe to delete after import test",
    Last_Completed_Milestone: "",
    Complete_Previous_Milestones: "",
    System_Cost: "20000",
    System_Size: "6.97",
    Date_Signed: today,
    Install_Integration_ID: `test-${stamp}`,
    Install_Integration_Record_Type: "GoogleSheets",
    Customer_Integration_ID: "",
    Customer_Integration_Record_Type: "",
    Install_ID: "",
    Customer_ID: "",
    Sync_Status: "",
    Last_Synced_At: "",
    Sync_Error: "",
  };

  return INSTALL_SHEET_HEADERS.map(header => byHeader[header]);
}

export function resolveInstallSheetAssignToEmail(): string {
  return env.installSheetAssignToEmail?.trim() || "jonaslim@noxpwr.com";
}

/** @deprecated use resolveInstallSheetAssignToEmail */
export function resolveDefaultAssignToEmail(): string {
  return resolveInstallSheetAssignToEmail();
}
