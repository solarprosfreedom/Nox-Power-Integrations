"use client";

import { useState } from "react";
import { createEnerfloUser } from "@/app/actions/enerflo";
import FormCard from "@/components/ui/FormCard";
import Field from "@/components/ui/Field";
import SubmitButton from "@/components/ui/SubmitButton";
import ResultBanner from "@/components/ui/ResultBanner";
import type { ApiLog } from "@/lib/logger";

// Ref: https://docs.enerflo.io/docs/legend-of-user-roles
const ROLE_OPTIONS = [
  "Admin",
  "Office Admin",
  "Manager",
  "Sales Rep",
  "Setter",
  "Site Surveyor",
  "Installer",
  "Customer Service",
];

const TIMEZONES = [
  { value: "", label: "— Select timezone —" },
  { value: "Pacific/Honolulu", label: "Hawaii (Pacific/Honolulu)" },
  { value: "America/Juneau", label: "Alaska (America/Juneau)" },
  { value: "America/Los_Angeles", label: "Pacific (America/Los_Angeles)" },
  { value: "America/Phoenix", label: "Arizona (America/Phoenix)" },
  { value: "America/Denver", label: "Mountain (America/Denver)" },
  { value: "America/Chicago", label: "Central (America/Chicago)" },
  { value: "America/New_York", label: "Eastern (America/New_York)" },
  { value: "Asia/Manila", label: "Philippines (Asia/Manila)" },
];

interface Props {
  onLog: (log: ApiLog) => void;
}

export default function CreateUserTab({ onLog }: Props) {
  const [lastLog, setLastLog] = useState<ApiLog | null>(null);
  const [selectedRoles, setSelectedRoles] = useState<string[]>(["Sales Rep"]);

  function toggleRole(role: string) {
    setSelectedRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]
    );
  }

  async function handleSubmit(formData: FormData) {
    // Inject selected roles since checkboxes with same name need special handling
    selectedRoles.forEach((r) => formData.append("roles", r));
    const result = await createEnerfloUser(formData);
    setLastLog(result.log);
    onLog(result.log);
  }

  return (
    <FormCard
      title="Create Enerflo User"
      subtitle="Adds a new team member in Enerflo. Sent & logged even without an API key."
    >
      <form action={handleSubmit} className="space-y-6">

        {/* ── Identity ── */}
        <section>
          <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-gray-500">
            Identity
          </h3>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Field name="first_name" label="First Name" placeholder="Jane" />
            <Field name="last_name" label="Last Name" placeholder="Smith" />
            <Field name="email" label="Email" type="email" placeholder="jane@company.com" required />
            <Field name="phone" label="Phone" type="tel" placeholder="+1 555 000 0000" />
          </div>
        </section>

        {/* ── Roles ── */}
        <section>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
            Roles <span className="text-red-400">*</span>
            <span className="ml-2 normal-case font-normal text-gray-600">(select one or more)</span>
          </h3>
          <div className="flex flex-wrap gap-2">
            {ROLE_OPTIONS.map((role) => {
              const active = selectedRoles.includes(role);
              return (
                <button
                  key={role}
                  type="button"
                  onClick={() => toggleRole(role)}
                  className={`rounded-full px-3 py-1 text-sm font-medium border transition-colors
                    ${active
                      ? "bg-indigo-600 border-indigo-500 text-white"
                      : "bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500"
                    }`}
                >
                  {role}
                </button>
              );
            })}
          </div>
          {selectedRoles.length === 0 && (
            <p className="mt-2 text-xs text-red-400">At least one role is required.</p>
          )}
        </section>

        {/* ── Permissions ── */}
        <section>
          <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-gray-500">
            Permissions
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Toggle name="notify_email" label="Send welcome email" defaultChecked={false} />
            <Toggle name="can_create_customers" label="Can create customers / leads" defaultChecked={true} />
            <Toggle name="allow_optimus" label="Access Optimus (proposal tool)" defaultChecked={false} />
            <Toggle name="can_reassign_leads" label="Can reassign leads" defaultChecked={true} />
          </div>
        </section>

        {/* ── Timezone ── */}
        <section>
          <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-gray-500">
            Settings
          </h3>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="timezone" className="text-sm font-medium text-gray-300">
                Timezone
              </label>
              <select
                id="timezone"
                name="timezone"
                className="rounded-lg border border-gray-700 bg-gray-800 px-4 py-2.5 text-sm text-white
                           outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz.value} value={tz.value}>
                    {tz.label}
                  </option>
                ))}
              </select>
            </div>
            <Field
              name="external_user_id"
              label="External User ID"
              placeholder="ID from your CRM (optional)"
            />
          </div>
        </section>

        {/* ── Manager / Office (Sales Rep only) ── */}
        <section>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-500">
            Manager &amp; Office
          </h3>
          <p className="mb-4 text-xs text-gray-600">Only applies when the &ldquo;Sales Rep&rdquo; role is selected.</p>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Field name="manager_email" label="Manager Email" type="email" placeholder="manager@company.com" />
            <Field name="manager_id" label="Manager ID" type="number" placeholder="123" />
            <Field name="office_id" label="Office ID" placeholder="Retrieved from Enerflo settings" />
          </div>
        </section>

        {/* ── Password ── */}
        <section>
          <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-gray-500">
            Password
          </h3>
          <div className="max-w-sm">
            <Field
              name="password"
              label="Password (optional)"
              type="password"
              placeholder="Leave blank — user sets their own"
            />
          </div>
        </section>

        <div className="flex justify-end border-t border-gray-800 pt-6">
          <SubmitButton label="Create User" />
        </div>
      </form>

      <ResultBanner log={lastLog} />
    </FormCard>
  );
}

/* ── inline toggle component ── */
function Toggle({
  name,
  label,
  defaultChecked,
}: {
  name: string;
  label: string;
  defaultChecked: boolean;
}) {
  const [checked, setChecked] = useState(defaultChecked);
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-gray-800 bg-gray-800/40 px-4 py-3">
      <input type="hidden" name={name} value={checked ? "true" : "false"} />
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => setChecked((v) => !v)}
        className={`relative h-5 w-9 rounded-full transition-colors focus:outline-none
          ${checked ? "bg-indigo-600" : "bg-gray-700"}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform
            ${checked ? "translate-x-4" : "translate-x-0"}`}
        />
      </button>
      <span className="text-sm text-gray-300">{label}</span>
    </label>
  );
}
