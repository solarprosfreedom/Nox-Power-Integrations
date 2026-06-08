"use client";

import { useCallback, useEffect, useState } from "react";
import FormCard from "@/components/ui/FormCard";
import {
  renderWelcomeTemplate,
  WELCOME_TEMPLATE_OPTIONS,
  type WelcomeTemplateId,
} from "@/lib/onboarding/welcome-templates";

interface EmailConfig {
  configured: boolean;
  from: string | null;
  defaultTestTo: string | null;
}

export default function WelcomeEmailTab() {
  const [config, setConfig] = useState<EmailConfig | null>(null);
  const [templateId, setTemplateId] = useState<WelcomeTemplateId>("sales_rep");
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [firstName, setFirstName] = useState("Jane");
  const [username, setUsername] = useState("janedoe@noxpwr.com");
  const [password, setPassword] = useState("ChangeMe123!");
  const [installerTabs, setInstallerTabs] = useState("Tron");
  const [onboardAxia, setOnboardAxia] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const applyTemplate = useCallback(
    (id: WelcomeTemplateId) => {
      const parsedInstallers = installerTabs
        .split(/[,;\n]+/)
        .map(s => s.trim())
        .filter(Boolean);
      const { subject: sub, body: b } = renderWelcomeTemplate(id, {
        username,
        password,
        firstName,
        installerTabs: parsedInstallers,
        onboardAxia,
      });
      setSubject(sub);
      setBody(b);
    },
    [username, password, firstName, onboardAxia, installerTabs],
  );

  useEffect(() => {
    fetch("/api/welcome-email/config")
      .then((r) => r.json())
      .then((data: EmailConfig) => {
        setConfig(data);
        if (data.defaultTestTo) setTo(data.defaultTestTo);
      })
      .catch(() => setConfig({ configured: false, from: null, defaultTestTo: null }));
  }, []);

  useEffect(() => {
    applyTemplate(templateId);
  }, [templateId, applyTemplate]);

  function handleTemplateChange(id: WelcomeTemplateId) {
    setTemplateId(id);
  }

  function handleReloadTemplate() {
    applyTemplate(templateId);
  }

  async function handleSend() {
    setResult(null);
    setLoading(true);
    try {
      const res = await fetch("/api/welcome-email/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, subject, body, contentType: "text" }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        from?: string;
        to?: string;
      };
      if (!res.ok) {
        setResult({ ok: false, message: data.error ?? "Send failed" });
        return;
      }
      setResult({
        ok: true,
        message: `Sent from ${data.from} to ${data.to}. Check the inbox (and spam).`,
      });
    } catch {
      setResult({ ok: false, message: "Network error" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <FormCard
      title="Welcome Email (test)"
      subtitle="Send via Microsoft Graph from your configured admin mailbox. Edit the body before sending."
    >
      <div className="space-y-6">
        {config && (
          <div
            className={`rounded-lg border px-4 py-3 text-sm ${
              config.configured
                ? "border-emerald-900/50 bg-emerald-950/30 text-emerald-200"
                : "border-amber-900/50 bg-amber-950/30 text-amber-200"
            }`}
          >
            {config.configured ? (
              <>
                <p className="font-medium">Graph configured</p>
                <p className="mt-1 text-xs opacity-90">
                  From: <span className="font-mono">{config.from}</span>
                </p>
              </>
            ) : (
              <p>
                Add AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, and WELCOME_EMAIL_FROM
                to .env.local, then restart the dev server.
              </p>
            )}
          </div>
        )}

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-gray-300">Template</label>
            <select
              value={templateId}
              onChange={(e) => handleTemplateChange(e.target.value as WelcomeTemplateId)}
              className="rounded-lg border border-gray-700 bg-gray-800 px-4 py-2.5 text-sm text-white outline-none focus:border-indigo-500"
            >
              {WELCOME_TEMPLATE_OPTIONS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <button
              type="button"
              onClick={handleReloadTemplate}
              className="rounded-lg border border-gray-600 px-4 py-2.5 text-sm text-gray-300 hover:bg-gray-800"
            >
              Reload template
            </button>
          </div>
        </section>

        <section>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
            Placeholders (for template)
          </h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm text-gray-400">First name</label>
              <input
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm text-gray-400">Company email (username)</label>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm text-gray-400">Password</label>
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
              />
            </div>
            <div className="flex flex-col justify-end gap-1.5">
              <label className="flex items-center gap-2 text-sm text-gray-400">
                <input
                  type="checkbox"
                  checked={onboardAxia}
                  onChange={(e) => setOnboardAxia(e.target.checked)}
                  className="rounded border-gray-600 bg-gray-800"
                />
                Onboard to Axia
              </label>
            </div>
          </div>
          <div className="mt-4 flex flex-col gap-1.5 sm:max-w-md">
            <label className="text-sm text-gray-400">Installers (comma-separated)</label>
            <input
              value={installerTabs}
              onChange={(e) => setInstallerTabs(e.target.value)}
              placeholder="Tron, EMPWR"
              className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
            />
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-gray-300">To (recipient)</label>
            <input
              type="email"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="personal or test inbox"
              className="rounded-lg border border-gray-700 bg-gray-800 px-4 py-2.5 text-sm text-white outline-none focus:border-indigo-500"
            />
            <p className="text-xs text-gray-500">
              Use a personal email so the rep can read credentials before first Outlook login.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-gray-300">Subject</label>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="rounded-lg border border-gray-700 bg-gray-800 px-4 py-2.5 text-sm text-white outline-none focus:border-indigo-500"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-gray-300">Body</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={18}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-4 py-3 font-mono text-sm text-white outline-none focus:border-indigo-500"
            />
          </div>
        </section>

        {result && (
          <p
            className={`rounded-lg border px-4 py-3 text-sm ${
              result.ok
                ? "border-emerald-900/50 bg-emerald-950/40 text-emerald-200"
                : "border-red-900/50 bg-red-950/40 text-red-300"
            }`}
          >
            {result.message}
          </p>
        )}

        <button
          type="button"
          disabled={loading || !config?.configured || !to.trim()}
          onClick={handleSend}
          className="rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {loading ? "Sending…" : "Send welcome email"}
        </button>
      </div>
    </FormCard>
  );
}
