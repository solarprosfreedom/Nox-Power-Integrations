import type { SequifiUserRecord } from "@/lib/onboarding/types";
import { env } from "@/lib/env";

export function normalizeEmail(email: string): string {
  const trimmed = email.trim().toLowerCase();
  const [local, domain] = trimmed.split("@");
  if (!local || !domain) return trimmed;
  const baseLocal = local.split("+")[0] ?? local;
  return `${baseLocal}@${domain}`;
}

export function sequifiUserFromApi(raw: Record<string, unknown>): SequifiUserRecord | null {
  const id = typeof raw.id === "number" ? raw.id : Number(raw.id);
  const employee_id = String(raw.employee_id ?? "").trim();
  const email = String(raw.email ?? "").trim();
  if (!Number.isFinite(id) || !employee_id || !email) return null;

  return {
    id,
    employee_id,
    first_name: String(raw.first_name ?? "").trim(),
    last_name: String(raw.last_name ?? "").trim(),
    email,
    mobile_no: raw.mobile_no != null ? String(raw.mobile_no) : null,
    position_name: raw.position_name != null ? String(raw.position_name) : null,
    sub_position_name: raw.sub_position_name != null ? String(raw.sub_position_name) : null,
    office_name: raw.office_name != null ? String(raw.office_name) : null,
    worker_type: raw.worker_type != null ? String(raw.worker_type) : null,
    status_id: typeof raw.status_id === "number" ? raw.status_id : null,
    created_at: raw.created_at != null ? String(raw.created_at) : null,
    updated_at: raw.updated_at != null ? String(raw.updated_at) : null,
    raw,
  };
}

/** Display / job label — sub-position is the operational role when present. */
export function sequifiRoleLabel(
  user: Pick<SequifiUserRecord, "sub_position_name" | "position_name" | "office_name">,
): string | null {
  return (
    user.sub_position_name?.trim() ||
    user.position_name?.trim() ||
    user.office_name?.trim() ||
    null
  );
}

export function buildWorkUpn(firstName: string, lastName: string, domain: string): string {
  const local = `${firstName}${lastName}`
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return `${local || "user"}@${domain}`;
}

/** @deprecated Per-installer +alias emails removed — use buildWorkUpn for company email. */
export function auroraEmailFromName(firstName: string, lastName: string, domain?: string): string {
  return buildWorkUpn(firstName, lastName, domain ?? (env.msDefaultDomain?.trim() || "noxpwr.com"));
}

export function generateTempPassword(length = 14): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$";
  let out = "";
  for (let i = 0; i < length; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}
