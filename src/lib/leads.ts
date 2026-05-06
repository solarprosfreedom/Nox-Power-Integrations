import fs from "fs";
import path from "path";
export type { Lead, PipelineStageId } from "@/lib/leads-types";
export { PIPELINE_STAGES } from "@/lib/leads-types";
import type { Lead, PipelineStageId } from "@/lib/leads-types";

const LEADS_FILE = path.join(process.cwd(), "data", "leads.json");

function readLeads(): Lead[] {
  try {
    return JSON.parse(fs.readFileSync(LEADS_FILE, "utf-8")) as Lead[];
  } catch {
    return [];
  }
}

function writeLeads(leads: Lead[]): void {
  fs.mkdirSync(path.dirname(LEADS_FILE), { recursive: true });
  fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2), "utf-8");
}

export function getAllLeads(): Lead[] {
  return readLeads();
}

export function getLeadById(id: string): Lead | null {
  return readLeads().find((l) => l.id === id) ?? null;
}

export function createLead(
  data: Omit<Lead, "id" | "createdAt" | "updatedAt" | "status" | "history">
): Lead {
  const now = new Date().toISOString();
  const lead: Lead = {
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    status: "not_started",
    history: [],
    ...data,
  };
  writeLeads([lead, ...readLeads()]);
  return lead;
}

export function updateLeadStatus(
  id: string,
  newStatus: PipelineStageId,
  note?: string
): Lead | null {
  const leads = readLeads();
  const idx = leads.findIndex((l) => l.id === id);
  if (idx === -1) return null;
  const lead = leads[idx];
  const now = new Date().toISOString();
  lead.history.push({ at: now, from: lead.status, to: newStatus, note });
  lead.status = newStatus;
  lead.updatedAt = now;
  leads[idx] = lead;
  writeLeads(leads);
  return lead;
}

export function updateLeadField(id: string, fields: Partial<Lead>): Lead | null {
  const leads = readLeads();
  const idx = leads.findIndex((l) => l.id === id);
  if (idx === -1) return null;
  leads[idx] = { ...leads[idx], ...fields, updatedAt: new Date().toISOString() };
  writeLeads(leads);
  return leads[idx];
}

export function deleteLead(id: string): boolean {
  const leads = readLeads();
  const filtered = leads.filter((l) => l.id !== id);
  if (filtered.length === leads.length) return false;
  writeLeads(filtered);
  return true;
}
