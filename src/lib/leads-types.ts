// Pure types — safe to import in client components (no Node.js deps)

export const PIPELINE_STAGES = [
  { id: "not_started",       label: "Not Started",       color: "gray"   },
  { id: "lead_submitted",    label: "Lead Submitted",    color: "blue"   },
  { id: "appointment_set",   label: "Appointment Set",   color: "indigo" },
  { id: "deal_in_progress",  label: "Deal In Progress",  color: "yellow" },
  { id: "deal_signed",       label: "Deal Signed",       color: "orange" },
  { id: "install_scheduled", label: "Install Scheduled", color: "violet" },
  { id: "completed",         label: "Completed",         color: "green"  },
] as const;

export type PipelineStageId = (typeof PIPELINE_STAGES)[number]["id"];

export type Lead = {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: PipelineStageId;
  first_name: string;
  last_name: string;
  email: string;
  mobile: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  assign_to_email: string;
  setter_email: string;
  office_name: string;
  lead_source: string;
  notes: string;
  enerfloCustomerId: string;
  integration_record_id: string;
  history: { at: string; from: PipelineStageId; to: PipelineStageId; note?: string }[];
};
