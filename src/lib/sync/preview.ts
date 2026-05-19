import { env } from "@/lib/env";

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
}

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

interface TerrosSummary {
  accountId: string;
  name: string;
  email: string;
  phone: string;
  addressLine1: string;
  city: string;
  stateCode: string;
  zip: string;
  addressFull: string;
  ownerEmail: string;
  externalLeadId: string;
}

async function fetchAllTerrosAccounts(base: string, key: string): Promise<TerrosSummary[]> {
  const seen = new Map<string, TerrosSummary>();

  for (let page = 1; page <= 200; page++) {
    try {
      const res = await fetch(`${base}/account/list`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `ApiKey ${key}` },
        body: JSON.stringify({ page, pageSize: 100 }),
      });
      if (!res.ok) break;
      const text = await res.text();
      if (!terrosSuccess(text)) break;
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const rows = extractList(parsed, ["accounts", "data", "results"]);
      if (rows.length === 0) break;

        const sizeBefore = seen.size;
        for (const acc of rows) {
          const accountId = String(acc.accountId ?? acc.id ?? "").trim();
          if (!accountId || seen.has(accountId)) continue;
          const resident = acc.resident as Record<string, unknown> | undefined;
          const loc = (acc.location ?? acc.address) as Record<string, unknown> | undefined;
          const owner = acc.owner as Record<string, unknown> | undefined;
          const line1   = String(loc?.line1       ?? "").trim();
          const city    = String(loc?.locality    ?? "").trim();
          const state   = String(loc?.countrySubd ?? "").trim();
          const zip     = String(loc?.postal1     ?? "").trim();
          const oneLine = String(
            loc?.oneLine ?? [line1, city, state, zip].filter(Boolean).join(", ")
          ).trim();
          // Terros stores the full name under resident.name, resident.firstName+lastName, or acc.name
          const firstName  = String(resident?.firstName ?? "").trim();
          const lastName   = String(resident?.lastName  ?? "").trim();
          const resName    = String(resident?.name      ?? "").trim();
          const fullName   =
            resName ||
            (firstName || lastName ? [firstName, lastName].filter(Boolean).join(" ") : "") ||
            String(acc.name ?? "").trim();
          seen.set(accountId, {
            accountId,
            name:           fullName,
          email:          String(resident?.email ?? "").toLowerCase().trim(),
          phone:          String(resident?.phone ?? "").trim(),
          addressLine1:   line1,
          city,
          stateCode:      state,
          zip,
          addressFull:    oneLine,
          ownerEmail:     String(owner?.email ?? "").trim(),
          externalLeadId: String(acc.externalLeadId ?? "").trim(),
        });
      }

      // If no new unique accounts were added this page, the API is looping — stop.
      if (seen.size === sizeBefore) break;
      if (rows.length < 100) break;
    } catch {
      break;
    }
  }

  return [...seen.values()];
}

function getEnerfloIntegrationRecordId(c: Record<string, unknown>): string | null {
  const partnerLead = ((c.integrations as Record<string, unknown> | undefined)
    ?.Partner as Record<string, unknown> | undefined)
    ?.Lead as Record<string, unknown> | undefined;
  const val =
    partnerLead?.integration_record_id ??
    c.integration_record_id ??
    c.integrationRecordId;
  if (val != null && String(val).trim()) return String(val).trim();
  return null;
}

// ── Main export ────────────────────────────────────────────────────────────

