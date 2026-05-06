"use server";

import { getAllLeads, createLead, updateLeadStatus, deleteLead } from "@/lib/leads";
import type { Lead, PipelineStageId } from "@/lib/leads-types";
import { enerfloRequest } from "@/lib/enerflo/client";
import type { ApiLog } from "@/lib/logger";

export type LeadActionResult = {
  lead: Lead;
  log: ApiLog;
};

// ── Fetch all leads ────────────────────────────────────────────────────────
export async function fetchLeads(): Promise<Lead[]> {
  return getAllLeads();
}

// ── Create lead locally + push to Enerflo ─────────────────────────────────
export async function submitLead(formData: FormData): Promise<LeadActionResult> {
  const get = (k: string) => (formData.get(k) as string | null)?.trim() ?? "";

  // 1. Save locally first (always works, even without API key)
  const lead = createLead({
    first_name: get("first_name"),
    last_name: get("last_name"),
    email: get("email"),
    mobile: get("mobile"),
    address: get("address"),
    city: get("city"),
    state: get("state"),
    zip: get("zip"),
    assign_to_email: get("assign_to_email"),
    setter_email: get("setter_email"),
    office_name: get("office_name"),
    lead_source: get("lead_source"),
    notes: get("notes"),
    enerfloCustomerId: "",
    integration_record_id: get("integration_record_id") || lead_uuid(),
  });

  // 2. Push to Enerflo Lead Gen API
  const body: Record<string, unknown> = {
    lead: {
      first_name: lead.first_name,
      last_name: lead.last_name,
      address: lead.address,
      city: lead.city,
      state: lead.state,
      zip: lead.zip,
      ...(lead.email && { email: lead.email }),
      ...(lead.mobile && { mobile: lead.mobile }),
      ...(lead.assign_to_email && { assign_to_email: lead.assign_to_email }),
      ...(lead.setter_email && { setter_email: lead.setter_email }),
      ...(lead.office_name && { office_name: lead.office_name }),
      ...(lead.lead_source && { lead_source: lead.lead_source }),
      ...(lead.notes && { add_note: lead.notes }),
      integration_record_id: lead.integration_record_id || lead.id,
    },
  };

  const log = await enerfloRequest({
    operation: "submit_lead",
    method: "POST",
    path: "/api/v1/partner/action/lead/add",
    body,
  });

  // 3. If API call succeeded, update local status + save Enerflo ID
  if (log.ok) {
    try {
      const parsed = JSON.parse(log.responsePreview);
      const enerfloId = parsed?.customer_id ?? parsed?.id ?? "";
      updateLeadStatus(lead.id, "lead_submitted");
      if (enerfloId) {
        const { updateLeadField } = await import("@/lib/leads");
        updateLeadField(lead.id, { enerfloCustomerId: String(enerfloId) });
        lead.enerfloCustomerId = String(enerfloId);
      }
      lead.status = "lead_submitted";
    } catch {
      updateLeadStatus(lead.id, "lead_submitted");
      lead.status = "lead_submitted";
    }
  }

  return { lead, log };
}

function lead_uuid() {
  return `local-${Date.now()}`;
}

// ── Update status ──────────────────────────────────────────────────────────
export async function changeLeadStatus(
  id: string,
  status: PipelineStageId,
  note?: string
): Promise<Lead | null> {
  return updateLeadStatus(id, status, note);
}

// ── Delete lead ────────────────────────────────────────────────────────────
export async function removeLead(id: string): Promise<boolean> {
  return deleteLead(id);
}
