"use server";

import { enerfloRequest, enerfloV1 } from "@/lib/enerflo/client";
import { getAllLogs, type ApiLog } from "@/lib/logger";

export type ActionResult = { log: ApiLog };

// ── Generic endpoint caller (used by EndpointCard) ────────────────────────
export async function callEnerfloEndpoint(params: {
  operation: string;
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  path: string;
  pathParams?: Record<string, string>;
  query?: Record<string, string>;
  body?: Record<string, unknown>;
}): Promise<ActionResult> {
  const log = await enerfloRequest(params);
  return { log };
}

// ── Create User (detailed form) ───────────────────────────────────────────
export async function createEnerfloUser(formData: FormData): Promise<ActionResult> {
  const rolesRaw = formData.getAll("roles") as string[];
  const roles = rolesRaw.length ? rolesRaw : ["Sales Rep"];

  const payload: Record<string, unknown> = {
    email: formData.get("email") as string,
    roles,
    notify_email: formData.get("notify_email") === "true",
    can_create_customers: formData.get("can_create_customers") !== "false",
    allow_optimus: formData.get("allow_optimus") === "true",
    can_reassign_leads: formData.get("can_reassign_leads") !== "false",
  };

  const optionalStrings = [
    "first_name", "last_name", "phone", "password",
    "timezone", "external_user_id", "manager_email", "office_id",
  ] as const;
  for (const key of optionalStrings) {
    const val = (formData.get(key) as string | null)?.trim();
    if (val) payload[key] = val;
  }

  const managerId = (formData.get("manager_id") as string | null)?.trim();
  if (managerId) payload["manager_id"] = parseInt(managerId, 10);

  const log = await enerfloV1({
    operation: "create_user",
    method: "POST",
    path: "/api/v1/users",
    body: payload,
  });

  return { log };
}

// ── Create Customer (detailed form) ──────────────────────────────────────
export async function createEnerfloCustomer(formData: FormData): Promise<ActionResult> {
  const payload: Record<string, unknown> = {
    first_name: formData.get("first_name") as string,
    last_name: formData.get("last_name") as string,
    email: formData.get("email") as string,
    phone: formData.get("phone") as string,
    address: formData.get("address") as string,
    city: formData.get("city") as string,
    state: formData.get("state") as string,
    zip: formData.get("zip") as string,
  };

  const log = await enerfloV1({
    operation: "create_customer",
    method: "POST",
    path: "/api/v1/customers",
    body: payload,
  });

  return { log };
}

// ── Fetch persisted logs ──────────────────────────────────────────────────
export async function fetchStoredLogs(): Promise<ApiLog[]> {
  return getAllLogs();
}
