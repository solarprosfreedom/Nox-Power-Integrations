"use client";

import { useState, useTransition } from "react";
import { addAutomation } from "@/app/actions/automations";
import {
  TRIGGER_EVENTS,
  ACTION_OPERATIONS,
  SYSTEM_META,
  type Automation,
  type AutomationSystem,
} from "@/lib/automations-types";

const SYSTEMS: AutomationSystem[] = ["enerflo", "sequifi", "terros"];

interface Props {
  onCreated: (automation: Automation) => void;
  onCancel: () => void;
}

export default function AutomationBuilder({ onCreated, onCancel }: Props) {
  const [triggerSystem, setTriggerSystem] = useState<AutomationSystem>("sequifi");
  const [actionSystem,  setActionSystem]  = useState<AutomationSystem>("enerflo");
  const [isPending, startTransition] = useTransition();

  const triggerEvents    = TRIGGER_EVENTS[triggerSystem];
  const actionOperations = ACTION_OPERATIONS[actionSystem];
  const triggerMeta      = SYSTEM_META[triggerSystem];
  const actionMeta       = SYSTEM_META[actionSystem];

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("trigger_system", triggerSystem);
    fd.set("action_system",  actionSystem);

    // Resolve labels from selected values
    const tEvt = fd.get("trigger_event") as string;
    const aOp  = fd.get("action_operation") as string;
    fd.set("trigger_event_label",     triggerEvents.find((e) => e.id === tEvt)?.label ?? tEvt);
    fd.set("action_operation_label",  actionOperations.find((o) => o.id === aOp)?.label ?? aOp);

    // Auto-fill endpoint + method from selected operation
    const op = actionOperations.find((o) => o.id === aOp);
    if (op) {
      if (!fd.get("action_endpoint")) fd.set("action_endpoint", op.endpoint);
      fd.set("action_method", op.method);
    }

    startTransition(async () => {
      const created = await addAutomation(fd);
      onCreated(created);
    });
  }

  const selectCls = "w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2.5 text-sm text-white outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 transition-colors";
  const inputCls  = "w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2.5 text-sm text-white placeholder-gray-500 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 transition-colors";

  return (
    <div className="rounded-xl border border-teal-800 bg-gray-900 p-6">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-white">New Automation</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Define a trigger and an action — the middleware will connect them.
          </p>
        </div>
        <button onClick={onCancel} className="text-sm text-gray-500 hover:text-gray-300">
          ✕
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Name + description */}
        <div className="grid grid-cols-1 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-400">
              Automation Name <span className="text-red-400">*</span>
            </label>
            <input name="name" required placeholder="e.g. Deal Signed → Push Stats" className={inputCls} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-400">Description</label>
            <textarea
              name="description"
              rows={2}
              placeholder="What does this automation do?"
              className={`${inputCls} resize-none`}
            />
          </div>
        </div>

        {/* Visual flow */}
        <div className="flex items-start gap-4">
          {/* Trigger */}
          <div className="flex-1 rounded-lg border border-gray-700 bg-gray-800/50 p-4">
            <div className="mb-3 flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${triggerMeta.dot}`} />
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">When (Trigger)</p>
            </div>

            <label className="mb-1 block text-xs font-medium text-gray-400">Source System</label>
            <select
              value={triggerSystem}
              onChange={(e) => setTriggerSystem(e.target.value as AutomationSystem)}
              className={`${selectCls} mb-3`}
            >
              {SYSTEMS.map((s) => (
                <option key={s} value={s}>{SYSTEM_META[s].label}</option>
              ))}
            </select>

            <label className="mb-1 block text-xs font-medium text-gray-400">Event</label>
            <select name="trigger_event" required className={selectCls}>
              {triggerEvents.map((e) => (
                <option key={e.id} value={e.id}>{e.label}</option>
              ))}
            </select>
          </div>

          {/* Arrow */}
          <div className="flex flex-col items-center justify-center pt-12">
            <div className="text-2xl text-teal-600">→</div>
          </div>

          {/* Action */}
          <div className="flex-1 rounded-lg border border-gray-700 bg-gray-800/50 p-4">
            <div className="mb-3 flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${actionMeta.dot}`} />
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Do (Action)</p>
            </div>

            <label className="mb-1 block text-xs font-medium text-gray-400">Target System</label>
            <select
              value={actionSystem}
              onChange={(e) => setActionSystem(e.target.value as AutomationSystem)}
              className={`${selectCls} mb-3`}
            >
              {SYSTEMS.map((s) => (
                <option key={s} value={s}>{SYSTEM_META[s].label}</option>
              ))}
            </select>

            <label className="mb-1 block text-xs font-medium text-gray-400">Operation</label>
            <select name="action_operation" required className={`${selectCls} mb-3`}>
              {actionOperations.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>

            <label className="mb-1 block text-xs font-medium text-gray-400">
              Endpoint <span className="text-gray-600">(auto-filled, edit if needed)</span>
            </label>
            <input
              name="action_endpoint"
              placeholder={actionOperations[0]?.endpoint ?? "/api/..."}
              className={inputCls}
            />
          </div>
        </div>

        {/* Field mapping */}
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-400">
            Field Mapping{" "}
            <span className="text-gray-600 font-normal">
              (one per line: <span className="font-mono">source.field -{">"} target_field</span>)
            </span>
          </label>
          <textarea
            name="field_mapping"
            rows={4}
            placeholder={`employee.first_name -> first_name\nemployee.last_name -> last_name\nemployee.email -> email`}
            className={`${inputCls} resize-none font-mono text-xs`}
          />
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 border-t border-gray-800 pt-4">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-400 hover:text-gray-200 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isPending}
            className="rounded-lg bg-teal-600 px-5 py-2 text-sm font-semibold text-white
                       hover:bg-teal-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isPending ? "Creating…" : "Create Automation"}
          </button>
        </div>
      </form>
    </div>
  );
}
