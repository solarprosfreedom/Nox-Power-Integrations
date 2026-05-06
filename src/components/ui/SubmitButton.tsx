"use client";
import { useFormStatus } from "react-dom";

interface Props {
  label: string;
}

export default function SubmitButton({ label }: Props) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white
                 transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? "Sending…" : label}
    </button>
  );
}
