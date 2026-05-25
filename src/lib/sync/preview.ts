import { env } from "@/lib/env";
import {
  getEnerfloCustomerUuid,
  getEnerfloIntegrationRecordId,
  resolveTerrosAccountForInstalls,
} from "@/lib/sync/account-matcher";
import {
  extractFieldSummary,
  formatProjectFieldsForPreview,
  getUnconfiguredTerrosFieldEnvVars,
  type ProjectFieldPreviewItem,
} from "@/lib/sync/field-labels";
import {
  buildInstallCounterFields,
  fetchEnerfloCustomerV3,
  fetchInstallProjectCustomFields,
} from "@/lib/sync/project-fields";
import {
  buildTerrosLookupMaps,
  createTerrosSearchCache,
  fetchAllTerrosAccounts,
} from "@/lib/sync/terros-accounts";

// ── Types ──────────────────────────────────────────────────────────────────

export type DealStatus = "none" | "hasDeal" | "projectSubmitted" | "unknown";

export interface E2TRow {
  enerfloId: string;
  name: string;
  email: string;
  phone: string;
  addressLine1: string;
  city: string;
  stateCode: string;
  zip: string;
  addressFull: string;
  salesRepEmail: string | null;
  dealStatus: DealStatus;
}

export interface T2ERow {
  terrosAccountId: string;
  name: string;
  email: string;
  phone: string;
  addressLine1: string;
  city: string;
  stateCode: string;
  zip: string;
  addressFull: string;
  ownerEmail: string | null;
}

/** A customer with submitted projects — always synced to Closed stage with full counters. */
export interface InstallsRow {
  enerfloId: string;
  /** Numeric Enerflo customer id for v3 API calls. */
  enerfloNumericId?: string;
  /** Enerflo customer UUID when available. */
  enerfloUuid?: string;
  name: string;
  email: string;
  phone: string;
  addressLine1: string;
  city: string;
  stateCode: string;
  zip: string;
  addressFull: string;
  salesRepEmail: string | null;
  installCount: number;
  /** Enerflo install/survey IDs — used during execute to fetch full project details */
  installIds: string[];
  /** If set, this Terros account already exists and will be updated. If null, a new account is created. */
  terrosAccountId: string | null;
  action: "create" | "update";
  /** First install used to resolve project custom fields (field preview tab). */
  primaryInstallId?: string;
  projectCustomFields?: Record<string, unknown>;
  fieldPreview?: ProjectFieldPreviewItem[];
  summary?: { systemSizeKw?: number | null; netPpw?: number | null; financeProduct?: string | null };
  fieldFetchError?: string;
}

export type { ProjectFieldPreviewItem };

export interface SyncPreviewResult {
  enerfloToTerros: E2TRow[];
  terrosToEnerflo: T2ERow[];
  installsResync: InstallsRow[];
  errors: string[];
}

export interface UserRow {
  name: string;
  email: string;
  role?: string;
  /** "active" | "inactive" | undefined — Enerflo side only */
  status?: string;
}

export interface UsersPreviewResult {
  enerfloToTerros: UserRow[];
  terrosToEnerflo: UserRow[];
  errors: string[];
}

// ── Helpers ────────────────────────────────────────────────────────────────

function terrosSuccess(text: string): boolean {
  try {
    const j = JSON.parse(text) as Record<string, unknown>;
    if (j.type === "error") return false;
  } catch { /* non-JSON */ }
  return true;
}

function extractList(parsed: unknown, keys: string[]): Record<string, unknown>[] {
  if (!parsed || typeof parsed !== "object") return [];
  const p = parsed as Record<string, unknown>;
  for (const k of keys) {
    if (Array.isArray(p[k])) return p[k] as Record<string, unknown>[];
  }
  if (Array.isArray(parsed)) return parsed as Record<string, unknown>[];
  return [];
}

