export type CloserPersonSource = "sequifi_inactive" | "deactivated_accounts";

export type CloserPerson = {
  id: number | null;
  name: string;
  email: string;
  role: string;
  source: CloserPersonSource;
  deactivated: boolean;
};

export type HubProject = {
  projectId: string;
  projectName: string;
  addressLine1: string;
  city: string;
  state: string;
  zip: string;
  installer: string;
  closerName: string;
  closerEmail: string;
  setterName: string;
  setterEmail: string;
  salesAdvisorName: string;
  salesAdvisorEmail: string;
  sequifiPid: string;
  systemSizeKw: number | null;
  remittance: Record<string, number | string | null>;
};

export type SequifiSaleLite = {
  pid: string;
  closerId: number | null;
  closerName: string;
  installPartner: string;
  totalCommission: number | null;
  kw: number | null;
  customerAddress: string;
  customerState: string;
  customerZip: string;
};

export type CloserProjectRow = {
  project_id: string;
  project_name: string;
  address: string;
  installer: string;
  closer_name: string;
  closer_email: string;
  partner_commission: string;
  partner_incentive: string;
  spif: string;
  c0: string;
  c1: string;
  c2: string;
  adjusted_c2: string;
  c0_paid: string;
  c1_paid: string;
  c2_paid: string;
  incentive_paid: string;
  clawback: string;
  others: string;
  total_sp_paid: string;
  sequifi_total_commission: string;
  system_size_kw: string;
  match_via: string;
};

export const INACTIVE_CLOSER_CSV_COLUMNS = [
  "project_id",
  "project_name",
  "address",
  "installer",
  "closer_name",
  "closer_email",
  "partner_commission",
  "partner_incentive",
  "spif",
  "c0",
  "c1",
  "c2",
  "adjusted_c2",
  "c0_paid",
  "c1_paid",
  "c2_paid",
  "incentive_paid",
  "clawback",
  "others",
  "total_sp_paid",
  "sequifi_total_commission",
  "system_size_kw",
] as const;
