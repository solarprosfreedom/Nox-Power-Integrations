import fs from "fs";
import path from "path";
import type { Automation, AutomationRunStatus } from "@/lib/automations-types";
import { isIntegrationDirectionAllowed } from "@/lib/integration-direction";

export type { Automation } from "@/lib/automations-types";

const FILE = path.join(process.cwd(), "data", "automations.json");

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
];

function allowedAutomations(automations: Automation[]): Automation[] {
  return automations.filter(automation =>
    isIntegrationDirectionAllowed(
      automation.trigger.system,
      automation.action.system,
    ),
  );
}

function read(): Automation[] {
  try {
    const raw = fs.readFileSync(FILE, "utf-8").trim();
    if (!raw || raw === "[]") return [...SEED];
    return allowedAutomations(JSON.parse(raw) as Automation[]);
  } catch {
    return [...SEED];
  }
}

function write(automations: Automation[]): void {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(
    FILE,
    JSON.stringify(allowedAutomations(automations), null, 2),
    "utf-8",
  );
}

function ensureSeeded(): Automation[] {
  const data = read();
  const raw = (() => {
    try {
      return fs.readFileSync(FILE, "utf-8").trim();
    } catch {
      return "";
    }
  })();
  if (!raw || raw === "[]") write(SEED);
  return data;
}

export function getAllAutomations(): Automation[] {
  return ensureSeeded();
}

export function getAutomationById(id: string): Automation | null {
  return getAllAutomations().find(automation => automation.id === id) ?? null;
}

export function createAutomation(
  data: Omit<Automation, "id" | "createdAt" | "runCount" | "isTemplate">,
): Automation {
  const automation: Automation = {
    ...data,
    id: crypto.randomUUID(),
    isTemplate: false,
    runCount: 0,
    createdAt: new Date().toISOString(),
  };
  write([...getAllAutomations(), automation]);
  return automation;
}

export function toggleAutomation(
  id: string,
  enabled: boolean,
): Automation | null {
  const all = getAllAutomations();
  const index = all.findIndex(automation => automation.id === id);
  if (index === -1) return null;
  all[index] = { ...all[index], enabled };
  write(all);
  return all[index];
}

export function recordRun(
  id: string,
  status: AutomationRunStatus,
  httpStatus: number | null,
  response: string,
): Automation | null {
  const all = getAllAutomations();
  const index = all.findIndex(automation => automation.id === id);
  if (index === -1) return null;
  all[index] = {
    ...all[index],
    lastRunAt: new Date().toISOString(),
    lastRunStatus: status,
    lastRunHttpStatus: httpStatus,
    lastRunResponse: response.slice(0, 1000),
    runCount: all[index].runCount + 1,
  };
  write(all);
  return all[index];
}

export function deleteAutomation(id: string): boolean {
  const all = getAllAutomations();
  const filtered = all.filter(automation => automation.id !== id);
  if (filtered.length === all.length) return false;
  write(filtered);
  return true;
}