function extractSalesRepEmail(record: Record<string, unknown>): string | null {
  const ownerObj = (record.owner ?? record.agent ?? record.leadOwner) as Record<string, unknown> | undefined;
  const agentUser = record.agent_user as Record<string, unknown> | undefined;
  const setterUser = record.setter_user as Record<string, unknown> | undefined;
  for (const candidate of [ownerObj?.email, agentUser?.email, setterUser?.email]) {
    const email = String(candidate ?? "").trim().toLowerCase();
    if (email) return email;
  }
  return null;
}

function extractCustomerFields(c: Record<string, unknown>): {
  uuid: string;
  numericId: string;
  name: string;
  email: string;
  phone: string;
  addressLine1: string;
  city: string;
  stateCode: string;
  zip: string;
  addressFull: string;
  salesRepEmail: string | null;
} {
  const uuid = getEnerfloCustomerUuid(c) ?? String(c.uuid ?? c.external_id ?? "").trim();
  const numericId = String(c.id ?? c.customer_id ?? c.customerId ?? "").trim();
  const firstName = String(c.first_name ?? c.firstName ?? "").trim();
  const lastName = String(c.last_name ?? c.lastName ?? "").trim();
  const name =
    [firstName, lastName].filter(Boolean).join(" ") ||
    String(c.name ?? "").trim() ||
    "Unknown";
  const email = String(c.email ?? "").toLowerCase().trim();
  const phone = String(c.mobile ?? c.phone ?? "").trim();
  const addressLine1 = String(c.address ?? c.address_line1 ?? "").trim();
  const city = String(c.city ?? "").trim();
  const stateCode = String(c.state ?? "").trim();
  const zip = String(c.zip ?? "").trim();
  const addressFull = [addressLine1, city, stateCode, zip].filter(Boolean).join(", ");
  const salesRepEmail = extractSalesRepEmail(c);

  return {
    uuid,
    numericId,
    name,
    email,
    phone,
    addressLine1,
    city,
    stateCode,
    zip,
    addressFull,
    salesRepEmail,
  };
}

type SyncApiConfig = {
  terrosBase: string;
  terrosKey: string;
  enerfloBase: string;
  enerfloKey: string;
};

function getSyncApiConfig(): SyncApiConfig | { error: string } {
  const terrosKey = env.terrosApiKey ?? "";
  const enerfloKey = env.enerfloV1ApiKey ?? "";
  if (!terrosKey || !enerfloKey) {
    return { error: "Missing API keys (TERROS_API_KEY or ENERFLO_V1_API_KEY)" };
  }
  return {
    terrosBase: (env.terrosApiBaseUrl ?? "https://api.terros.com").replace(/\/$/, ""),
    terrosKey,
    enerfloBase: (env.enerfloV1BaseUrl ?? "https://enerflo.io").replace(/\/$/, ""),
    enerfloKey,
  };
}

async function fetchEnerfloV1Customers(
  enerfloBase: string,
  enerfloKey: string,
): Promise<{ customers: Record<string, unknown>[]; errs: string[] }> {
  const allCustomers: Record<string, unknown>[] = [];
  const errs: string[] = [];
  for (let page = 1; page <= 200; page++) {
    try {
      const res = await fetch(`${enerfloBase}/api/v1/customers?page=${page}&pageSize=100`, {
        method: "GET",
        headers: { "api-key": enerfloKey, "Content-Type": "application/json" },
      });
      if (!res.ok) { errs.push(`Enerflo page ${page}: HTTP ${res.status}`); break; }
      const parsed = JSON.parse(await res.text()) as Record<string, unknown>;
      const customers = extractList(parsed, ["data", "customers", "results", "items"]);
      if (customers.length === 0) break;
      allCustomers.push(...customers);
      if (customers.length < 100) break;
    } catch (e) {
      errs.push(`Enerflo page ${page}: ${e instanceof Error ? e.message : String(e)}`);
      break;
    }
  }
  return { customers: allCustomers, errs };
}

