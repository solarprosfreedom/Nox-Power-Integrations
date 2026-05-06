"use client";

import { useState, useEffect, useTransition } from "react";
import { fetchLeads, submitLead, changeLeadStatus, removeLead } from "@/app/actions/leads";
import { PIPELINE_STAGES, type Lead, type PipelineStageId } from "@/lib/leads-types";
import type { ApiLog } from "@/lib/logger";

// ── Status badge ──────────────────────────────────────────────────────────
const STATUS_STYLE: Record<string, string> = {
  gray:   "bg-gray-800 text-gray-400 border-gray-700",
  blue:   "bg-blue-900/50 text-blue-300 border-blue-700",
  indigo: "bg-indigo-900/50 text-indigo-300 border-indigo-700",
  yellow: "bg-yellow-900/50 text-yellow-300 border-yellow-700",
  orange: "bg-orange-900/50 text-orange-300 border-orange-700",
  violet: "bg-violet-900/50 text-violet-300 border-violet-700",
  green:  "bg-green-900/50 text-green-300 border-green-700",
};

function StatusBadge({ status }: { status: PipelineStageId }) {
  const stage = PIPELINE_STAGES.find((s) => s.id === status)!;
  return (
    <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[stage.color]}`}>
      {stage.label}
    </span>
  );
}

// ── Pipeline stepper ──────────────────────────────────────────────────────
function PipelineStepper({ current }: { current: PipelineStageId }) {
  const idx = PIPELINE_STAGES.findIndex((s) => s.id === current);
  return (
    <div className="flex items-center gap-0">
      {PIPELINE_STAGES.map((stage, i) => {
        const done    = i < idx;
        const active  = i === idx;
        const pending = i > idx;
        return (
          <div key={stage.id} className="flex items-center">
            <div className={`flex h-6 w-6 items-center justify-center rounded-full border text-[10px] font-bold transition-colors
              ${done   ? "border-green-600 bg-green-700 text-white" : ""}
              ${active ? `border-current ${STATUS_STYLE[stage.color]} scale-110` : ""}
              ${pending ? "border-gray-700 bg-gray-800 text-gray-600" : ""}
            `}>
              {done ? "✓" : i + 1}
            </div>
            {i < PIPELINE_STAGES.length - 1 && (
              <div className={`h-0.5 w-5 ${done ? "bg-green-700" : "bg-gray-800"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Status updater dropdown ───────────────────────────────────────────────
function StatusDropdown({
  lead,
  onUpdate,
}: {
  lead: Lead;
  onUpdate: (lead: Lead) => void;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function select(stageId: PipelineStageId) {
    setOpen(false);
    startTransition(async () => {
      const updated = await changeLeadStatus(lead.id, stageId);
      if (updated) onUpdate(updated);
    });
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={isPending}
        className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs text-gray-300
                   hover:border-gray-600 hover:text-white transition-colors disabled:opacity-50"
      >
        {isPending ? "Updating…" : "Change Status ▾"}
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-1 w-48 rounded-lg border border-gray-700 bg-gray-900 shadow-xl">
          {PIPELINE_STAGES.map((s) => (
            <button
              key={s.id}
              onClick={() => select(s.id)}
              className={`flex w-full items-center gap-2 px-3 py-2 text-xs text-left hover:bg-gray-800 transition-colors
                first:rounded-t-lg last:rounded-b-lg
                ${lead.status === s.id ? "font-semibold text-white" : "text-gray-400"}`}
            >
              <span className={`h-2 w-2 rounded-full bg-${s.color}-500`} />
              {s.label}
              {lead.status === s.id && <span className="ml-auto text-gray-600">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Lead form ─────────────────────────────────────────────────────────────
interface LeadFormProps {
  onSubmitted: (lead: Lead, log: ApiLog) => void;
  onCancel: () => void;
}

function LeadForm({ onSubmitted, onCancel }: LeadFormProps) {
  const [isPending, startTransition] = useTransition();
  const [apiResult, setApiResult] = useState<ApiLog | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const { lead, log } = await submitLead(fd);
      setApiResult(log);
      onSubmitted(lead, log);
    });
  }

  const input = "w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 transition-colors";

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-6">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-white">New Customer Lead</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Saved locally + pushed to Enerflo via{" "}
            <span className="font-mono">POST /api/v1/partner/action/lead/add</span>
          </p>
        </div>
        <button onClick={onCancel} className="text-sm text-gray-500 hover:text-gray-300">✕ Cancel</button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Personal */}
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-600">Homeowner</p>
          <div className="grid grid-cols-2 gap-3">
            <input name="first_name" required placeholder="First Name *" className={input} />
            <input name="last_name"  required placeholder="Last Name *"  className={input} />
            <input name="email"  type="email" placeholder="Email" className={input} />
            <input name="mobile" type="tel"   placeholder="Mobile phone"  className={input} />
          </div>
        </div>

        {/* Address */}
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-600">Address (required by Enerflo)</p>
          <div className="grid grid-cols-2 gap-3">
            <input name="address" required placeholder="Street Address *" className={`${input} col-span-2`} />
            <input name="city"    required placeholder="City *"           className={input} />
            <div className="grid grid-cols-2 gap-3">
              <input name="state" required placeholder="State *" className={input} maxLength={2} />
              <input name="zip"   required placeholder="ZIP *"   className={input} />
            </div>
          </div>
        </div>

        {/* Assignment */}
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-600">Assignment</p>
          <div className="grid grid-cols-2 gap-3">
            <input name="assign_to_email" type="email" placeholder="Sales Rep email"  className={input} />
            <input name="setter_email"    type="email" placeholder="Setter email"     className={input} />
            <input name="office_name"              placeholder="Office name"         className={input} />
            <input name="lead_source"              placeholder="Lead source (e.g. door-knock)" className={input} />
          </div>
        </div>

        {/* Notes */}
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-600">Notes</p>
          <textarea name="notes" rows={2} placeholder="Internal note shown on the customer record in Enerflo"
            className={`${input} resize-none`} />
        </div>

        {/* API result */}
        {apiResult && (
          <div className={`rounded-lg border px-4 py-3 text-xs
            ${apiResult.ok
              ? "border-green-700 bg-green-900/30 text-green-300"
              : "border-yellow-700 bg-yellow-900/20 text-yellow-300"}`}>
            <span className="font-semibold">
              {apiResult.ok ? "✓ Enerflo confirmed" : "⚠ Saved locally"}
            </span>
            {" — "}
            HTTP {apiResult.status ?? "—"}
            {!apiResult.hadApiKey && " (no API key yet, response expected once key is set)"}
          </div>
        )}

        <div className="flex justify-end gap-3">
          <button type="button" onClick={onCancel}
            className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-400 hover:text-gray-200 transition-colors">
            Cancel
          </button>
          <button type="submit" disabled={isPending}
            className="rounded-lg bg-orange-600 px-5 py-2 text-sm font-semibold text-white
                       hover:bg-orange-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
            {isPending ? "Submitting…" : "Submit Lead"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Lead row ──────────────────────────────────────────────────────────────
function LeadRow({
  lead,
  onUpdate,
  onDelete,
}: {
  lead: Lead;
  onUpdate: (l: Lead) => void;
  onDelete: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      await removeLead(lead.id);
      onDelete(lead.id);
    });
  }

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
      {/* Summary row */}
      <div className="flex flex-wrap items-center gap-3 px-5 py-4">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-white">
            {lead.first_name} {lead.last_name}
          </p>
          <p className="text-xs text-gray-500 truncate">
            {lead.address}, {lead.city}, {lead.state} {lead.zip}
          </p>
        </div>
        <StatusBadge status={lead.status} />
        <StatusDropdown lead={lead} onUpdate={onUpdate} />
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          {expanded ? "▲ Less" : "▼ Details"}
        </button>
      </div>

      {/* Stepper always visible */}
      <div className="border-t border-gray-800/60 px-5 py-3">
        <PipelineStepper current={lead.status} />
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-gray-800 px-5 py-4 space-y-3">
          <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-xs">
            <Detail label="Email"      value={lead.email} />
            <Detail label="Mobile"     value={lead.mobile} />
            <Detail label="Lead Source" value={lead.lead_source} />
            <Detail label="Office"     value={lead.office_name} />
            <Detail label="Sales Rep"  value={lead.assign_to_email} />
            <Detail label="Setter"     value={lead.setter_email} />
            <Detail label="Enerflo ID" value={lead.enerfloCustomerId || "—"} />
            <Detail label="Local ID"   value={lead.id} mono />
            <Detail label="Created"    value={new Date(lead.createdAt).toLocaleString()} />
            <Detail label="Updated"    value={new Date(lead.updatedAt).toLocaleString()} />
          </div>
          {lead.notes && (
            <p className="rounded bg-gray-800 px-3 py-2 text-xs text-gray-400">
              <span className="text-gray-600">Note: </span>{lead.notes}
            </p>
          )}

          {/* History */}
          {lead.history.length > 0 && (
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-600">Status History</p>
              <div className="space-y-1">
                {lead.history.map((h, i) => (
                  <p key={i} className="text-[11px] text-gray-500">
                    {new Date(h.at).toLocaleString()} — {h.from} → <span className="text-gray-300">{h.to}</span>
                    {h.note && <span className="text-gray-600"> ({h.note})</span>}
                  </p>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end pt-1">
            <button
              onClick={handleDelete}
              disabled={isPending}
              className="text-xs text-red-500 hover:text-red-400 disabled:opacity-50 transition-colors"
            >
              {isPending ? "Deleting…" : "Delete lead"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Detail({ label, value, mono }: { label: string; value?: string; mono?: boolean }) {
  return (
    <div>
      <span className="text-gray-600">{label}: </span>
      <span className={`text-gray-300 ${mono ? "font-mono" : ""}`}>{value || "—"}</span>
    </div>
  );
}

// ── Main section ──────────────────────────────────────────────────────────
interface Props {
  onLog: (log: ApiLog) => void;
}

export default function PipelineSection({ onLog }: Props) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState<PipelineStageId | "all">("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLeads().then((l) => { setLeads(l); setLoading(false); });
  }, []);

  function handleSubmitted(lead: Lead, log: ApiLog) {
    setLeads((prev) => [lead, ...prev]);
    setShowForm(false);
    onLog(log);
  }

  function handleUpdate(updated: Lead) {
    setLeads((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
  }

  function handleDelete(id: string) {
    setLeads((prev) => prev.filter((l) => l.id !== id));
  }

  const filtered = filter === "all" ? leads : leads.filter((l) => l.status === filter);

  // Count per stage
  const counts: Record<string, number> = { all: leads.length };
  PIPELINE_STAGES.forEach((s) => {
    counts[s.id] = leads.filter((l) => l.status === s.id).length;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white">Customer Pipeline</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Track homeowners from first contact through installation.
          </p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white
                     hover:bg-orange-500 transition-colors"
        >
          + New Lead
        </button>
      </div>

      {/* Lead form */}
      {showForm && (
        <LeadForm onSubmitted={handleSubmitted} onCancel={() => setShowForm(false)} />
      )}

      {/* Stage summary cards */}
      <div className="grid grid-cols-4 gap-3 xl:grid-cols-7">
        {PIPELINE_STAGES.map((s) => (
          <button
            key={s.id}
            onClick={() => setFilter((prev) => (prev === s.id ? "all" : s.id))}
            className={`rounded-lg border p-3 text-left transition-colors
              ${filter === s.id
                ? `${STATUS_STYLE[s.color]} border-current`
                : "border-gray-800 bg-gray-900 hover:border-gray-700"
              }`}
          >
            <p className="text-2xl font-bold text-white">{counts[s.id] ?? 0}</p>
            <p className="mt-0.5 text-[11px] text-gray-500 leading-tight">{s.label}</p>
          </button>
        ))}
      </div>

      {/* Filter pill */}
      {filter !== "all" && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-400">
            Showing: <span className="text-white font-medium">
              {PIPELINE_STAGES.find((s) => s.id === filter)?.label}
            </span>
          </span>
          <button onClick={() => setFilter("all")} className="text-xs text-gray-600 hover:text-gray-400">
            ✕ Clear filter
          </button>
        </div>
      )}

      {/* Lead list */}
      {loading ? (
        <p className="text-sm text-gray-600">Loading leads…</p>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-800 py-20 text-center">
          <p className="text-3xl">🏠</p>
          <p className="mt-3 text-base font-medium text-gray-400">
            {filter === "all" ? "No leads yet" : `No leads in "${PIPELINE_STAGES.find((s) => s.id === filter)?.label}"`}
          </p>
          <p className="mt-1 text-sm text-gray-600">
            {filter === "all"
              ? 'Click "+ New Lead" to capture your first homeowner.'
              : "Try a different filter or add a new lead."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((lead) => (
            <LeadRow key={lead.id} lead={lead} onUpdate={handleUpdate} onDelete={handleDelete} />
          ))}
        </div>
      )}
    </div>
  );
}
