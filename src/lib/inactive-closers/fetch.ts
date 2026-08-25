import { env } from "@/lib/env";
import { sequifiFetch } from "@/lib/sequifi/fetch";
import { normalizeEmail } from "@/lib/inactive-reps/identity";
import { listLatestEmailedInactiveRepBatch } from "@/lib/inactive-reps/repository";
import { listFromPayload } from "@/lib/inactive-reps/sources";
import type { CloserPerson, HubProject, SequifiSaleLite } from "@/lib/inactive-closers/types";

const FETCH_TIMEOUT_MS = 45_000;
const SALES_FEEDS = ["axia", "illum", "tron", "empwr", "goodpwr", "owe"] as const;

function requireSetting(value: string | undefined, name: string): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new Error(`${name} is required`);
  return trimmed;
}

async function fetchJson(url: string, init: RequestInit): Promise<Record<string, unknown>> {
  const fetchImpl = url.includes("sequifi.com") ? sequifiFetch : fetch;
  const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), cache: "no-store" });
  const text = await res.text();
  if (!res.ok) throw new Error(`${url} failed (${res.status}): ${text.slice(0, 200)}`);
  return JSON.parse(text) as Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function asNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function remittanceNumbers(value: unknown): Record<string, number | string | null> {
  const remittance = asRecord(value);
  const keys = [
    "partner_commission",
    "partner_incentive",
    "spif",
    "c0",
    "c1",
    "c2",
    "adjusted_c2",
    "c0_paid",
    "c1_paid",
    "c2_paid",
    "incentive_paid",
    "clawback",
    "others",
    "total_sp_paid",
    "pv_size",
  ];
  return Object.fromEntries(keys.map(key => [key, asNumber(remittance[key])]));
}

