import { normalizeEmail, normalizePersonName } from "@/lib/inactive-reps/identity";
import {
  INACTIVE_CLOSER_CSV_COLUMNS,
  type CloserPerson,
  type CloserProjectRow,
  type HubProject,
  type SequifiSaleLite,
} from "@/lib/inactive-closers/types";

const INSTALLER_LABELS: Record<string, string> = {
  axia: "Axia",
  illum: "Illum",
  tron: "Tron",
  empwr: "Empwr",
  goodpwr: "GoodPwr",
  "good pwr": "GoodPwr",
  owe: "Owe",
};

export function manilaDateString(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function skipCloserPerson(name: string, email: string): boolean {
  const normalizedName = normalizePersonName(name);
  const normalizedEmail = normalizeEmail(email);
  if (normalizedName.includes("test user") || normalizedName.startsWith("test ")) return true;
  if (normalizedEmail.includes("yolo@") || normalizedEmail.includes("testaxia")) return true;
  return false;
}

export function displayInstaller(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  return INSTALLER_LABELS[raw.toLowerCase()] ?? raw;
}

export function combinedAddress(project: HubProject, sale?: SequifiSaleLite | null): string {
  const existing = (project.addressLine1 || sale?.customerAddress || "").trim();
  const city = project.city.trim();
  const state = (project.state || sale?.customerState || "").trim();
  const zip = (project.zip || sale?.customerZip || "").trim();
  if (existing) {
    const extras = [city, state, zip].filter(
      part => part && !existing.toLowerCase().includes(part.toLowerCase()),
    );
    return extras.length ? [existing, ...extras].join(", ") : existing;
  }
  return [city, state, zip].filter(Boolean).join(", ");
}

function cell(value: unknown): string {
  if (value == null || value === "") return "";
  return String(value);
}

function csvEscape(value: unknown): string {
  const text = cell(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function closerRowsToCsv(rows: CloserProjectRow[]): string {
  const header = INACTIVE_CLOSER_CSV_COLUMNS.join(",");
  const body = rows.map(row =>
    INACTIVE_CLOSER_CSV_COLUMNS.map(column => csvEscape(row[column])).join(","),
  );
  return `${[header, ...body].join("\n")}\n`;
}

export function summarizeClosers(rows: CloserProjectRow[]): Array<{ name: string; email: string; projects: number }> {
  const byName = new Map<string, { name: string; email: string; projects: number }>();
  for (const row of rows) {
    const current = byName.get(row.closer_name) ?? {
      name: row.closer_name,
      email: row.closer_email,
      projects: 0,
    };
    current.projects += 1;
    byName.set(row.closer_name, current);
  }
  return [...byName.values()].sort((left, right) => right.projects - left.projects || left.name.localeCompare(right.name));
}

export function inactiveCloserEmailHtml(options: {
  reportDate: string;
  rows: CloserProjectRow[];
}): string {
  const closers = summarizeClosers(options.rows);
  const closerItems = closers
    .map(closer => `<li>${escapeHtml(closer.name)} — ${closer.projects}</li>`)
    .join("");
  return `
    <p>Here's the list of <strong>inactive closers and the projects tied to them</strong> for <strong>${escapeHtml(options.reportDate)}</strong>.</p>
    <p>The attached CSV has <strong>${options.rows.length} projects</strong> across <strong>${closers.length} inactive closers</strong>, one project per row. These are reps who are inactive in Sequifi and/or on the deactivated-accounts list, and who still have closer assignments on Hub projects.</p>
    <p>Each row includes project ID, customer name, address, installer, closer name and email, commission fields, and system size.</p>
    <p><strong>Closers on this list</strong></p>
    <ul>${closerItems}</ul>
    <p>This is not the daily inactive-rep account deactivation report.</p>
  `;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]!
  ));
}

