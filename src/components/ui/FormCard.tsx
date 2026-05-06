import type { ReactNode } from "react";

interface Props {
  title: string;
  subtitle?: string;
  children: ReactNode;
}

export default function FormCard({ title, subtitle, children }: Props) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-8 shadow-xl">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-white">{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-gray-400">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}
