// Pure types — safe to import in client components (no Node.js deps)

export type AutomationSystem = "enerflo" | "sequifi" | "terros";

export type AutomationCondition = {
  field: string;
  operator: "equals" | "contains" | "not_equals";
  value: string;
};

export type AutomationTrigger = {
  system: AutomationSystem;
  event: string;
  eventLabel: string;
  conditions?: AutomationCondition[];
};

export type AutomationAction = {
  system: AutomationSystem;
  operation: string;
  operationLabel: string;
  endpoint: string;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  fieldMapping: Record<string, string>; // source field -> target field name
  samplePayload?: Record<string, unknown>; // used when Run manually is clicked
};

export type AutomationRunStatus = "success" | "failed" | "skipped";

export type Automation = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  isTemplate: boolean; // pre-built = true; user-created = false
  trigger: AutomationTrigger;
  action: AutomationAction;
  lastRunAt?: string;
  lastRunStatus?: AutomationRunStatus;
  lastRunResponse?: string;
  lastRunHttpStatus?: number | null;
  runCount: number;
  createdAt: string;
};

// ── Known events catalog ──────────────────────────────────────────────────
export const TRIGGER_EVENTS: Record<AutomationSystem, { id: string; label: string }[]> = {
  enerflo: [
    { id: "pipeline.lead_submitted",       label: "Lead Submitted" },
    { id: "pipeline.appointment_set",      label: "Appointment Set" },
    { id: "pipeline.deal_in_progress",     label: "Deal In Progress" },
    { id: "pipeline.deal_signed",          label: "Deal Signed" },
    { id: "pipeline.install_scheduled",    label: "Install Scheduled" },
    { id: "pipeline.milestone_reached",    label: "Install Milestone Reached" },
    { id: "pipeline.completed",            label: "Installation Completed" },
    { id: "pipeline.install_report_added", label: "Install Report Added" },
    { id: "deal.projectSubmitted",         label: "Project Submitted (Install)" },
    { id: "user.created",                  label: "New User Created" },
    { id: "customer.created",              label: "New Customer Created" },
    { id: "stats.weekly",                  label: "Weekly Stats Summary" },
  ],
  sequifi: [
    { id: "onboarding.started",      label: "Rep Onboarding Started" },
    { id: "onboarding.completed",    label: "Rep Onboarding Completed" },
    { id: "commission.approved",     label: "Commission Approved" },
    { id: "commission.paid",         label: "Commission Paid" },
  ],
  terros: [
    { id: "knock.interested",        label: "Knock Marked as Interested" },
    { id: "knock.not_home",          label: "Knock Marked as Not Home" },
    { id: "stats.updated",           label: "Rep Stats Updated" },
  ],
};

export const ACTION_OPERATIONS: Record<AutomationSystem, { id: string; label: string; endpoint: string; method: "GET" | "POST" }[]> = {
  enerflo: [
    { id: "create_user",     label: "Create Rep / User",   endpoint: "/api/v1/users",                          method: "POST" },
    { id: "create_lead",     label: "Create Lead",         endpoint: "/api/v1/partner/action/lead/add",         method: "POST" },
    { id: "create_customer", label: "Create Customer",     endpoint: "/api/v1/customers",                       method: "POST" },
    { id: "get_users",       label: "Fetch Users",         endpoint: "/api/v3/users",                           method: "GET"  },
  ],
  sequifi: [
    { id: "create_employee", label: "Create Employee",     endpoint: "/api/v1/employees",                       method: "POST" },
    { id: "get_employees",   label: "Fetch Employees",     endpoint: "/api/v1/employees",                       method: "GET"  },
  ],
  terros: [
    { id: "push_stats",       label: "Push Rep Stats",           endpoint: "/api/v1/stats",             method: "POST" },
    { id: "push_competition", label: "Update Leaderboard",       endpoint: "/api/v1/competition",       method: "POST" },
    { id: "push_install",     label: "Push Install Completion",  endpoint: "/evaluation/update",        method: "POST" },
    { id: "push_milestone",   label: "Push Milestone Progress",  endpoint: "/evaluation/update",        method: "POST" },
    { id: "push_kw_sold",     label: "Push kW Sold Metric",      endpoint: "/api/v1/stats",             method: "POST" },
    { id: "create_account",   label: "Create Terros Account",     endpoint: "/account/add",              method: "POST" },
  ],
};

export const SYSTEM_META: Record<AutomationSystem, { label: string; color: string; dot: string; tagline: string }> = {
  enerflo: { label: "Enerflo",  color: "text-orange-400", dot: "bg-orange-400", tagline: "CRM & Solar Sales" },
  sequifi:  { label: "Sequifi",  color: "text-violet-400", dot: "bg-violet-400", tagline: "Onboarding & Commissions" },
  terros:   { label: "Terros",   color: "text-sky-400",    dot: "bg-sky-400",    tagline: "Knocking & Reporting" },
};