export function indexCloserPeople(people: CloserPerson[]): {
  byId: Map<number, CloserPerson>;
  byEmail: Map<string, CloserPerson>;
  byName: Map<string, CloserPerson>;
} {
  const byId = new Map<number, CloserPerson>();
  const byEmail = new Map<string, CloserPerson>();
  const byName = new Map<string, CloserPerson>();
  for (const person of people) {
    if (skipCloserPerson(person.name, person.email)) continue;
    if (person.id) byId.set(person.id, person);
    const email = normalizeEmail(person.email);
    if (email) byEmail.set(email, person);
    const name = normalizePersonName(person.name);
    if (name) {
      const existing = byName.get(name);
      if (!existing || (person.source === "sequifi_inactive" && existing.source !== "sequifi_inactive")) {
        byName.set(name, person);
      }
    }
  }
  return { byId, byEmail, byName };
}

function findPerson(
  index: ReturnType<typeof indexCloserPeople>,
  name: string,
  email: string,
): CloserPerson | null {
  const normalizedEmail = normalizeEmail(email);
  if (normalizedEmail && index.byEmail.has(normalizedEmail)) return index.byEmail.get(normalizedEmail)!;
  const normalizedName = normalizePersonName(name);
  if (normalizedName && index.byName.has(normalizedName)) return index.byName.get(normalizedName)!;
  return null;
}

export function matchCloserForProject(
  project: HubProject,
  sale: SequifiSaleLite | null,
  index: ReturnType<typeof indexCloserPeople>,
): { person: CloserPerson; via: string } | null {
  if (sale?.closerId && index.byId.has(sale.closerId)) {
    return { person: index.byId.get(sale.closerId)!, via: "sequifi_closer" };
  }
  const hubCloser = findPerson(index, project.closerName, project.closerEmail);
  if (hubCloser) return { person: hubCloser, via: "hub_closer" };
  const sequifiCloser = findPerson(index, sale?.closerName ?? "", "");
  if (sequifiCloser) return { person: sequifiCloser, via: "sequifi_closer_name" };
  if (!project.closerName && !project.closerEmail) {
    const advisor = findPerson(index, project.salesAdvisorName, project.salesAdvisorEmail);
    if (advisor) return { person: advisor, via: "hub_sales_advisor" };
  }
  return null;
}

export function buildInactiveCloserRows(options: {
  people: CloserPerson[];
  projects: HubProject[];
  sales: SequifiSaleLite[];
}): CloserProjectRow[] {
  const index = indexCloserPeople(options.people);
  const salesByPid = new Map(options.sales.map(sale => [sale.pid, sale]));
  const rows: CloserProjectRow[] = [];
  const seen = new Set<string>();

  for (const project of options.projects) {
    const sale = salesByPid.get(project.sequifiPid) ?? salesByPid.get(project.projectId) ?? null;
    const matched = matchCloserForProject(project, sale, index);
    if (!matched) continue;
    if (
      matched.person.source === "deactivated_accounts" &&
      !/closer/i.test(matched.person.role)
    ) {
      continue;
    }
    const key = `${normalizePersonName(matched.person.name)}|${project.projectId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const remit = project.remittance;
    rows.push({
      project_id: project.projectId,
      project_name: project.projectName,
      address: combinedAddress(project, sale),
      installer: displayInstaller(project.installer) || displayInstaller(sale?.installPartner),
      closer_name: matched.person.name,
      closer_email: matched.person.email,
      partner_commission: cell(remit.partner_commission),
      partner_incentive: cell(remit.partner_incentive),
      spif: cell(remit.spif),
      c0: cell(remit.c0),
      c1: cell(remit.c1),
      c2: cell(remit.c2),
      adjusted_c2: cell(remit.adjusted_c2),
      c0_paid: cell(remit.c0_paid),
      c1_paid: cell(remit.c1_paid),
      c2_paid: cell(remit.c2_paid),
      incentive_paid: cell(remit.incentive_paid),
      clawback: cell(remit.clawback),
      others: cell(remit.others),
      total_sp_paid: cell(remit.total_sp_paid),
      sequifi_total_commission: cell(sale?.totalCommission),
      system_size_kw: cell(project.systemSizeKw ?? remit.pv_size ?? sale?.kw),
      match_via: matched.via,
    });
  }

  return rows.sort((left, right) => {
    const byName = left.closer_name.localeCompare(right.closer_name);
    return byName || left.project_id.localeCompare(right.project_id);
  });
}
