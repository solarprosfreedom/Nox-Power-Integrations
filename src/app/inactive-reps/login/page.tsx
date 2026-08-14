import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getInactiveRepSession } from "@/lib/auth/require-inactive-reps";
import InactiveRepLoginForm from "./InactiveRepLoginForm";

export const metadata: Metadata = {
  title: "Sign in · Inactive Rep Review · Nox Power",
};

export default async function InactiveRepLoginPage() {
  if (await getInactiveRepSession()) redirect("/inactive-reps");

  return (
    <Suspense
      fallback={(
        <div className="flex min-h-screen items-center justify-center bg-gray-950 text-gray-500">
          Loading…
        </div>
      )}
    >
      <InactiveRepLoginForm />
    </Suspense>
  );
}
