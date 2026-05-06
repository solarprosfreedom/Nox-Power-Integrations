import fs from "fs";
import path from "path";
import type { Automation, AutomationRunStatus } from "@/lib/automations-types";
export type { Automation } from "@/lib/automations-types";

const FILE = path.join(process.cwd(), "data", "automations.json");

// ── Seed templates (written once if file is missing / empty) ──────────────
const SEED: Automation[] = [
  {
    id: "tpl-sequifi-enerflo-onboarding",
    name: "Onboarding Complete → Create Enerflo Rep",
    description:
      "When a new hire finishes onboarding in Sequifi, automatically create their user account in Enerflo so they can start using the CRM immediately.",
    enabled: false,
    isTemplate: true,
    trigger: {
      system: "sequifi",
      event: "onboarding.completed",
      eventLabel: "Rep Onboarding Completed",
    },
    action: {
      system: "enerflo",
      operation: "create_user",
      operationLabel: "Create Rep / User",
      endpoint: "/api/v1/users",
      method: "POST",
      fieldMapping: {
        "employee.first_name": "first_name",
        "employee.last_name": "last_name",
        "employee.email": "email",
        "employee.phone": "phone",
        "employee.role": "roles[0]",
      },
      samplePayload: {
        email: "newrep@company.com",
        roles: ["Sales Rep"],
        first_name: "Jane",
        last_name: "Smith",
        notify_email: true,
        can_create_customers: true,
        allow_optimus: false,
        can_reassign_leads: true,
      },
    },
    runCount: 0,
    createdAt: new Date().toISOString(),
  },
  {
    id: "tpl-enerflo-terros-deal-stats",
    name: "Deal Signed → Push Rep Stats to Terros",
    description:
      "When a deal is signed in Enerflo (pipeline reaches 'deal_signed'), push the rep's updated stats to Terros so the leaderboard and reporting stay current.",
    enabled: false,
    isTemplate: true,
    trigger: {
      system: "enerflo",
      event: "pipeline.deal_signed",
      eventLabel: "Deal Signed",
    },
    action: {
      system: "terros",
      operation: "push_stats",
      operationLabel: "Push Rep Stats",
      endpoint: "/api/v1/stats",
      method: "POST",
      fieldMapping: {
        "lead.assign_to_email": "rep_email",
        "lead.id": "deal_id",
        "lead.city": "territory",
      },
      samplePayload: {
        rep_email: "rep@company.com",
        deal_id: "enerflo-lead-123",
        territory: "Phoenix",
        metric: "deals_closed",
        value: 1,
      },
    },
    runCount: 0,
    createdAt: new Date().toISOString(),
  },
  {
    id: "tpl-enerflo-terros-leaderboard",
    name: "Deal Signed → Update Terros Leaderboard",
    description:
      "When a deal is signed in Enerflo, push the team competition data to Terros so the knocking leaderboard reflects the latest closed deals.",
    enabled: false,
    isTemplate: true,
    trigger: {
      system: "enerflo",
      event: "pipeline.deal_signed",
      eventLabel: "Deal Signed",
    },
    action: {
      system: "terros",
      operation: "push_competition",
      operationLabel: "Update Leaderboard",
      endpoint: "/api/v1/competition",
      method: "POST",
      fieldMapping: {
        "lead.assign_to_email": "rep_email",
        "lead.office_name": "office",
      },
      samplePayload: {
        rep_email: "rep@company.com",
        office: "Phoenix North",
        event_type: "deal_closed",
        points: 10,
      },
    },
    runCount: 0,
    createdAt: new Date().toISOString(),
  },
  {
    id: "tpl-enerflo-terros-install-completed",
    name: "Install Completed → Push to Terros Leaderboard",
    description:
      "When an installation is fully completed in Enerflo, push the rep's install completion stat to Terros so the leaderboard and reporting dashboard reflect the finished project immediately.",
    enabled: false,
    isTemplate: true,
    trigger: {
      system: "enerflo",
      event: "pipeline.completed",
      eventLabel: "Installation Completed",
    },
    action: {
      system: "terros",
      operation: "push_install",
      operationLabel: "Push Install Completion",
      endpoint: "/evaluation/update",
      method: "POST",
      fieldMapping: {
        "install.rep_email":        "rep_email",
        "install.completion_date":  "date",
        "install.office_id":        "office",
        "install.customer_city":    "territory",
        "install.id":               "install_id",
      },
      samplePayload: {
        rep_email:   "rep@company.com",
        date:        new Date().toISOString().split("T")[0],
        office:      "Phoenix North",
        territory:   "Phoenix",
        install_id:  "enerflo-install-001",
        metric:      "install_completed",
        value:       1,
      },
    },
    runCount: 0,
    createdAt: new Date().toISOString(),
  },
  {
    id: "tpl-enerflo-terros-milestone",
    name: "Install Milestone Reached → Push Progress to Terros",
    description:
      "When a key installation milestone is reached in Enerflo (e.g. Permit Submitted, Panel Delivery, PTO), push the milestone event to Terros so stage-by-stage rep progress is tracked on the dashboard.",
    enabled: false,
    isTemplate: true,
    trigger: {
      system: "enerflo",
      event: "pipeline.milestone_reached",
      eventLabel: "Install Milestone Reached",
    },
    action: {
      system: "terros",
      operation: "push_milestone",
      operationLabel: "Push Milestone Progress",
      endpoint: "/evaluation/update",
      method: "POST",
      fieldMapping: {
        "install.rep_email":      "rep_email",
        "milestone.name":         "milestone",
        "milestone.completed_at": "date",
        "install.id":             "install_id",
      },
      samplePayload: {
        rep_email:  "rep@company.com",
        milestone:  "Permit Submitted",
        date:       new Date().toISOString().split("T")[0],
        install_id: "enerflo-install-001",
        metric:     "milestone_reached",
        value:      1,
      },
    },
    runCount: 0,
    createdAt: new Date().toISOString(),
  },
  {
    id: "tpl-enerflo-terros-kw-sold",
    name: "Deal Signed → Push kW Sold to Terros",
    description:
      "When a deal is signed in Enerflo, push the system size (kW) from the survey to Terros. This powers kW-based leaderboard rankings where bigger systems earn more points.",
    enabled: false,
    isTemplate: true,
    trigger: {
      system: "enerflo",
      event: "pipeline.deal_signed",
      eventLabel: "Deal Signed",
    },
    action: {
      system: "terros",
      operation: "push_kw_sold",
      operationLabel: "Push kW Sold Metric",
      endpoint: "/api/v1/stats",
      method: "POST",
      fieldMapping: {
        "survey.rep_email":      "rep_email",
        "survey.system_size_kw": "value",
        "survey.office_name":    "office",
        "survey.id":             "survey_id",
      },
      samplePayload: {
        rep_email: "rep@company.com",
        value:     10.5,
        office:    "Phoenix North",
        survey_id: "enerflo-survey-001",
        metric:    "kw_sold",
      },
    },
    runCount: 0,
    createdAt: new Date().toISOString(),
  },
  {
    id: "tpl-enerflo-terros-project-submitted",
    name: "Project Submitted → Create Terros Account",
    description:
      "When a deal is submitted as an installation project in Enerflo (deal.projectSubmitted), " +
      "the middleware resolves the rep's email from Enerflo, looks up their Terros user ID, " +
      "then creates a Terros account linked to that rep — so the project is automatically " +
      "counted in Terros competitions and leaderboards.",
    enabled: false,
    isTemplate: true,
    trigger: {
      system: "enerflo",
      event: "deal.projectSubmitted",
      eventLabel: "Project Submitted (Install)",
    },
    action: {
      system: "terros",
      operation: "create_account",
      operationLabel: "Create Terros Account",
      endpoint: "/account/add",
      method: "POST",
      fieldMapping: {
        "customer.firstName": "name",
        "deal.id":            "externalId",
      },
      samplePayload: {
        name:           "John Doe (10.875 kW)",
        assignedUserId: "<resolved-from-enerflo>",
        externalId:     "<enerflo-deal-id>",
        sourceStatus:   "Project Submitted",
        sourceId:       "<shortCode>",
        // Real webhook fills customFields from TERROS_CF_* env + Enerflo payload (see enerflo-v2/route.ts)
        customFields:   {},
      },
    },
    runCount: 0,
    createdAt: new Date().toISOString(),
  },
  {
    id: "tpl-terros-enerflo-knock",
    name: "Terros Knock Interested → Create Enerflo Lead",
    description:
      "When a rep marks a door knock as 'Interested' in Terros, automatically push the homeowner's info into Enerflo as a new lead so the CRM pipeline starts immediately.",
    enabled: false,
    isTemplate: true,
    trigger: {
      system: "terros",
      event: "knock.interested",
      eventLabel: "Knock Marked as Interested",
    },
    action: {
      system: "enerflo",
      operation: "create_lead",
      operationLabel: "Create Lead",
      endpoint: "/api/v1/partner/action/lead/add",
      method: "POST",
      fieldMapping: {
        "knock.homeowner_first_name": "lead.first_name",
        "knock.homeowner_last_name": "lead.last_name",
        "knock.address": "lead.address",
        "knock.city": "lead.city",
        "knock.state": "lead.state",
        "knock.zip": "lead.zip",
        "knock.rep_email": "lead.setter_email",
      },
      samplePayload: {
        lead: {
          first_name: "John",
          last_name: "Doe",
          address: "123 Solar Ave",
          city: "Phoenix",
          state: "AZ",
          zip: "85001",
          setter_email: "rep@company.com",
          lead_source: "door-knock",
          integration_record_id: "terros-knock-001",
        },
      },
    },
    runCount: 0,
    createdAt: new Date().toISOString(),
  },
];

