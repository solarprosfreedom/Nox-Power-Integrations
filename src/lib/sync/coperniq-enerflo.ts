import { env } from "@/lib/env";
import { fetchAllCoperniqProjects, type CoperniqProjectRecord } from "@/lib/coperniq/client";
import { getEnerfloIntegrationRecordId } from "@/lib/sync/account-matcher";

export interface CoperniqToEnerfloRow {
  coperniqProjectId: string;
  title: string;
  name: string;
  email: string;
  phone: string;
  addressLine1: string;
  city: string;
  stateCode: string;
  zip: string;
  addressFull: string;
  systemSize: number | null;
  systemPrice: number | null;
  trades: string[];
  status: string;
  /** Enerflo customer id if already linked */
  enerfloCustomerId: string | null;
  action: "create" | "skip";
  /** Payload preview for UI expand */
  enerfloPayload: Record<string, unknown>;
}

export function parseUsAddress(full: string): {
  addressLine1: string;
  city: string;
  stateCode: string;
  zip: string;
} {
  const t = full.trim();
  if (!t) return { addressLine1: "Unknown", city: "Unknown", stateCode: "XX", zip: "00000" };

  const m = t.match(/^(.+?),\s*([^,]+),\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)\s*$/);
  if (m) {
    return {
      addressLine1: m[1]!.trim(),
      city: m[2]!.trim(),
      stateCode: m[3]!.toUpperCase(),
      zip: m[4]!.trim(),
    };
  }

  const parts = t.split(",").map(s => s.trim()).filter(Boolean);
  if (parts.length >= 3) {
    const last = parts[parts.length - 1]!;
    const stateZip = last.match(/^([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
    if (stateZip) {
      return {
        addressLine1: parts.slice(0, -2).join(", ") || parts[0]!,
        city: parts[parts.length - 2]!,
        stateCode: stateZip[1]!.toUpperCase(),
        zip: stateZip[2]!,
      };
    }
  }

  return { addressLine1: t, city: "Unknown", stateCode: "XX", zip: "00000" };
}

function splitTitleName(title: string): { firstName: string; lastName: string; fullName: string } {
  const t = title.trim() || "Coperniq Project";
  const parts = t.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "Coperniq", lastName: "Project", fullName: "Coperniq Project" };
  if (parts.length === 1) return { firstName: parts[0]!, lastName: "Project", fullName: parts[0]! };
  return {
    firstName: parts[0]!,
    lastName: parts.slice(1).join(" "),
    fullName: t,
  };
}

function digitsOnlyPhone(phone: string): string {
  return phone.replace(/\D/g, "").slice(-10) || phone.replace(/\D/g, "");
}

async function fetchEnerfloCustomersByExternalIds(
  enerfloBase: string,
  enerfloKey: string,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (let page = 1; page <= 50; page++) {
    try {
      const res = await fetch(`${enerfloBase}/api/v1/customers?page=${page}&pageSize=100`, {
        method: "GET",
        headers: { "api-key": enerfloKey, "Content-Type": "application/json" },
      });
      if (!res.ok) break;
      const parsed = JSON.parse(await res.text()) as Record<string, unknown>;
      const list = (
        (Array.isArray(parsed.data) ? parsed.data : null) ??
        (Array.isArray(parsed.customers) ? parsed.customers : null) ??
        (Array.isArray(parsed.results) ? parsed.results : null) ??
        []
      ) as Record<string, unknown>[];
      if (!list.length) break;
      for (const c of list) {
        const ext = getEnerfloIntegrationRecordId(c);
        const id = String(c.id ?? c.customer_id ?? "").trim();
        if (ext && id) map.set(ext, id);
        const integrations = c.integrations as Record<string, unknown> | undefined;
        for (const group of Object.values(integrations ?? {})) {
          if (!group || typeof group !== "object") continue;
          for (const entry of Object.values(group as Record<string, unknown>)) {
            if (!entry || typeof entry !== "object") continue;
            const rec = entry as Record<string, unknown>;
            const recId = String(rec.integration_record_id ?? "").trim();
            const enerfloId = String(rec.enerflo_id ?? c.id ?? "").trim();
            if (recId && enerfloId) map.set(recId, enerfloId);
          }
        }
      }
      if (list.length < 100) break;
    } catch {
      break;
    }
  }
  return map;
}

function buildEnerfloPayload(project: CoperniqProjectRecord): {
  row: Omit<CoperniqToEnerfloRow, "action" | "enerfloCustomerId">;
  payload: Record<string, unknown>;
} {
  const { firstName, lastName, fullName } = splitTitleName(project.title);
  const addr = parseUsAddress(project.addressFull);
  const phone = digitsOnlyPhone(project.primaryPhone);
  const email = project.primaryEmail || `coperniq-${project.id}@import.local`;

  const surveyTypeId = env.enerfloSurveyTypeId?.trim();
  const assignTo = env.defaultOwnerEmail?.trim() || env.enerfloDefaultAssignEmail?.trim() || "";

  const base: Record<string, unknown> = {
    first_name: firstName,
    last_name: lastName,
    address: addr.addressLine1,
    city: addr.city,
    state: addr.stateCode,
    zip: addr.zip,
    email,
    mobile: phone || "0000000000",
    customer_integration_id: project.id,
    customer_integration_record_type: "CoperniqProject",
    lead_source: "Coperniq",
    notes: `Imported from Coperniq project #${project.id}${project.trades.length ? ` (${project.trades.join(", ")})` : ""}`,
  };

  if (assignTo) base.assign_to_email = assignTo;

  let payload: Record<string, unknown>;

  if (surveyTypeId) {
    payload = {
      ...base,
      survey_type_id: surveyTypeId,
      install_integration_id: project.id,
      install_integration_record_type: "CoperniqProject",
      ...(project.systemPrice != null ? { system_cost: String(project.systemPrice) } : {}),
      ...(project.systemSize != null ? { system_size: String(project.systemSize) } : {}),
    };
  } else {
    payload = {
      lead: {
        ...base,
        integration_record_id: project.id,
      },
    };
  }

  const row: Omit<CoperniqToEnerfloRow, "action" | "enerfloCustomerId"> = {
    coperniqProjectId: project.id,
    title: project.title,
    name: fullName,
    email: project.primaryEmail,
    phone: project.primaryPhone,
    addressLine1: addr.addressLine1,
    city: addr.city,
    stateCode: addr.stateCode,
    zip: addr.zip,
    addressFull: project.addressFull,
    systemSize: project.systemSize,
    systemPrice: project.systemPrice,
    trades: project.trades,
    status: project.status,
    enerfloPayload: payload,
  };

  return { row, payload };
}

export async function buildCoperniqToEnerfloPreview(): Promise<{
  rows: CoperniqToEnerfloRow[];
  errors: string[];
  missingConfig: string[];
}> {
  const errors: string[] = [];
  const missingConfig: string[] = [];

  if (!env.coperniqApiKey?.trim()) missingConfig.push("COPERNIQ_API_KEY");
  if (!env.enerfloV1ApiKey?.trim()) missingConfig.push("ENERFLO_V1_API_KEY");
  if (!env.enerfloSurveyTypeId?.trim()) {
    missingConfig.push("ENERFLO_SURVEY_TYPE_ID (optional — uses lead/add without install if unset)");
  }
  if (!env.defaultOwnerEmail?.trim() && !env.enerfloDefaultAssignEmail?.trim()) {
    missingConfig.push("DEFAULT_OWNER_EMAIL or ENERFLO_DEFAULT_ASSIGN_EMAIL (required for lead-installs)");
  }

  const { projects, error } = await fetchAllCoperniqProjects();
  if (error) errors.push(error);

  const enerfloBase = (env.enerfloV1BaseUrl ?? "https://enerflo.io").replace(/\/$/, "");
  const enerfloKey = env.enerfloV1ApiKey ?? "";
  const linkedByExternalId = enerfloKey
    ? await fetchEnerfloCustomersByExternalIds(enerfloBase, enerfloKey)
    : new Map<string, string>();

  const rows: CoperniqToEnerfloRow[] = projects.map(project => {
    const { row, payload } = buildEnerfloPayload(project);
    const existingId =
      linkedByExternalId.get(project.id) ??
      linkedByExternalId.get(`coperniq-${project.id}`) ??
      null;
    return {
      ...row,
      enerfloPayload: payload,
      enerfloCustomerId: existingId,
      action: existingId ? "skip" : "create",
    };
  });

  rows.sort((a, b) => {
    if (a.action === b.action) return a.title.localeCompare(b.title);
    return a.action === "create" ? -1 : 1;
  });

  return { rows, errors, missingConfig };
}

export interface CoperniqExecuteResultRow {
  id: string;
  status: "created" | "error" | "skipped";
  targetId?: string;
  error?: string;
}

export async function executeCoperniqToEnerflo(
  rows: CoperniqToEnerfloRow[],
): Promise<CoperniqExecuteResultRow[]> {
  const enerfloBase = (env.enerfloV1BaseUrl ?? "https://enerflo.io").replace(/\/$/, "");
  const enerfloKey = env.enerfloV1ApiKey ?? "";
  const surveyTypeId = env.enerfloSurveyTypeId?.trim();
  const results: CoperniqExecuteResultRow[] = [];

  for (const row of rows) {
    if (row.action === "skip") {
      results.push({
        id: row.coperniqProjectId,
        status: "skipped",
        targetId: row.enerfloCustomerId ?? undefined,
      });
      continue;
    }

    try {
      const path = surveyTypeId ? "/api/v1/lead-installs" : "/api/v1/partner/action/lead/add";
      const res = await fetch(`${enerfloBase}${path}`, {
        method: "POST",
        headers: { "api-key": enerfloKey, "Content-Type": "application/json" },
        body: JSON.stringify(row.enerfloPayload),
      });
      const text = await res.text();
      if (!res.ok) {
        results.push({
          id: row.coperniqProjectId,
          status: "error",
          error: text.slice(0, 400),
        });
        continue;
      }

      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(text) as Record<string, unknown>;
      } catch { /* ignore */ }
      const data = (parsed.data ?? parsed) as Record<string, unknown>;
      const customerId =
        data?.customer_id ??
        parsed.customer_id ??
        (data?.customer as Record<string, unknown> | undefined)?.id ??
        data?.id;

      results.push({
        id: row.coperniqProjectId,
        status: "created",
        targetId: customerId != null ? String(customerId) : undefined,
      });
    } catch (e) {
      results.push({
        id: row.coperniqProjectId,
        status: "error",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return results;
}
