"use client";

import { type FormEvent, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function safeDestination(value: string | null): string {
  if (value === "/inactive-reps" || value?.startsWith("/inactive-reps?")) return value;
  return "/inactive-reps";
}

export default function InactiveRepLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resendSeconds, setResendSeconds] = useState(0);

  useEffect(() => {
    if (resendSeconds <= 0) return;
    const timer = window.setTimeout(() => setResendSeconds(value => value - 1), 1_000);
    return () => window.clearTimeout(timer);
  }, [resendSeconds]);

  async function requestCode(): Promise<boolean> {
    setError(null);
    setMessage(null);
    const response = await fetch("/api/inactive-reps/auth/request-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
    };
    if (!response.ok) {
      setError(payload.error ?? "Unable to send the sign-in code");
      return false;
    }
    setMessage(payload.message ?? "If this email is approved, a sign-in code has been sent.");
    setResendSeconds(60);
    return true;
  }

  async function handleEmailSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    try {
      if (await requestCode()) setStep("code");
    } catch {
      setError("Network error — try again");
    } finally {
      setLoading(false);
    }
  }

  async function handleCodeSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const response = await fetch("/api/inactive-reps/auth/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Unable to verify the sign-in code");
        return;
      }
      router.push(safeDestination(searchParams.get("from")));
      router.refresh();
    } catch {
      setError("Network error — try again");
    } finally {
      setLoading(false);
    }
  }

  async function resendCode() {
    if (resendSeconds > 0 || loading) return;
    setLoading(true);
    try {
      await requestCode();
    } catch {
      setError("Network error — try again");
    } finally {
      setLoading(false);
    }
  }

  function changeEmail() {
    setStep("email");
    setCode("");
    setMessage(null);
    setError(null);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-950 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-cyan-900/70 bg-cyan-950/40 text-xl text-cyan-300">
            ◷
          </div>
          <h1 className="mt-4 text-xl font-bold text-white">Inactive Rep Review</h1>
          <p className="mt-1 text-sm text-gray-500">
            {step === "email"
              ? "Enter your approved Nox Power email"
              : "Enter the one-time code from your email"}
          </p>
        </div>

        {step === "email" ? (
          <form
            onSubmit={handleEmailSubmit}
            className="space-y-4 rounded-2xl border border-gray-800 bg-gray-900 p-6 shadow-xl"
          >
            <div className="flex flex-col gap-1.5">
              <label htmlFor="inactive-rep-email" className="text-sm font-medium text-gray-300">
                Email
              </label>
              <input
                id="inactive-rep-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={event => setEmail(event.target.value)}
                className="rounded-lg border border-gray-700 bg-gray-800 px-4 py-2.5 text-sm text-white outline-none focus:border-cyan-600 focus:ring-1 focus:ring-cyan-600"
                placeholder="name@noxpwr.com"
              />
            </div>

            {error && (
              <p className="rounded-lg border border-red-900/50 bg-red-950/50 px-3 py-2 text-sm text-red-300">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-cyan-700 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-cyan-600 disabled:cursor-wait disabled:opacity-50"
            >
              {loading ? "Sending code…" : "Send sign-in code"}
            </button>
          </form>
        ) : (
          <form
            onSubmit={handleCodeSubmit}
            className="space-y-4 rounded-2xl border border-gray-800 bg-gray-900 p-6 shadow-xl"
          >
            <div className="rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-2 text-sm text-gray-400">
              <span className="block truncate text-gray-200">{email}</span>
              <button
                type="button"
                onClick={changeEmail}
                className="mt-1 text-xs font-medium text-cyan-400 hover:text-cyan-300"
              >
                Use a different email
              </button>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="inactive-rep-code" className="text-sm font-medium text-gray-300">
                Six-digit code
              </label>
              <input
                id="inactive-rep-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                autoFocus
                value={code}
                onChange={event => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                className="rounded-lg border border-gray-700 bg-gray-800 px-4 py-3 text-center font-mono text-xl tracking-[0.4em] text-white outline-none focus:border-cyan-600 focus:ring-1 focus:ring-cyan-600"
                placeholder="000000"
              />
            </div>

            {message && !error && (
              <p className="rounded-lg border border-cyan-900/50 bg-cyan-950/30 px-3 py-2 text-sm text-cyan-200">
                {message}
              </p>
            )}
            {error && (
              <p className="rounded-lg border border-red-900/50 bg-red-950/50 px-3 py-2 text-sm text-red-300">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading || code.length !== 6}
              className="w-full rounded-lg bg-cyan-700 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-cyan-600 disabled:cursor-wait disabled:opacity-50"
            >
              {loading ? "Verifying…" : "Verify and sign in"}
            </button>

            <button
              type="button"
              onClick={() => void resendCode()}
              disabled={loading || resendSeconds > 0}
              className="w-full text-sm font-medium text-gray-400 hover:text-gray-200 disabled:cursor-wait disabled:text-gray-600"
            >
              {resendSeconds > 0 ? `Resend code in ${resendSeconds}s` : "Resend code"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