export async function buildSyncPreview(): Promise<SyncPreviewResult> {
  const errors: string[] = [];
  const terrosBase  = (env.terrosApiBaseUrl ?? "https://api.terros.com").replace(/\/$/, "");
  const terrosKey   = env.terrosApiKey      ?? "";
  const enerfloBase = (env.enerfloV1BaseUrl ?? "https://enerflo.io").replace(/\/$/, "");
  const enerfloKey  = env.enerfloV1ApiKey   ?? "";

  if (!terrosKey || !enerfloKey) {
    return {
      enerfloToTerros: [],
      terrosToEnerflo: [],
      installsResync: [],
      errors: ["Missing API keys (TERROS_API_KEY or ENERFLO_V1_API_KEY)"],
    };
  }

  // Fetch Terros accounts, Enerflo customers, and Enerflo installs in parallel.
  const [terrosAccounts, enerfloResult, enerfloInstalls] = await Promise.all([
    fetchAllTerrosAccounts(terrosBase, terrosKey),
    (async () => {
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
    })(),
    // Fetch all installs once — used to build customer → installCount + project detail map.
    // Try GET first; fall back to POST /all if GET returns nothing.
    (async () => {
      const tryFetch = async (method: "GET" | "POST", url: string, body?: object) => {
        const allInstalls: Record<string, unknown>[] = [];
        for (let page = 1; page <= 200; page++) {
          try {
            const pageUrl = method === "GET" ? `${url}?page=${page}&pageSize=100` : url;
            const res = await fetch(pageUrl, {
              method,
              headers: { "api-key": enerfloKey, "Content-Type": "application/json" },
              ...(method === "POST" ? { body: JSON.stringify({ ...body, page, pageSize: 100 }) } : {}),
            });
            if (!res.ok) break;
            const parsed = JSON.parse(await res.text()) as Record<string, unknown>;
            const batch = extractList(parsed, ["installs", "data", "results", "items"]);
            if (batch.length === 0) break;
            allInstalls.push(...batch);
            if (batch.length < 100) break;
          } catch { break; }
        }
        return allInstalls;
      };

      const installs = await tryFetch("GET", `${enerfloBase}/api/v3/installs`);
      if (installs.length > 0) return installs;
      // Fallback: POST /api/v3/installs/all
      return tryFetch("POST", `${enerfloBase}/api/v3/installs/all`, {});
    })(),
  ]);

  errors.push(...enerfloResult.errs);

  // Build: customer identifier → { count, installIds[] }
  // Enerflo install records may reference customers by UUID or numeric ID via several field paths.
  const installsByCustomer = new Map<string, { count: number; installIds: string[] }>();
  function addInstall(key: string, installId: string) {
    const k = key.trim();
    if (!k) return;
    const existing = installsByCustomer.get(k);
    if (existing) { existing.count += 1; if (installId && !existing.installIds.includes(installId)) existing.installIds.push(installId); }
    else installsByCustomer.set(k, { count: 1, installIds: installId ? [installId] : [] });
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
      addInstall(c, installId);
    }
  }

  // Build Terros lookup maps for installs resync
  const terrosEmailToAccount = new Map<string, TerrosSummary>();
  const terrosPhoneToAccount = new Map<string, TerrosSummary>();
  const terrosExternalLeadIdToAccount = new Map<string, TerrosSummary>();
  for (const acc of terrosAccounts) {
    if (acc.email) terrosEmailToAccount.set(acc.email, acc);
    if (acc.externalLeadId) terrosExternalLeadIdToAccount.set(acc.externalLeadId, acc);
    // Normalise phone to digits-only for reliable matching
    const normPhone = acc.phone.replace(/\D/g, "");
    if (normPhone.length >= 7) terrosPhoneToAccount.set(normPhone, acc);
  }

  const terrosEmailSet = new Set(terrosAccounts.map(a => a.email).filter(Boolean));
  const enerfloEmailSet = new Set(
    enerfloResult.customers.map(c => String(c.email ?? "").toLowerCase().trim()).filter(Boolean)
  );

  // E2T: Enerflo customers not already linked or email-matched in Terros.
  // Deal status is skipped here to keep preview fast — resolved during execute.
  const enerfloToTerros: E2TRow[] = [];
  for (const c of enerfloResult.customers) {
    if (getEnerfloIntegrationRecordId(c)) continue;
    const email = String(c.email ?? "").toLowerCase().trim();
    if (email && terrosEmailSet.has(email)) continue;

    const uuid         = String(c.uuid ?? "").trim();
    const numericId    = String(c.id   ?? "").trim();
    const enerfloId    = uuid || numericId;
    const firstName    = String(c.first_name ?? "").trim();
    const lastName     = String(c.last_name  ?? "").trim();
    const name         = [firstName, lastName].filter(Boolean).join(" ") || "Unknown";
    const phone        = String(c.mobile ?? c.phone ?? "").trim();
    const addressLine1 = String(c.address ?? "").trim();
    const city         = String(c.city    ?? "").trim();
    const stateCode    = String(c.state   ?? "").trim();
    const zip          = String(c.zip     ?? "").trim();
    const addressFull  = [addressLine1, city, stateCode, zip].filter(Boolean).join(", ");
    const ownerObj     = c.owner as Record<string, unknown> | undefined;
    const salesRepEmail = String(ownerObj?.email ?? "").trim() || null;

    enerfloToTerros.push({
      enerfloId, name, email, phone,
      addressLine1, city, stateCode, zip, addressFull,
      salesRepEmail,
      dealStatus: "unknown",
    });
  }

  // T2E: Terros accounts not already linked and not email-matched in Enerflo.
  const terrosToEnerflo: T2ERow[] = terrosAccounts
    .filter(a => {
      if (a.externalLeadId) return false;
      if (!a.email) return false;
      return !enerfloEmailSet.has(a.email);
    })
    .map(acc => ({
      terrosAccountId: acc.accountId,
      name:         acc.name,
      email:        acc.email,
      phone:        acc.phone,
      addressLine1: acc.addressLine1,
      city:         acc.city,
      stateCode:    acc.stateCode,
      zip:          acc.zip,
      addressFull:  acc.addressFull,
      ownerEmail:   acc.ownerEmail || null,
    }));

  // Installs Resync: all Enerflo customers with ≥1 submitted project.
  // If already linked/email-matched in Terros → update to Closed stage + set counters.
  // If not in Terros → create with Closed stage + counters.
  const installsResync: InstallsRow[] = [];
  for (const c of enerfloResult.customers) {
    const uuid      = String(c.uuid ?? "").trim();
    const numericId = String(c.id   ?? "").trim();
    const enerfloId = uuid || numericId;
    if (!enerfloId) continue;

    const entry = (uuid ? installsByCustomer.get(uuid) : undefined) ?? (numericId ? installsByCustomer.get(numericId) : undefined);
    if (!entry || entry.count === 0) continue;

    const email       = String(c.email ?? "").toLowerCase().trim();
    const firstName   = String(c.first_name ?? "").trim();
    const lastName    = String(c.last_name  ?? "").trim();
    const name        = [firstName, lastName].filter(Boolean).join(" ") || "Unknown";
    const phone       = String(c.mobile ?? c.phone ?? "").trim();
    const addressLine1= String(c.address ?? "").trim();
    const city        = String(c.city    ?? "").trim();
    const stateCode   = String(c.state   ?? "").trim();
    const zip         = String(c.zip     ?? "").trim();
    const addressFull = [addressLine1, city, stateCode, zip].filter(Boolean).join(", ");
    const ownerObj    = c.owner as Record<string, unknown> | undefined;
    const salesRepEmail = String(ownerObj?.email ?? "").trim() || null;

    // Find existing Terros account: prefer integration_record_id → email → phone
    const linkedTerrosId = getEnerfloIntegrationRecordId(c);
    let terrosAccountId: string | null = null;
    if (linkedTerrosId) {
      const acc = terrosExternalLeadIdToAccount.get(linkedTerrosId)
        ?? terrosAccounts.find(a => a.accountId === linkedTerrosId);
      terrosAccountId = acc?.accountId ?? linkedTerrosId;
    } else if (email) {
      terrosAccountId = terrosEmailToAccount.get(email)?.accountId ?? null;
    }
    if (!terrosAccountId && phone) {
      const normPhone = phone.replace(/\D/g, "");
      if (normPhone.length >= 7) {
        terrosAccountId = terrosPhoneToAccount.get(normPhone)?.accountId ?? null;
      }
    }

    installsResync.push({
      enerfloId, name, email, phone,
      addressLine1, city, stateCode, zip, addressFull,
      salesRepEmail,
      installCount: entry.count,
      installIds: entry.installIds,
      terrosAccountId,
      action: terrosAccountId ? "update" : "create",
    });
  }

  return { enerfloToTerros, terrosToEnerflo, installsResync, errors };
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
