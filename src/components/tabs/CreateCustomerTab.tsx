"use client";

import { useState } from "react";
import { createEnerfloCustomer } from "@/app/actions/enerflo";
import FormCard from "@/components/ui/FormCard";
import Field from "@/components/ui/Field";
import SubmitButton from "@/components/ui/SubmitButton";
import ResultBanner from "@/components/ui/ResultBanner";
import type { ApiLog } from "@/lib/logger";

interface Props {
  onLog: (log: ApiLog) => void;
}

export default function CreateCustomerTab({ onLog }: Props) {
  const [lastLog, setLastLog] = useState<ApiLog | null>(null);

  async function handleSubmit(formData: FormData) {
    const result = await createEnerfloCustomer(formData);
    setLastLog(result.log);
    onLog(result.log);
  }

  return (
    <FormCard
      title="Create Enerflo Customer"
      subtitle="Registers a new homeowner / lead in Enerflo. Always logged — works without API key."
    >
      <form action={handleSubmit} className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field name="first_name" label="First Name" placeholder="John" required />
        <Field name="last_name" label="Last Name" placeholder="Doe" required />
        <Field name="email" label="Email" type="email" placeholder="john@example.com" required />
        <Field name="phone" label="Phone" type="tel" placeholder="+1 555 000 0000" />
        <div className="sm:col-span-2">
          <Field name="address" label="Street Address" placeholder="123 Solar Ave" />
        </div>
        <Field name="city" label="City" placeholder="Phoenix" />
        <Field name="state" label="State" placeholder="AZ" />
        <Field name="zip" label="ZIP" placeholder="85001" />

        <div className="sm:col-span-2 flex justify-end">
          <SubmitButton label="Create Customer" />
        </div>
      </form>

      <ResultBanner log={lastLog} />
    </FormCard>
  );
}
