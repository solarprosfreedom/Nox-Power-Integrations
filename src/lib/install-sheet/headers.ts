/** Row 1 headers for the Axia install backlog Google Sheet (columns A–Y). */
export const INSTALL_SHEET_HEADERS = [
  "Assign_To_Email",
  "Customer_First_Name",
  "Customer_Last_Name",
  "Customer_Email",
  "Customer_Mobile",
  "Customer_Address",
  "Customer_Unit",
  "Customer_City",
  "Customer_State",
  "Customer_Zip",
  "Notes",
  "Last_Completed_Milestone",
  "Complete_Previous_Milestones",
  "System_Cost",
  "System_Size",
  "Date_Signed",
  "Install_Integration_ID",
  "Install_Integration_Record_Type",
  "Customer_Integration_ID",
  "Customer_Integration_Record_Type",
  "Install_ID",
  "Customer_ID",
  "Sync_Status",
  "Last_Synced_At",
  "Sync_Error",
] as const;

export type InstallSheetHeader = (typeof INSTALL_SHEET_HEADERS)[number];

export const INSTALL_SHEET_REQUIRED_HEADERS = [
  "Customer_First_Name",
  "Customer_Last_Name",
  "Customer_Email",
  "Customer_Mobile",
  "Customer_Address",
  "Customer_City",
  "Customer_State",
  "Customer_Zip",
] as const satisfies readonly InstallSheetHeader[];

export const INSTALL_SHEET_WRITE_BACK_HEADERS = [
  "Install_ID",
  "Customer_ID",
  "Sync_Status",
  "Last_Synced_At",
  "Sync_Error",
] as const satisfies readonly InstallSheetHeader[];
