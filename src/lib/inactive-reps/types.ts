export const INACTIVE_REP_CRITERIA_VERSION = "2026-08-14-v1";
export const INACTIVE_REP_WINDOW_DAYS = 30;

export type InactiveRepPlatform = "enerflo" | "microsoft" | "terros";
export type ActivityState = "inactive" | "recent" | "unknown";

export interface PlatformAccountSnapshot {
  platform: InactiveRepPlatform;
  id: string;
  email: string;
  name: string;
  active: boolean;
  createdAt: string | null;
  lastLoginAt: string | null;
  roles: string[];
  activityState: ActivityState;
  activityReason: string;
  evidenceSource: string;
  evidenceIssue?: string;
}

export interface SaleMatch {
  installer: string;
  saleDate: string;
  method: "exact_email" | "exact_unique_name" | "fuzzy_unique_best_name";
  sourcePath: string;
  score: number;
}

export interface InactiveRepCandidate {
  identityKey: string;
  identityEmail: string;
  name: string;
  role: string;
  roleSource: string;
  sequifiUserId: string | null;
  reason: string;
  checkedAt: string;
  cutoffAt: string;
  accounts: Partial<Record<InactiveRepPlatform, PlatformAccountSnapshot>>;
  targets: PlatformAccountSnapshot[];
  latestSale: SaleMatch | null;
}

export interface SourceSummary {
  sequifiUsers: number;
  enerfloRestUsers: number;
  enerfloGraphqlUsers: number;
  microsoftUsers: number;
  terrosUsers: number;
  salesRows: Record<string, number>;
}

export interface CandidateBuildResult {
  candidates: InactiveRepCandidate[];
  exclusions: Record<string, number>;
  ambiguousSales: number;
  sourceSummary: SourceSummary;
  checkedAt: string;
  cutoffAt: string;
}

export type BatchStatus =
  | "preparing"
  | "emailing"
  | "email_failed"
  | "emailed"
  | "processing"
  | "partial"
  | "completed";

export interface InactiveRepBatch {
  id: string;
  report_date: string;
  criteria_version: string;
  status: BatchStatus;
  cutoff_at: string;
  checked_at: string;
  email_subject: string;
  email_from: string | null;
  email_to: string;
  emailed_at: string | null;
  sent_message_id: string | null;
  candidates: InactiveRepCandidate[];
  report_csv: string;
  source_summary: SourceSummary | Record<string, never>;
  errors: string[];
  processing_started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export type ActionStatus = "pending" | "success" | "skipped" | "blocked" | "failed";

export interface InactiveRepAction {
  id: string;
  batch_id: string;
  identity_key: string;
  platform: InactiveRepPlatform;
  account_id: string;
  account_email: string;
  status: ActionStatus;
  attempts: number;
  last_error: string | null;
  metadata: Record<string, unknown>;
  processed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CronRunSummary {
  report: {
    reportDate: string;
    status: "sent" | "already_sent" | "failed";
    batchId?: string;
    candidates: number;
    accounts: number;
    error?: string;
  };
  deactivation: {
    enabled: boolean;
    dueBatches: number;
    revalidatedPeople: number;
    succeeded: number;
    skipped: number;
    blocked: number;
    failed: number;
  };
  sourceSummary: SourceSummary;
  exclusions: Record<string, number>;
}