export async function fetchInactiveSequifiUsers(): Promise<CloserPerson[]> {
  const token = requireSetting(env.sequifiAccessToken ?? env.sequifiApiKey, "SEQUIFI_ACCESS_TOKEN");
  const base = (env.sequifiApiBaseUrl ?? "https://marketplace-api.sequifi.com").replace(/\/$/, "");
  const people: CloserPerson[] = [];
  for (let page = 1; page <= 100; page++) {
    const payload = await fetchJson(`${base}/v1/users?page=${page}&per_page=100&status=inactive`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    const data = asRecord(payload.data);
    const batch = listFromPayload(payload, ["data.users", "users", "data"]);
    for (const row of batch) {
      const id = asNumber(row.id);
      const email = normalizeEmail(row.email);
      const name = `${asString(row.first_name)} ${asString(row.last_name)}`.trim();
      if (id == null || id <= 0 || (!email && !name)) continue;
      people.push({
        id,
        name,
        email,
        role: asString(row.position_name ?? row.sub_position_name),
        source: "sequifi_inactive",
        deactivated: false,
      });
    }
    const lastPage = asNumber(data.last_page ?? payload.last_page) ?? page;
    if (!batch.length || batch.length < 100 || page >= lastPage) break;
  }
  return people;
}

export async function fetchSequifiSales(): Promise<SequifiSaleLite[]> {
  const token = requireSetting(env.sequifiAccessToken ?? env.sequifiApiKey, "SEQUIFI_ACCESS_TOKEN");
  const base = (env.sequifiApiBaseUrl ?? "https://marketplace-api.sequifi.com").replace(/\/$/, "");
  const sales: SequifiSaleLite[] = [];
  for (let page = 1; page <= 500; page++) {
    const payload = await fetchJson(`${base}/v1/sales?per_page=100&page=${page}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    const data = asRecord(payload.data);
    const batch = listFromPayload(payload, ["data.Sales", "data.sales", "Sales", "sales"]);
    for (const row of batch) {
      const pid = asString(row.pid);
      if (!pid) continue;
      const closer = asRecord(row.closer1_detail ?? row.closer1);
      sales.push({
        pid,
        closerId: asNumber(closer.id),
        closerName: `${asString(closer.first_name)} ${asString(closer.last_name)}`.trim(),
        installPartner: asString(row.install_partner),
        totalCommission: asNumber(row.total_commission),
        kw: asNumber(row.system_size_kw) ?? asNumber(row.system_size) ?? asNumber(row.kw),
        customerAddress: asString(row.customer_address),
        customerState: asString(row.customer_state),
        customerZip: asString(row.customer_zip),
      });
    }
    const lastPage = asNumber(data.last_page) ?? page;
    if (!batch.length || batch.length < 100 || page >= lastPage) break;
  }
  return sales;
}

export async function fetchHubProjects(): Promise<HubProject[]> {
  const key = requireSetting(env.publicDealsApiKey, "PUBLIC_DEALS_API_KEY");
  const base = (env.publicDealsApiBase ?? "https://hub.noxpwr.com/api/public/deals").replace(/\/$/, "");
  const projects: HubProject[] = [];
  for (const installer of SALES_FEEDS) {
    for (let page = 1; page <= 500; page++) {
      const payload = await fetchJson(`${base}/${installer}?page=${page}&limit=100`, {
        headers: { "x-api-key": key, Accept: "application/json" },
      });
      const batch = listFromPayload(payload, ["data", "deals", "results", "items"]);
      for (const row of batch) {
        const project = asRecord(row.project);
        const raw = asRecord(row.raw);
        const projectId = asString(project.project_id) || asString(row.pk_value);
        if (!projectId) continue;
        projects.push({
          projectId,
          projectName: asString(project.opportunity_name),
          addressLine1: asString(project.address_line1) || asString(raw.address) || asString(raw.address_line1),
          city: asString(project.city) || asString(raw.city) || asString(raw.contact_city),
          state: asString(project.state_code) || asString(raw.state_code) || asString(raw.state),
          zip: asString(project.postal_code) || asString(raw.postal_code) || asString(raw.zip),
          installer: asString(project.installer) || asString(row.installer) || installer,
          closerName: asString(project.closer_name) || asString(raw.closer_name),
          closerEmail: asString(project.closer_email) || asString(raw.closer_email),
          setterName: asString(project.setter_name),
          setterEmail: asString(project.setter_email),
          salesAdvisorName: asString(project.sales_advisor_name) || asString(raw.sales_advisor_name),
          salesAdvisorEmail: asString(project.sales_advisor_email) || asString(raw.sales_advisor_email),
          sequifiPid: asString(project.sequifi_pid),
          systemSizeKw: asNumber(project.system_size_kw),
          remittance: remittanceNumbers(row.remittance),
        });
      }
      const hasMore = payload.hasMore === true;
      const total = asNumber(payload.total) ?? projects.length;
      if (!batch.length || (!hasMore && page * 100 >= total)) break;
    }
  }
  return projects;
}

export async function fetchDeactivatedCloserPeople(): Promise<CloserPerson[]> {
  try {
    const batch = await listLatestEmailedInactiveRepBatch();
    if (!batch) return [];
    return batch.candidates.flatMap(candidate => {
      if (!/closer/i.test(candidate.role)) return [];
      return [{
        id: candidate.sequifiUserId ? Number(candidate.sequifiUserId) : null,
        name: candidate.name,
        email: normalizeEmail(candidate.identityEmail),
        role: candidate.role,
        source: "deactivated_accounts" as const,
        deactivated: true,
      }];
    });
  } catch {
    return [];
  }
}

export function mergeCloserPeople(
  sequifiInactive: CloserPerson[],
  deactivated: CloserPerson[],
): CloserPerson[] {
  const byEmail = new Map<string, CloserPerson>();
  const byName = new Map<string, CloserPerson>();
  const merged: CloserPerson[] = [];

  const add = (person: CloserPerson) => {
    const email = normalizeEmail(person.email);
    const existing = (email && byEmail.get(email)) || byName.get(person.name.toLowerCase());
    if (existing) {
      existing.deactivated ||= person.deactivated;
      if (!existing.email && person.email) existing.email = person.email;
      if (!existing.id && person.id) existing.id = person.id;
      return;
    }
    merged.push(person);
    if (email) byEmail.set(email, person);
    if (person.name) byName.set(person.name.toLowerCase(), person);
  };

  for (const person of sequifiInactive) add(person);
  for (const person of deactivated) add(person);
  return merged;
}