// ── Storage helpers ───────────────────────────────────────────────────────
function read(): Automation[] {
  try {
    const raw = fs.readFileSync(FILE, "utf-8").trim();
    if (!raw || raw === "[]") return [...SEED];
    return JSON.parse(raw) as Automation[];
  } catch {
    return [...SEED];
  }
}

function write(automations: Automation[]): void {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(automations, null, 2), "utf-8");
}

function ensureSeeded(): Automation[] {
  const data = read();
  // If file was just initialised (empty), persist the seed
  const raw = (() => { try { return fs.readFileSync(FILE, "utf-8").trim(); } catch { return ""; } })();
  if (!raw || raw === "[]") write(SEED);
  return data;
}

// ── CRUD ──────────────────────────────────────────────────────────────────
export function getAllAutomations(): Automation[] {
  return ensureSeeded();
}

export function getAutomationById(id: string): Automation | null {
  return getAllAutomations().find((a) => a.id === id) ?? null;
}

export function createAutomation(
  data: Omit<Automation, "id" | "createdAt" | "runCount" | "isTemplate">
): Automation {
  const automation: Automation = {
    ...data,
    id: crypto.randomUUID(),
    isTemplate: false,
    runCount: 0,
    createdAt: new Date().toISOString(),
  };
  const all = getAllAutomations();
  write([...all, automation]);
  return automation;
}

export function toggleAutomation(id: string, enabled: boolean): Automation | null {
  const all = getAllAutomations();
  const idx = all.findIndex((a) => a.id === id);
  if (idx === -1) return null;
  all[idx] = { ...all[idx], enabled };
  write(all);
  return all[idx];
}

export function recordRun(
  id: string,
  status: AutomationRunStatus,
  httpStatus: number | null,
  response: string
): Automation | null {
  const all = getAllAutomations();
  const idx = all.findIndex((a) => a.id === id);
  if (idx === -1) return null;
  all[idx] = {
    ...all[idx],
    lastRunAt: new Date().toISOString(),
    lastRunStatus: status,
    lastRunHttpStatus: httpStatus,
    lastRunResponse: response.slice(0, 1000),
    runCount: all[idx].runCount + 1,
  };
  write(all);
  return all[idx];
}

export function deleteAutomation(id: string): boolean {
  const all = getAllAutomations();
  const filtered = all.filter((a) => a.id !== id);
  if (filtered.length === all.length) return false;
  write(filtered);
  return true;
}