async function fetchEnerfloInstalls(
  enerfloBase: string,
  enerfloKey: string,
): Promise<Record<string, unknown>[]> {
  const perPage = 100;
  const allInstalls: Record<string, unknown>[] = [];
  for (let page = 1; page <= 200; page++) {
    try {
      const res = await fetch(
        `${enerfloBase}/api/v3/installs?page=${page}&per_page=${perPage}`,
        { method: "GET", headers: { "api-key": enerfloKey, "Content-Type": "application/json" } },
      );
      if (!res.ok) break;
      const parsed = JSON.parse(await res.text()) as Record<string, unknown>;
      const batch = extractList(parsed, ["results", "installs", "data", "items"]);
      if (batch.length === 0) break;
      allInstalls.push(...batch);
      const total = typeof parsed.total === "number" ? parsed.total : null;
      if (batch.length < perPage) break;
      if (total != null && allInstalls.length >= total) break;
    } catch { break; }
  }
  return allInstalls;
}

function buildInstallsByCustomerMap(
  enerfloInstalls: Record<string, unknown>[],
): Map<string, { count: number; installIds: string[]; salesRepEmail: string | null }> {
  const installsByCustomer = new Map<string, { count: number; installIds: string[]; salesRepEmail: string | null }>();
  function addInstall(key: string, installId: string, inst: Record<string, unknown>) {
    const k = key.trim();
    if (!k) return;
    const repEmail = extractSalesRepEmail(inst);
    const existing = installsByCustomer.get(k);
    if (existing) {
      existing.count += 1;
      if (installId && !existing.installIds.includes(installId)) existing.installIds.push(installId);
      if (!existing.salesRepEmail && repEmail) existing.salesRepEmail = repEmail;
    } else {
      installsByCustomer.set(k, {
        count: 1,
        installIds: installId ? [installId] : [],
        salesRepEmail: repEmail,
      });
    }
  }
  for (const inst of enerfloInstalls) {
    const installId = String(inst.id ?? inst.installId ?? inst.install_id ?? "").trim();
    const cust = inst.customer as Record<string, unknown> | undefined;
    const candidates = [
      cust?.uuid, cust?.id, cust?.customerId, cust?.customer_id,
      inst.customer_uuid, inst.customerUuid,
      inst.customer_id, inst.customerId,
    ].map(v => String(v ?? "").trim()).filter(Boolean);
    const seen = new Set<string>();
    for (const c of candidates) {
      if (seen.has(c)) continue;
      seen.add(c);
      addInstall(c, installId, inst);
    }
  }
  return installsByCustomer;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index]!, index);
    }
  }

  const workers = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

