import type { Metadata } from "next";
import { redirect } from "next/navigation";
import InactiveRepLogsTab from "@/components/tabs/InactiveRepLogsTab";
import { getInactiveRepSession } from "@/lib/auth/require-inactive-reps";
import InactiveRepSignOutButton from "./InactiveRepSignOutButton";

export const metadata: Metadata = {
  title: "Inactive Rep Review · Nox Power",
};

export const dynamic = "force-dynamic";

export default async function InactiveRepPage() {
  const session = await getInactiveRepSession();
  if (!session) redirect("/inactive-reps/login");

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <header className="border-b border-gray-800 bg-gray-900/70 px-5 py-3">
        <div className="mx-auto flex max-w-[110rem] items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-white">Nox Power</p>
            <p className="text-xs text-gray-500">Inactive Rep Review</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-gray-500 sm:inline">{session.email}</span>
            <InactiveRepSignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[110rem] px-5 py-6 lg:px-8 lg:py-8">
        <InactiveRepLogsTab />
      </main>
    </div>
  );
}
