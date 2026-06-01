export type StepStatus = "pending" | "success" | "failed" | "skipped";

export type JobStatus =
  | "pending"
  | "processing"
  | "partial"
  | "completed"
  | "failed"
  | "skipped";

export interface SequifiUserRecord {
  id: number;
  employee_id: string;
  first_name: string;
  last_name: string;
  email: string;
  mobile_no?: string | null;
  position_name?: string | null;
  office_name?: string | null;
  worker_type?: string | null;
  status_id?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
  raw: Record<string, unknown>;
}

export interface OnboardingJob {
  id: string;
  sequifi_user_id: string;
  sequifi_employee_id: string;
  email: string;
  email_normalized: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  role_label: string | null;
  welcome_email_to: string | null;
  raw_sequifi_payload: Record<string, unknown>;
  status: JobStatus;
  microsoft_status: StepStatus;
  enerflo_status: StepStatus;
  terros_status: StepStatus;
  welcome_email_status: StepStatus;
  microsoft_user_id: string | null;
  microsoft_upn: string | null;
  enerflo_user_id: string | null;
  terros_user_id: string | null;
  temp_password: string | null;
  last_error: string | null;
  step_errors: Record<string, string>;
  attempt_count: number;
  next_retry_at: string | null;
  max_attempts: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface OnboardingRunSummary {
  polled: number;
  /** Hired users skipped via temporary test blocklist in exclude.ts. */
  excludeFiltered: number;
  /** Hired Sequifi users missing a member @noxpwr.com account. */
  gapNeed: number;
  newJobs: number;
  retried: number;
  completed: number;
  partial: number;
  failed: number;
  skipped: number;
  dryRun: boolean;
  /** Rows appended to Google Sheets roster (EMPWR) after Microsoft provision. */
  sheetsAppended: number;
  sheetsSkipped: number;
  sheetsErrors: string[];
  errors: string[];
}

export interface ProvisionUserResult {
  sequifiUserId: number;
  ok: boolean;
  skipped: boolean;
  reason?: string;
  job: OnboardingJob | null;
  error?: string;
}

export interface ProvisionBulkResult {
  results: ProvisionUserResult[];
  completed: number;
  partial: number;
  failed: number;
  skipped: number;
  dryRun: boolean;
  errors: string[];
}