export async function buildInstallsPreview(): Promise<{ rows: InstallsRow[]; errors: string[] }> {
  const cfg = getSyncApiConfig();
  if ("error" in cfg) return { rows: [], errors: [cfg.error] };

  const { terrosBase, terrosKey, enerfloBase, enerfloKey } = cfg;
  const errors: string[] = [];

  const [terrosAccounts, enerfloInstalls] = await Promise.all([
    fetchAllTerrosAccounts(terrosBase, terrosKey),
    fetchEnerfloInstalls(enerfloBase, enerfloKey),
  ]);

  const installsByCustomer = buildInstallsByCustomerMap(enerfloInstalls);
  const terrosMaps = buildTerrosLookupMaps(terrosAccounts);

  const installCustomerKeys = [...installsByCustomer.keys()];
  const v3FetchIds = new Set<string>();
  for (const key of installCustomerKeys) {
    if (/^\d+$/.test(key)) v3FetchIds.add(key);
  }
  for (const inst of enerfloInstalls) {
    const cust = inst.customer as Record<string, unknown> | undefined;
    const numericId = String(cust?.id ?? inst.customer_id ?? inst.customerId ?? "").trim();
    if (numericId && /^\d+$/.test(numericId)) v3FetchIds.add(numericId);
  }

  const v3Customers = new Map<string, Record<string, unknown>>();
  const v3Ids = [...v3FetchIds];
  await mapWithConcurrency(v3Ids, 20, async (id) => {
    const customer = await fetchEnerfloCustomerV3(enerfloBase, enerfloKey, id);
    if (customer) {
      v3Customers.set(id, customer);
      const uuid = getEnerfloCustomerUuid(customer);
      if (uuid) v3Customers.set(uuid, customer);
    }
  });

  type InstallCustomerWork = {
    key: string;
    entry: { count: number; installIds: string[]; salesRepEmail: string | null };
    customerRecord: Record<string, unknown>;
    fields: ReturnType<typeof extractCustomerFields>;
    uuid: string;
    numericId: string;
    enerfloId: string;
  };

  const workItems: InstallCustomerWork[] = [];
  const seenInstallCustomers = new Set<string>();

  for (const key of installCustomerKeys) {
    const entry = installsByCustomer.get(key);
    if (!entry || entry.count === 0) continue;

    const customerRecord = v3Customers.get(key);
    if (!customerRecord) continue;

    const fields = extractCustomerFields(customerRecord);
    const uuid = fields.uuid || (key.includes("-") ? key : "");
    const numericId = fields.numericId || (/^\d+$/.test(key) ? key : "");
    const dedupeKey = uuid || numericId || key;
    if (seenInstallCustomers.has(dedupeKey)) continue;
    seenInstallCustomers.add(dedupeKey);

    const enerfloId = uuid || numericId || key;
    if (!enerfloId) continue;

    workItems.push({ key, entry, customerRecord, fields, uuid, numericId, enerfloId });
  }

  const searchCache = createTerrosSearchCache();
  const resolvedItems = await mapWithConcurrency(workItems, 8, async (item) => {
    const terrosAccountId = await resolveTerrosAccountForInstalls({
      customer: item.customerRecord,
      uuid: item.uuid,
      numericId: item.numericId,
      email: item.fields.email,
      phone: item.fields.phone,
      name: item.fields.name,
      addressLine1: item.fields.addressLine1,
      city: item.fields.city,
      zip: item.fields.zip,
      maps: terrosMaps,
      terrosBase,
      terrosKey,
      searchCache,
    });
    return { ...item, terrosAccountId };
  });

  const rows: InstallsRow[] = resolvedItems.map((item) => ({
    enerfloId: item.enerfloId,
    enerfloNumericId: item.numericId || undefined,
    enerfloUuid: item.uuid || undefined,
    name: item.fields.name,
    email: item.fields.email,
    phone: item.fields.phone,
    addressLine1: item.fields.addressLine1,
    city: item.fields.city,
    stateCode: item.fields.stateCode,
    zip: item.fields.zip,
    addressFull: item.fields.addressFull,
    salesRepEmail: item.fields.salesRepEmail ?? item.entry.salesRepEmail,
    installCount: item.entry.count,
    installIds: item.entry.installIds,
    terrosAccountId: item.terrosAccountId,
    action: item.terrosAccountId ? "update" : "create",
  }));

  return { rows, errors };
}

export async function buildInstallsPreviewWithFields(): Promise<{
  rows: InstallsRow[];
  errors: string[];
  unconfiguredFields: string[];
}> {
  const base = await buildInstallsPreview();
  const cfg = getSyncApiConfig();
  if ("error" in cfg) {
    return { rows: base.rows, errors: [...base.errors, cfg.error], unconfiguredFields: getUnconfiguredTerrosFieldEnvVars() };
  }

  const { enerfloBase, enerfloKey } = cfg;
  const enriched = await mapWithConcurrency(base.rows, 5, async (row) => {
    const installId = row.installIds[0];
    if (!installId) {
      const fieldPreview = formatProjectFieldsForPreview(buildInstallCounterFields(row.installCount));
      return {
        ...row,
        fieldPreview,
        summary: extractFieldSummary(fieldPreview),
        fieldFetchError: "No install ID on row",
      };
    }

    try {
      const projectCfs = await fetchInstallProjectCustomFields(enerfloBase, enerfloKey, installId);
      const allCfs = { ...projectCfs, ...buildInstallCounterFields(row.installCount) };
      const fieldPreview = formatProjectFieldsForPreview(allCfs);
      return {
        ...row,
        primaryInstallId: installId,
        projectCustomFields: allCfs,
        fieldPreview,
        summary: extractFieldSummary(fieldPreview),
      };
    } catch (e) {
      const fieldPreview = formatProjectFieldsForPreview(buildInstallCounterFields(row.installCount));
      return {
        ...row,
        primaryInstallId: installId,
        fieldPreview,
        summary: extractFieldSummary(fieldPreview),
        fieldFetchError: e instanceof Error ? e.message : String(e),
      };
    }
  });

  return {
    rows: enriched,
    errors: base.errors,
    unconfiguredFields: getUnconfiguredTerrosFieldEnvVars(),
  };
}

export { buildCoperniqToEnerfloPreview } from "@/lib/sync/coperniq-enerflo";
export type { CoperniqToEnerfloRow } from "@/lib/sync/coperniq-enerflo";

export async function buildE2TPreview(): Promise<{ rows: E2TRow[]; errors: string[] }> {
  const cfg = getSyncApiConfig();
  if ("error" in cfg) return { rows: [], errors: [cfg.error] };

  const { terrosBase, terrosKey, enerfloBase, enerfloKey } = cfg;
  const [terrosAccounts, enerfloResult] = await Promise.all([
    fetchAllTerrosAccounts(terrosBase, terrosKey),
    fetchEnerfloV1Customers(enerfloBase, enerfloKey),
  ]);

  const terrosEmailSet = new Set(terrosAccounts.map(a => a.email).filter(Boolean));
  const rows: E2TRow[] = [];

  for (const c of enerfloResult.customers) {
    if (getEnerfloIntegrationRecordId(c)) continue;
    const email = String(c.email ?? "").toLowerCase().trim();
    if (email && terrosEmailSet.has(email)) continue;

    const uuid = String(c.uuid ?? "").trim();
    const numericId = String(c.id ?? "").trim();
    const enerfloId = uuid || numericId;
    const firstName = String(c.first_name ?? "").trim();
    const lastName = String(c.last_name ?? "").trim();
    const name = [firstName, lastName].filter(Boolean).join(" ") || "Unknown";
    const phone = String(c.mobile ?? c.phone ?? "").trim();
    const addressLine1 = String(c.address ?? "").trim();
    const city = String(c.city ?? "").trim();
    const stateCode = String(c.state ?? "").trim();
    const zip = String(c.zip ?? "").trim();
    const addressFull = [addressLine1, city, stateCode, zip].filter(Boolean).join(", ");
    const ownerObj = c.owner as Record<string, unknown> | undefined;
    const salesRepEmail = String(ownerObj?.email ?? "").trim() || null;

    rows.push({
      enerfloId, name, email, phone,
      addressLine1, city, stateCode, zip, addressFull,
      salesRepEmail,
      dealStatus: "unknown",
    });
  }

  return { rows, errors: enerfloResult.errs };
}

export async function buildT2EPreview(): Promise<{ rows: T2ERow[]; errors: string[] }> {
  const cfg = getSyncApiConfig();
  if ("error" in cfg) return { rows: [], errors: [cfg.error] };

  const { terrosBase, terrosKey, enerfloBase, enerfloKey } = cfg;
  const [terrosAccounts, enerfloResult] = await Promise.all([
    fetchAllTerrosAccounts(terrosBase, terrosKey),
    fetchEnerfloV1Customers(enerfloBase, enerfloKey),
  ]);

  const enerfloEmailSet = new Set(
    enerfloResult.customers.map(c => String(c.email ?? "").toLowerCase().trim()).filter(Boolean),
  );

  const rows: T2ERow[] = terrosAccounts
    .filter(a => {
      if (a.externalLeadId) return false;
      if (!a.email) return false;
      return !enerfloEmailSet.has(a.email);
    })
    .map(acc => ({
      terrosAccountId: acc.accountId,
      name: acc.name,
      email: acc.email,
      phone: acc.phone,
      addressLine1: acc.addressLine1,
      city: acc.city,
      stateCode: acc.stateCode,
      zip: acc.zip,
      addressFull: acc.addressFull,
      ownerEmail: acc.ownerEmail || null,
    }));

  return { rows, errors: enerfloResult.errs };
}

// ── Combined preview (legacy) ───────────────────────────────────────────────

export async function buildSyncPreview(): Promise<SyncPreviewResult> {
  const [installs, e2t, t2e] = await Promise.all([
    buildInstallsPreview(),
    buildE2TPreview(),
    buildT2EPreview(),
  ]);
  return {
    enerfloToTerros: e2t.rows,
    terrosToEnerflo: t2e.rows,
    installsResync: installs.rows,
    errors: [...installs.errors, ...e2t.errors, ...t2e.errors],
  };
}

// ── Users preview ──────────────────────────────────────────────────────────

function stripAlias(email: string): string {
  return email.trim().toLowerCase().replace(/\+[^@]*(@)/, "$1");
}

export async function buildUsersPreview(): Promise<UsersPreviewResult> {
  const errors: string[] = [];
  const terrosBase       = (env.terrosApiBaseUrl ?? "https://api.terros.com").replace(/\/$/, "");
  const terrosKey        = env.terrosApiKey      ?? "";
  const enerfloBase      = (env.enerfloV1BaseUrl ?? "https://enerflo.io").replace(/\/$/, "");
  const enerfloKey       = env.enerfloV1ApiKey   ?? "";
  const enerfloCompanyId = env.enerfloCompanyId  ?? "";

  if (!terrosKey || !enerfloKey) {
    return { enerfloToTerros: [], terrosToEnerflo: [], errors: ["Missing API keys"] };
  }

  // ENERFLO_COMPANY_ID can override auto-detection (must be numeric).
  const envCompanyId = /^\d+$/.test(enerfloCompanyId) ? enerfloCompanyId : "";

  const [enerfloUsers, terrosUsers] = await Promise.all([
    // Enerflo users — fetch ALL then client-side filter to the correct company.
    // We cannot rely on the ?company_id= API param because super-company keys
    // get HTTP 403 or wrong results. Instead we detect the company from the user objects.
    (async () => {
      async function fetchUserPage(page: number, extra = ""): Promise<Record<string, unknown>[]> {
        try {
          const res = await fetch(`${enerfloBase}/api/v3/users?page=${page}&pageSize=100${extra}`, {
            method: "GET",
            headers: { "api-key": enerfloKey, "Content-Type": "application/json" },
          });
          if (!res.ok) return [];
          const parsed = JSON.parse(await res.text()) as Record<string, unknown>;
          return extractList(parsed, ["results", "data", "users", "items"]);
        } catch { return []; }
      }

      // Fetch all pages (active users)
      const all: Record<string, unknown>[] = [];
      for (let page = 1; page <= 20; page++) {
        const batch = await fetchUserPage(page);
        if (batch.length === 0) break;
        all.push(...batch);
        if (batch.length < 100) break;
      }

      // Also try inactive users (undocumented status param — silently ignored if unsupported)
      const seenEmails = new Set(all.map(u => String(u.email ?? "").trim().toLowerCase()).filter(Boolean));
      try {
        for (let page = 1; page <= 20; page++) {
          const batch = await fetchUserPage(page, "&status=inactive");
          if (batch.length === 0) break;
          for (const u of batch) {
            const e = String(u.email ?? "").trim().toLowerCase();
            if (e && !seenEmails.has(e)) { all.push(u); seenEmails.add(e); }
          }
          if (batch.length < 100) break;
        }
      } catch { /* silently skip */ }

      // --- Client-side company filter ---
      // Each user object has a numeric company_id field. Detect the "correct" company by:
      // 1. Use ENERFLO_COMPANY_ID env if set (numeric).
      // 2. Otherwise look for the company_id on the first user with "supercompany" role —
      //    that's the API-key owner's primary company.
      // 3. Fall back to the most common company_id across all users.
      function getUserCompanyId(u: Record<string, unknown>): string {
        const v = u.company_id ?? u.companyId ?? u.companyID;
        return typeof v === "number" ? String(v) : (typeof v === "string" && /^\d+$/.test(v.trim()) ? v.trim() : "");
      }
      function getUserRoles(u: Record<string, unknown>): string[] {
        const rv = u.roles as string[] | string | undefined;
        if (Array.isArray(rv)) return rv.map(r => String(r).trim().toLowerCase());
        if (typeof rv === "string" && rv) return rv.split(",").map(r => r.trim().toLowerCase());
        if (u.role) return [String(u.role).trim().toLowerCase()];
        return [];
      }

      let targetCompanyId = envCompanyId;
      if (!targetCompanyId) {
        // Try: first supercompany-role user
        for (const u of all) {
          if (getUserRoles(u).includes("supercompany")) {
            const cid = getUserCompanyId(u);
            if (cid) { targetCompanyId = cid; break; }
          }
        }
      }
      if (!targetCompanyId) {
        // Fall back: most common company_id
        const counts = new Map<string, number>();
        for (const u of all) {
          const cid = getUserCompanyId(u);
          if (cid) counts.set(cid, (counts.get(cid) ?? 0) + 1);
        }
        let max = 0;
        for (const [cid, n] of counts) { if (n > max) { max = n; targetCompanyId = cid; } }
      }

      // Filter to target company only (if we could detect one)
      return targetCompanyId
        ? all.filter(u => getUserCompanyId(u) === targetCompanyId)
        : all;
    })(),
    // Terros users (single POST)
    (async () => {
      try {
        const res = await fetch(`${terrosBase}/user/list`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `ApiKey ${terrosKey}` },
          body: JSON.stringify({}),
        });
        if (!res.ok) { errors.push(`Terros users: HTTP ${res.status}`); return []; }
        const text = await res.text();
        if (!terrosSuccess(text)) { errors.push("Terros users: API error"); return []; }
        const parsed = JSON.parse(text) as Record<string, unknown>;
        return (parsed.users as Record<string, unknown>[] | undefined) ?? [];
      } catch (e) { errors.push(`Terros users: ${e instanceof Error ? e.message : String(e)}`); return []; }
    })(),
  ]);

  // Roles that are purely admin/system — users with ONLY these roles don't appear
  // in the Enerflo "Lead Owner" dropdown and should be excluded from comparison.
  const ADMIN_ONLY_ROLES = new Set(["company", "supercompany", "officeadmin", "ops"]);

  function isLeadOwnerUser(u: Record<string, unknown>): boolean {
    const rolesVal = u.roles as string[] | string | undefined;
    let roleList: string[] = [];
    if (Array.isArray(rolesVal)) roleList = rolesVal.map(r => String(r).trim().toLowerCase());
    else if (typeof rolesVal === "string" && rolesVal) roleList = rolesVal.split(",").map(r => r.trim().toLowerCase());
    else if (u.role) roleList = [String(u.role).trim().toLowerCase()];
    if (roleList.length === 0) return true; // no role info → include by default
    return roleList.some(r => !ADMIN_ONLY_ROLES.has(r));
  }

  // Helpers for multi-signal matching
  function emailLocalPart(email: string): string {
    return stripAlias(email).split("@")[0] ?? "";
  }
  function normalizeName(n: string): string {
    return n.trim().toLowerCase().replace(/\s+/g, " ");
  }

  // Build lookup sets for each system: full stripped email + local part + full name.
  // A user is considered "matched" if ANY signal matches the other system.
  // enerfloLeadOwners → only shown in the E2T "missing" table (non-admin)
  // enerfloAllUsers   → used for matching so admin users like Jonas Lim / Sam Jensen
  //                     are still considered "present" when checking the Terros side
  const enerfloLeadOwners = enerfloUsers.filter(isLeadOwnerUser);

  function extractEnerfloName(u: Record<string, unknown>): string {
    const fn = String(u.first_name ?? u.firstName ?? "").trim();
    const ln = String(u.last_name  ?? u.lastName  ?? "").trim();
    return [fn, ln].filter(Boolean).join(" ") || String(u.name ?? "").trim();
  }
  function extractTerrosName(u: Record<string, unknown>): string {
    return String(u.name ?? u.displayName ?? u.fullName ?? "").trim()
      || [String(u.firstName ?? ""), String(u.lastName ?? "")].filter(Boolean).join(" ");
  }

  // Terros lookup sets
  const terrosEmailSet     = new Set<string>();
  const terrosLocalPartSet = new Set<string>();
  const terrosNameSet      = new Set<string>();
  for (const u of terrosUsers) {
    const stripped = stripAlias(String(u.email ?? ""));
    if (stripped) { terrosEmailSet.add(stripped); terrosLocalPartSet.add(emailLocalPart(stripped)); }
    const name = normalizeName(extractTerrosName(u));
    if (name) terrosNameSet.add(name);
  }

  // Enerflo lookup sets — built from ALL enerflo users (including admins)
  // so Terros users matched to admin accounts aren't falsely shown as missing
  const enerfloEmailSet     = new Set<string>();
  const enerfloLocalPartSet = new Set<string>();
  const enerfloNameSet      = new Set<string>();
  for (const u of enerfloUsers) {
    const stripped = stripAlias(String(u.email ?? ""));
    if (stripped) { enerfloEmailSet.add(stripped); enerfloLocalPartSet.add(emailLocalPart(stripped)); }
    const name = normalizeName(extractEnerfloName(u));
    if (name) enerfloNameSet.add(name);
  }

  function isMatchedInTerros(u: Record<string, unknown>): boolean {
    const stripped = stripAlias(String(u.email ?? ""));
    if (stripped && terrosEmailSet.has(stripped)) return true;
    const lp = emailLocalPart(stripped);
    if (lp && lp.length > 2 && terrosLocalPartSet.has(lp)) return true;
    const name = normalizeName(extractEnerfloName(u));
    if (name && name.length > 3 && terrosNameSet.has(name)) return true;
    return false;
  }
  function isMatchedInEnerflo(u: Record<string, unknown>): boolean {
    const stripped = stripAlias(String(u.email ?? ""));
    if (stripped && enerfloEmailSet.has(stripped)) return true;
    const lp = emailLocalPart(stripped);
    if (lp && lp.length > 2 && enerfloLocalPartSet.has(lp)) return true;
    const name = normalizeName(extractTerrosName(u));
    if (name && name.length > 3 && enerfloNameSet.has(name)) return true;
    return false;
  }

  // Enerflo users missing from Terros — lead-owner-eligible only
  const enerfloToTerros: UserRow[] = enerfloLeadOwners
    .filter(u => !isMatchedInTerros(u))
    .map(u => {
      const name = extractEnerfloName(u);
      const rolesVal = u.roles as string[] | string | undefined;
      const role = Array.isArray(rolesVal)
        ? rolesVal.join(", ")
        : typeof rolesVal === "string"
          ? rolesVal
          : String(u.role ?? "").trim() || undefined;
      const rawStatus = String(u.status ?? u.userStatus ?? u.user_status ?? "").trim();
      const status = rawStatus.toLowerCase() || undefined;
      return { name, email: stripAlias(String(u.email ?? "")), role: role || undefined, status };
    });

  // Terros users missing from Enerflo
  const terrosToEnerflo: UserRow[] = terrosUsers
    .filter(u => !isMatchedInEnerflo(u))
    .map(u => {
      const name = extractTerrosName(u) || String(u.email ?? "").trim();
      return { name, email: stripAlias(String(u.email ?? "")), role: String(u.role ?? u.userType ?? "").trim() || undefined };
    });

  return { enerfloToTerros, terrosToEnerflo, errors };
}
