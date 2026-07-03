#!/usr/bin/env node
/**
 * Sync Terros account assignments → Enerflo customer fields.
 *
 * Mapping (force overwrite from Terros):
 *   Terros Owner/Setter (ownerId) → Enerflo Setter (setter_user_id)
 *   Terros Closer (closerId)      → Enerflo Lead Owner (agent_user_id)
 *
 * Usage:
 *   node scripts/sync-terros-assignments-to-enerflo.mjs          # dry run (default)
 *   node scripts/sync-terros-assignments-to-enerflo.mjs --run    # apply changes
 *
 * Optional env:
 *   LIMIT=N  — stop after N would-update / updated rows (smoke tests)
 *   TARGET_EXTERNAL_LEAD_ID=uuid-or-numeric  — process only Terros rows whose externalLeadId
 *     equals this value exactly. Prefer the Enerflo v2 UUID, not the numeric customer id.
 *   TARGET_TERROS_ACCOUNT_ID=Account.xxx  — fetch one Terros account via /account/get (skips
 *     full account/list pagination; best for single-lead live runs).
 *   INPUT_CSV=exports/sync-confirm-would-overwrite-*.csv  — process only terrosAccountId
 *     rows from a prior dry-run export (skips full account/list pagination).
 *   REQUIRE_EXTERNAL_LEAD_ID=0  — with INPUT_CSV: also process accounts where Terros has no
 *     externalLeadId recorded; Enerflo customer is resolved via live email/phone/name search.
 *   MATCH_MODE=name-email  — match Terros ↔ Enerflo by normalized name + resident email;
 *     updates every Enerflo customer with that exact name+email (duplicate Enerflo leads included).
 *   TERROS_EXPORT / ENERFLO_EXPORT  — CSV paths for MATCH_MODE=name-email (defaults: latest in exports/)
 *   USE_EXPORT_ASSIGNMENTS=1  — with MATCH_MODE=name-email: use Terros export owner/closer emails;
 *     skip /account/get (Enerflo GET + PUT only).
 *   RESUME_AUDIT=path/to/prior-audit.jsonl  — skip terrosAccountIds already logged in a prior run.
 *   BLOCKED_ASSIGNMENT_EMAILS=jonaslim@noxpwr.com  — never assign these reps (comma-separated)
 *
 * Duplicate Terros accounts: when the same Enerflo customer has both a UUID externalLeadId
 * (canonical) and a numeric-only externalLeadId (legacy duplicate), only the UUID-linked row
 * is synced unless TARGET_EXTERNAL_LEAD_ID explicitly matches the numeric id.
 */
import fs from "node:fs";
import path from "node:path";

const PAGE_SIZE = 1000;
const MIN_INTERVAL_MS = 80;
const MAX_RETRIES = 7;
const UUID_RE = /^[0-9a-f-]{36}$/i;

const DEFAULT_BLOCKED_EMAILS = ["jonaslim@noxpwr.com"];
const BLOCKED_ASSIGNMENT_EMAILS = new Set(
  (process.env.BLOCKED_ASSIGNMENT_EMAILS ?? DEFAULT_BLOCKED_EMAILS.join(","))
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
);

function loadEnv(filePath) {
  const out = {};
  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split("\n")) {
    const match = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (!match) continue;
    out[match[1]] = match[2].trim();
  }
  return out;
}

function nowTs() {
  return new Date().toISOString();
}

function pick(obj, keys) {
  for (const key of keys) {
    if (obj && obj[key] != null && String(obj[key]).trim() !== "") {
      return String(obj[key]).trim();
    }
  }
  return "";
}

function parseUserId(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function terrosOk(raw) {
  try {
    const parsed = JSON.parse(raw);
    return parsed?.type !== "error";
  } catch {
    return false;
  }
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isBlockedAssignmentEmail(email) {
  return BLOCKED_ASSIGNMENT_EMAILS.has(normalizeEmail(email));
}

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

function nestedEmail(obj) {
  if (!obj || typeof obj !== "object") return null;
  const user = obj.user && typeof obj.user === "object" ? obj.user : null;
  const email = normalizeEmail((user && user.email) || obj.email || obj.Email || "");
  return email || null;
}

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function readExportCsvRows(csvPath, columns) {
  const raw = fs.readFileSync(csvPath, "utf8");
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const header = lines[0].split(",");
  const idx = (name) => header.indexOf(name);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const row = {};
    for (const col of columns) {
      row[col] = idx(col) >= 0 ? (cols[idx(col)] ?? "").trim() : "";
    }
    rows.push(row);
  }
  return rows;
}

/** AccountIds already handled in a prior audit (for resume). Comma-separated paths OK. */
function loadResumeSkipSet(auditPathOrPaths) {
  const skip = new Set();
  const paths = String(auditPathOrPaths || "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  for (const auditPath of paths) {
    const raw = fs.readFileSync(auditPath, "utf8");
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const o = JSON.parse(line);
        const id = o.accountId;
        if (!id || !String(id).startsWith("Account.")) continue;
        if (o.reason === "name-email-ambiguous") continue;
        skip.add(String(id));
      } catch {
        /* ignore malformed lines */
      }
    }
  }
  return skip;
}

function buildAccountFromExportRow(row) {
  const parts = String(row.customerName || "").trim().split(/\s+/);
  const firstName = parts[0] || "";
  const lastName = parts.slice(1).join(" ") || "";
  const ownerEmail = normalizeEmail(row.ownerEmail);
  const closerEmail = normalizeEmail(row.closerEmail);
  return {
    accountId: row.accountId,
    id: row.accountId,
    name: row.customerName,
    externalLeadId: row.externalLeadId || "",
    ownerId: row.ownerId || "",
    closerId: row.closerId || "",
    owner: ownerEmail ? { email: ownerEmail } : {},
    closer: closerEmail ? { email: closerEmail } : {},
    resident: {
      email: row.residentEmail,
      firstName,
      lastName,
    },
  };
}

function latestExportFile(exportsDir, prefix) {
  return fs
    .readdirSync(exportsDir)
    .filter((f) => f.startsWith(prefix) && f.endsWith(".csv"))
    .sort()
    .pop();
}

/** Unique Terros ↔ Enerflo pairs where resident email and normalized name both match. */
function buildNameEmailUniqueMatches(terrosPath, enerfloPath) {
  const terros = readExportCsvRows(terrosPath, [
    "accountId",
    "customerName",
    "nameKey",
    "residentEmail",
    "externalLeadId",
    "ownerId",
    "ownerEmail",
    "closerId",
    "closerEmail",
  ]);
  const enerflo = readExportCsvRows(enerfloPath, [
    "customerId",
    "customerUuid",
    "customerName",
    "nameKey",
    "email",
  ]);

  const enerfloByEmailName = new Map();
  for (const row of enerflo) {
    const email = normalizeEmail(row.email);
    const nameKey = row.nameKey || normalizeName(row.customerName);
    if (!email || !nameKey) continue;
    const key = `${email}::${nameKey}`;
    if (!enerfloByEmailName.has(key)) enerfloByEmailName.set(key, []);
    enerfloByEmailName.get(key).push(row);
  }

  const unique = [];
  let multiEnerfloTerros = 0;
  const seenTerros = new Set();

  for (const t of terros) {
    const accountId = t.accountId?.trim();
    const email = normalizeEmail(t.residentEmail);
    const nameKey = t.nameKey || normalizeName(t.customerName);
    if (!accountId || !accountId.startsWith("Account.") || !email || !nameKey) continue;
    if (seenTerros.has(accountId)) continue;

    const key = `${email}::${nameKey}`;
    const candidates = enerfloByEmailName.get(key) ?? [];
    if (!candidates.length) continue;

    seenTerros.add(accountId);
    if (candidates.length > 1) multiEnerfloTerros += 1;
    const enerfloCustomerIds = candidates.map((c) => c.customerId);
    unique.push({
      accountId,
      customerName: t.customerName,
      residentEmail: email,
      nameKey,
      externalLeadId: t.externalLeadId,
      ownerId: t.ownerId,
      ownerEmail: normalizeEmail(t.ownerEmail),
      closerId: t.closerId,
      closerEmail: normalizeEmail(t.closerEmail),
      enerfloCustomerId: candidates[0].customerId,
      enerfloCustomerUuid: candidates[0].customerUuid,
      enerfloCustomerIds,
      enerfloMatches: candidates.map((c) => ({
        customerId: c.customerId,
        customerUuid: c.customerUuid,
      })),
    });
  }

  return { unique, multiEnerfloTerros };
}

/** Read rows from a sync-confirm dry-run CSV. */
function loadRowsFromCsv(csvPath) {
  const raw = fs.readFileSync(csvPath, "utf8");
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const header = lines[0].split(",");
  const idx = (name) => header.indexOf(name);
  const accountCol = idx("terrosAccountId");
  const externalCol = idx("externalLeadId");
  const numericCol = idx("enerfloCustomerId");
  const rows = [];
  const seen = new Set();
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const accountId = (accountCol >= 0 ? cols[accountCol] : cols[0])?.trim();
    if (!accountId || !accountId.startsWith("Account.") || seen.has(accountId)) continue;
    seen.add(accountId);
    rows.push({
      accountId,
      externalLeadId: externalCol >= 0 ? (cols[externalCol] ?? "").trim() : "",
      enerfloCustomerId: numericCol >= 0 ? (cols[numericCol] ?? "").trim() : "",
    });
  }
  return rows;
}

async function main() {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const envPath = path.join(root, ".env.local");
  const env = loadEnv(envPath);

  const terrosBase = (env.TERROS_API_BASE_URL || "https://api.terros.com").replace(/\/$/, "");
  const terrosKey = env.TERROS_API_KEY || "";
  const enerfloBase = (env.ENERFLO_V1_BASE_URL || "https://enerflo.io").replace(/\/$/, "");
  const enerfloKey = env.ENERFLO_V1_API_KEY || "";

  if (!terrosKey || !enerfloKey) {
    throw new Error("Missing TERROS_API_KEY or ENERFLO_V1_API_KEY in .env.local");
  }

  const isRun = process.argv.includes("--run");
  const limitRaw = process.env.LIMIT ? Number(process.env.LIMIT) : null;
  const limit = limitRaw != null && Number.isFinite(limitRaw) && limitRaw > 0 ? Math.floor(limitRaw) : null;
  const targetExternalLeadId = process.env.TARGET_EXTERNAL_LEAD_ID?.trim() || "";
  const targetTerrosAccountId = process.env.TARGET_TERROS_ACCOUNT_ID?.trim() || "";
  const inputCsvPath = process.env.INPUT_CSV?.trim()
    ? path.resolve(root, process.env.INPUT_CSV.trim())
    : "";
  const matchMode = (process.env.MATCH_MODE || "").trim().toLowerCase();
  const useExportAssignments =
    process.env.USE_EXPORT_ASSIGNMENTS === "1" || process.env.USE_EXPORT_ASSIGNMENTS === "true";
  // With INPUT_CSV: when "0", process accounts even if Terros itself has no externalLeadId
  // recorded (e.g. accounts linked to Enerflo without the back-reference ever being written).
  // Enerflo customer resolution then falls back to live email/phone/name search.
  const REQUIRE_EXTERNAL_LEAD_ID = process.env.REQUIRE_EXTERNAL_LEAD_ID !== "0";
  const resumeAuditRaw = process.env.RESUME_AUDIT?.trim() || "";
  const resumeAuditPaths = resumeAuditRaw
    ? resumeAuditRaw
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => path.resolve(root, p))
    : [];
  const resumeAuditPath = resumeAuditPaths.length ? resumeAuditPaths.join(",") : "";
  const exportsDir = path.join(root, "exports");
  const terrosExportPath = process.env.TERROS_EXPORT?.trim()
    ? path.resolve(root, process.env.TERROS_EXPORT.trim())
    : path.join(exportsDir, latestExportFile(exportsDir, "terros-accounts-") || "");
  const enerfloExportPath = process.env.ENERFLO_EXPORT?.trim()
    ? path.resolve(root, process.env.ENERFLO_EXPORT.trim())
    : path.join(exportsDir, latestExportFile(exportsDir, "enerflo-leads-") || "");

  const auditPath = path.join(root, `terros-enerflo-assignment-audit-${Date.now()}.jsonl`);
  const revertCsvPath = auditPath.replace(/\.jsonl$/, "-revert.csv");
  const ambiguousCsvPath = auditPath.replace(/\.jsonl$/, "-ambiguous-skipped.csv");
  const audit = fs.createWriteStream(auditPath, { flags: "a" });
  const revertCsv = fs.createWriteStream(revertCsvPath, { flags: "a" });
  revertCsv.write(
    "terrosAccountId,externalLeadId,enerfloNumericId,customerName,residentEmail,"
    + "beforeSetterUserId,beforeSetterEmail,beforeAgentUserId,beforeAgentEmail,"
    + "afterSetterUserId,afterSetterEmail,afterAgentUserId,afterAgentEmail,"
    + "revertSetterUserId,revertAgentUserId\n",
  );

  function csvEscape(value) {
    const text = value == null ? "" : String(value);
    return text.includes(",") || text.includes('"') || text.includes("\n")
      ? `"${text.replace(/"/g, '""')}"`
      : text;
  }

  function resolveEnerfloUserEmail(userId) {
    if (userId == null) return "";
    return enerfloUserIdToEmail.get(userId) || "";
  }

  function writeRevertRow(row) {
    revertCsv.write(
      [
        row.accountId,
        row.externalLeadId,
        row.numericId,
        row.customerName,
        row.residentEmail,
        row.beforeSetterUserId ?? "",
        row.beforeSetterEmail,
        row.beforeAgentUserId ?? "",
        row.beforeAgentEmail,
        row.afterSetterUserId ?? "",
        row.afterSetterEmail,
        row.afterAgentUserId ?? "",
        row.afterAgentEmail,
        row.revertSetterUserId ?? "",
        row.revertAgentUserId ?? "",
      ].map(csvEscape).join(",") + "\n",
    );
  }

  const terrosUserIdToEmail = new Map();
  const enerfloEmailToUserId = new Map();
  const enerfloUserIdToEmail = new Map();
  const enerfloCustomerCache = new Map();
  const enerfloV1SearchCache = new Map();
  /** @type {Map<string, string>} terrosAccountId → enerflo numeric customer id from INPUT_CSV / name-email match */
  const csvNumericByAccountId = new Map();
  /** @type {Map<string, { accountId: string, residentEmail: string, nameKey: string, enerfloCustomerId: string }>} */
  const nameEmailMeta = new Map();

  let lastStart = 0;
  let chain = Promise.resolve();

  function slot() {
    chain = chain.then(async () => {
      const wait = Math.max(0, lastStart + MIN_INTERVAL_MS - Date.now());
      if (wait) await sleep(wait);
      lastStart = Date.now();
    });
    return chain;
  }

  async function req(url, init, tag) {
    for (let attempt = 0; ; attempt++) {
      await slot();
      let res;
      try {
        res = await fetch(url, init);
      } catch (e) {
        if (attempt >= MAX_RETRIES) throw new Error(`${tag} network: ${e.message}`);
        await sleep(Math.min(15000, 500 * 2 ** attempt));
        continue;
      }
      if (res.status === 429 || res.status >= 500) {
        if (attempt >= MAX_RETRIES) throw new Error(`${tag} -> ${res.status} (gave up)`);
        const ra = Number(res.headers.get("retry-after"));
        await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : Math.min(20000, 600 * 2 ** attempt));
        continue;
      }
      return res;
    }
  }

  const enerfloHeaders = { "api-key": enerfloKey, "Content-Type": "application/json" };

  async function postTerros(endpoint, body) {
    const res = await req(
      `${terrosBase}${endpoint}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `ApiKey ${terrosKey}` },
        body: JSON.stringify(body),
      },
      `terros ${endpoint}`,
    );
    const text = await res.text();
    return { status: res.status, ok: res.ok && terrosOk(text), text };
  }

  async function fetchTerrosAccountById(accountId) {
    const id = String(accountId || "").trim();
    if (!id) return null;
    for (const body of [{ accountId: id }, { id }, { account: { accountId: id, id } }]) {
      const resp = await postTerros("/account/get", body);
      if (!resp.ok) continue;
      try {
        const parsed = JSON.parse(resp.text);
        const acc = parsed.account ?? parsed.data;
        if (acc && typeof acc === "object") return acc;
      } catch {
        /* try next body shape */
      }
    }
    return null;
  }

  async function fetchEnerfloCustomer(lookupId) {
    const key = String(lookupId || "").trim();
    if (!key) return null;
    if (enerfloCustomerCache.has(key)) return enerfloCustomerCache.get(key);
    const res = await req(
      `${enerfloBase}/api/v3/customers/${encodeURIComponent(key)}`,
      { headers: enerfloHeaders },
      `v3 customer ${key}`,
    );
    if (!res.ok) {
      enerfloCustomerCache.set(key, null);
      return null;
    }
    const parsed = JSON.parse(await res.text());
    const src = parsed.customer ?? parsed.data ?? parsed;
    enerfloCustomerCache.set(key, src);
    return src;
  }

  async function searchEnerfloV1Customers(query) {
    const q = String(query || "").trim();
    if (!q) return [];
    if (enerfloV1SearchCache.has(q)) return enerfloV1SearchCache.get(q);
    const res = await req(
      `${enerfloBase}/api/v1/customers?search=${encodeURIComponent(q)}&pageSize=50`,
      { headers: enerfloHeaders },
      `v1 search ${q.slice(0, 30)}`,
    );
    if (!res.ok) {
      enerfloV1SearchCache.set(q, []);
      return [];
    }
    const parsed = JSON.parse(await res.text());
    const rows = Array.isArray(parsed?.data) ? parsed.data : [];
    enerfloV1SearchCache.set(q, rows);
    return rows;
  }

  // Generic/placeholder resident emails shared by many unrelated customers (junk-data lead
  // capture defaults) — never trust an email-only match against one of these.
  const GENERIC_EMAIL_RE = /^(noemail|no-email|noemail1|unknown|none|na|n\/a|test|customer|placeholder|donotreply|do-not-reply)@/i;
  function isGenericEmail(email) {
    return !email || GENERIC_EMAIL_RE.test(String(email).trim());
  }

  function rowPhone(r) {
    return digitsOnly(r?.mobile || r?.phone || r?.mobile_phone);
  }
  function rowName(r) {
    return `${r?.first_name || ""} ${r?.last_name || ""}`.trim().toLowerCase();
  }
  function rowEmail(r) {
    return normalizeEmail(r?.email || r?.Email);
  }

  /**
   * Never guess: only return a row when exactly one candidate uniquely satisfies the strongest
   * available signal. A shared/placeholder email (e.g. "noemail@gmail.com") is explicitly
   * distrusted on its own — it must be corroborated by phone or name to disambiguate.
   */
  function chooseBestV1Row(rows, opts) {
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const externalLeadId = String(opts.externalLeadId || "").trim();
    const residentEmail = normalizeEmail(opts.residentEmail || "");
    const residentPhone = digitsOnly(opts.residentPhone || "");
    const residentName = String(opts.residentName || "").trim().toLowerCase();
    const emailIsGeneric = isGenericEmail(residentEmail);

    const byIntegration = externalLeadId
      ? rows.find((r) => {
          const integrations = r?.integrations;
          const map = integrations?.["Enerflo V2"];
          const rec = map?.EnerfloV2Customer;
          return String(rec?.integration_record_id || "").trim() === externalLeadId;
        })
      : null;
    if (byIntegration) return byIntegration;

    const byNumericId = externalLeadId
      ? rows.find((r) => String(r?.id || "").trim() === externalLeadId)
      : null;
    if (byNumericId) return byNumericId;

    if (UUID_RE.test(externalLeadId)) {
      const byUuid = rows.find((r) => {
        const integV2 = ((r?.integrations)?.["Enerflo V2"])?.EnerfloV2Customer;
        return String(integV2?.integration_record_id || "").trim() === externalLeadId;
      });
      if (byUuid) return byUuid;
    }

    const emailMatches = residentEmail ? rows.filter((r) => rowEmail(r) === residentEmail) : [];

    if (residentEmail && !emailIsGeneric) {
      if (emailMatches.length === 1) return emailMatches[0];
      // Multiple rows share this (non-generic but still ambiguous) email — disambiguate.
      if (emailMatches.length > 1) {
        if (residentPhone) {
          const hit = emailMatches.filter((r) => rowPhone(r) === residentPhone);
          if (hit.length === 1) return hit[0];
        }
        if (residentName) {
          const hit = emailMatches.filter((r) => rowName(r) === residentName);
          if (hit.length === 1) return hit[0];
        }
        return null; // ambiguous — do not guess
      }
    }

    if (residentPhone) {
      const phoneMatches = rows.filter((r) => rowPhone(r) === residentPhone);
      if (phoneMatches.length === 1) return phoneMatches[0];
      if (phoneMatches.length > 1) {
        if (residentName) {
          const hit = phoneMatches.filter((r) => rowName(r) === residentName);
          if (hit.length === 1) return hit[0];
        }
        if (residentEmail && !emailIsGeneric) {
          const hit = phoneMatches.filter((r) => rowEmail(r) === residentEmail);
          if (hit.length === 1) return hit[0];
        }
        return null; // multiple people share this phone — do not guess
      }
    }

    if (residentName) {
      const nameMatches = rows.filter((r) => rowName(r) === residentName);
      if (nameMatches.length === 1) return nameMatches[0];
      if (nameMatches.length > 1) {
        if (residentPhone) {
          const hit = nameMatches.filter((r) => rowPhone(r) === residentPhone);
          if (hit.length === 1) return hit[0];
        }
        if (residentEmail && !emailIsGeneric) {
          const hit = nameMatches.filter((r) => rowEmail(r) === residentEmail);
          if (hit.length === 1) return hit[0];
        }
        return null; // multiple people share this exact name — do not guess
      }
    }

    // Generic/placeholder email alone (no phone/name corroboration) — never trust it.
    return null;
  }

  function getEnerfloNumericIdFromRow(row) {
    const id = row?.id ?? row?.customer_id;
    return id != null ? String(id) : null;
  }

  function getEnerfloV2UuidFromRow(row) {
    for (const key of ["uuid", "external_id"]) {
      const raw = row?.[key];
      if (typeof raw === "string" && UUID_RE.test(raw.trim())) return raw.trim();
    }
    const maps = row?.integration_maps;
    if (Array.isArray(maps)) {
      for (const map of maps) {
        const extId = map?.external_id;
        if (typeof extId === "string" && UUID_RE.test(extId.trim())) return extId.trim();
      }
    }
    const integV2 = ((row?.integrations)?.["Enerflo V2"])?.EnerfloV2Customer;
    const fromInteg = integV2?.integration_record_id;
    if (typeof fromInteg === "string" && UUID_RE.test(fromInteg.trim())) return fromInteg.trim();
    return null;
  }

  async function resolveEnerfloNumericCustomerId(externalLeadId, terrosAccountId, residentEmail) {
    const cached = terrosAccountId ? csvNumericByAccountId.get(terrosAccountId) : null;
    if (cached) return cached;

    const ref = String(externalLeadId || "").trim();
    if (/^\d+$/.test(ref)) return ref;

    if (residentEmail) {
      const rows = await searchEnerfloV1Customers(residentEmail);
      const best = chooseBestV1Row(rows, {
        externalLeadId: ref,
        residentEmail,
        residentPhone: "",
        residentName: "",
      });
      const numeric = best ? getEnerfloNumericIdFromRow(best) : null;
      if (numeric) return numeric;
    }

    if (UUID_RE.test(ref)) {
      const rows = await searchEnerfloV1Customers(ref);
      const best = chooseBestV1Row(rows, { externalLeadId: ref, residentEmail, residentPhone: "", residentName: "" });
      const numeric = best ? getEnerfloNumericIdFromRow(best) : null;
      if (numeric) return numeric;
    }

    if (terrosAccountId) {
      const rows = await searchEnerfloV1Customers(terrosAccountId);
      for (const row of rows) {
        const partnerLead = row?.integrations?.Partner?.Lead;
        const integId = partnerLead?.integration_record_id;
        if (String(integId || "").trim() === terrosAccountId) {
          const numeric = getEnerfloNumericIdFromRow(row);
          if (numeric) return numeric;
        }
      }
    }

    return null;
  }

  async function loadEnerfloUsers() {
    for (let page = 1; page <= 100; page++) {
      const res = await req(
        `${enerfloBase}/api/v3/users?page=${page}&pageSize=100`,
        { headers: enerfloHeaders },
        `v3 users p${page}`,
      );
      if (!res.ok) break;
      const parsed = JSON.parse(await res.text());
      const rows = parsed.results ?? parsed.items ?? parsed.users ?? parsed.data ?? [];
      if (!Array.isArray(rows) || rows.length === 0) break;
      for (const u of rows) {
        const email = normalizeEmail(u?.email ?? u?.user_email ?? "");
        const id = parseUserId(u?.id ?? u?.user_id);
        if (email && id != null) {
          enerfloEmailToUserId.set(email, id);
          enerfloUserIdToEmail.set(id, email);
        }
      }
      if (rows.length < 100) break;
    }
  }

  function resolveTerrosUserEmail(userId, nestedObj) {
    const fromNested = nestedEmail(nestedObj);
    if (fromNested) return fromNested;
    const id = String(userId || "").trim();
    if (!id) return null;
    return terrosUserIdToEmail.get(id) || null;
  }

  function writeAudit(obj) {
    audit.write(`${JSON.stringify({ ts: nowTs(), ...obj })}\n`);
  }

  function buildLeadUpsertBody(accountId, terrosOwnerEmail, terrosCloserEmail, resident) {
    const firstName = String(resident?.firstName || "").trim();
    const lastName = String(resident?.lastName || "").trim();
    const name = String(resident?.name || "").trim();
    const lead = {
      first_name: firstName || (name ? name.split(/\s+/)[0] : "N/A"),
      last_name: lastName || (name ? name.split(/\s+/).slice(1).join(" ") || "N/A" : "N/A"),
      address: "Unknown",
      city: "Unknown",
      state: "XX",
      zip: "00000",
      integration_record_id: accountId,
      office_match: "manual",
    };
    const email = String(resident?.email || "").trim();
    const phone = String(resident?.phone || "").trim();
    if (email) lead.email = email;
    if (phone) lead.mobile = phone;
    if (terrosOwnerEmail) lead.setter_email = terrosOwnerEmail;
    if (terrosCloserEmail) lead.assign_to_email = terrosCloserEmail;
    return { lead };
  }

  async function applyEnerfloUpdate(numericId, body, accountId, terrosOwnerEmail, terrosCloserEmail, resident) {
    const v3Path = `${enerfloBase}/api/v3/customers/${encodeURIComponent(numericId)}`;
    const putRes = await req(
      v3Path,
      { method: "PUT", headers: enerfloHeaders, body: JSON.stringify(body) },
      `PUT ${numericId}`,
    );
    if (putRes.ok) {
      return { ok: true, path: "v3-customer-put", status: putRes.status, text: "" };
    }
    const putText = await putRes.text();
    if (putRes.status !== 403) {
      return { ok: false, path: "v3-customer-put", status: putRes.status, text: putText.slice(0, 300) };
    }

    const leadBody = buildLeadUpsertBody(accountId, terrosOwnerEmail, terrosCloserEmail, resident);
    const leadRes = await req(
      `${enerfloBase}/api/v1/partner/action/lead/add`,
      { method: "POST", headers: enerfloHeaders, body: JSON.stringify(leadBody) },
      `lead/add ${numericId}`,
    );
    const leadText = await leadRes.text();
    return {
      ok: leadRes.ok,
      path: "v1-lead-upsert",
      status: leadRes.status,
      text: leadText.slice(0, 300),
    };
  }

  // ── Bootstrap caches ────────────────────────────────────────────────────────
  console.log(
    `Mode: ${isRun ? "RUN" : "DRY RUN"}${limit ? ` (limit=${limit})` : ""}${
      matchMode === "name-email" ? " (match=name+email unique)" : ""
    }${useExportAssignments ? " (export-assignments)" : ""}${
      resumeAuditPath ? ` (resume=${path.basename(resumeAuditPath)})` : ""
    }${inputCsvPath ? ` (inputCsv=${path.basename(inputCsvPath)})` : ""
    }${targetTerrosAccountId ? ` (terrosAccount=${targetTerrosAccountId})` : ""
    }${targetExternalLeadId ? ` (externalLeadId=${targetExternalLeadId})` : ""}`,
  );
  if (BLOCKED_ASSIGNMENT_EMAILS.size) {
    console.log(`Blocked assignment emails: ${[...BLOCKED_ASSIGNMENT_EMAILS].join(", ")}`);
  }

  const usersResp = await postTerros("/user/list", {});
  if (!usersResp.ok) throw new Error(`Terros /user/list failed (${usersResp.status})`);
  const usersParsed = JSON.parse(usersResp.text);
  const users = Array.isArray(usersParsed.users) ? usersParsed.users : [];
  for (const u of users) {
    const email = normalizeEmail(u?.email);
    const userId = pick(u, ["userId", "id"]);
    if (email && userId) {
      terrosUserIdToEmail.set(userId, email);
    }
  }
  console.log(`Loaded ${terrosUserIdToEmail.size} Terros users`);

  await loadEnerfloUsers();
  console.log(`Loaded ${enerfloEmailToUserId.size} Enerflo users`);

  const stats = {
    scanned: 0,
    linked: 0,
    wouldUpdate: 0,
    updated: 0,
    alreadyInSync: 0,
    skippedNoExternalLeadId: 0,
    skippedNoOwnerOrCloser: 0,
    skippedNoEnerfloCustomer: 0,
    skippedNoNumericId: 0,
    skippedOwnerEmailNotInEnerflo: 0,
    skippedCloserEmailNotInEnerflo: 0,
    skippedBlockedEmail: 0,
    skippedJonasAccount: 0,
    skippedSupersededDuplicate: 0,
    skippedNameEmailAmbiguous: 0,
    skippedIdentityMismatch: 0,
    nameEmailMultiEnerfloTerros: 0,
    enerfloTargetsProcessed: 0,
    skippedNameEmailLiveMismatch: 0,
    skippedResumePreviouslyProcessed: 0,
    failedUpdate: 0,
    pages: 0,
  };

  let stopEarly = false;

  function isNumericExternalLeadId(value) {
    return /^\d+$/.test(String(value || "").trim());
  }

  async function* paginateAllAccounts() {
    let sortTimestamp;
    while (true) {
      const body = {
        size: PAGE_SIZE,
        searchInput: {
          sortBy: "lastActionDate",
          sortOrder: "asc",
          ...(sortTimestamp !== undefined ? { sortTimestamp } : {}),
        },
      };
      const resp = await postTerros("/account/list", body);
      if (!resp.ok) throw new Error(`Terros /account/list failed (${resp.status})`);
      const parsed = JSON.parse(resp.text);
      const rows = parsed.accounts ?? parsed.data ?? [];
      if (!Array.isArray(rows) || rows.length === 0) break;

      stats.pages += 1;
      yield rows;

      if (rows.length < PAGE_SIZE) break;
      const lastActionDate = rows[rows.length - 1]?.lastActionDate;
      if (typeof lastActionDate !== "number") break;
      sortTimestamp = lastActionDate;
    }
  }

  /** @type {Record<string, unknown>[]} */
  const linkedAccounts = [];
  /** @type {{ accountId: string, externalLeadId: string, enerfloCustomerId: string }[]} */
  const inputCsvRows = [];

  if (matchMode === "name-email") {
    if (!fs.existsSync(terrosExportPath) || !fs.existsSync(enerfloExportPath)) {
      throw new Error(
        `MATCH_MODE=name-email requires TERROS_EXPORT and ENERFLO_EXPORT CSVs (got terros=${terrosExportPath}, enerflo=${enerfloExportPath})`,
      );
    }
    const { unique, multiEnerfloTerros } = buildNameEmailUniqueMatches(terrosExportPath, enerfloExportPath);
    stats.nameEmailMultiEnerfloTerros = multiEnerfloTerros;

    const multiMatchCsv = fs.createWriteStream(ambiguousCsvPath, { flags: "a" });
    multiMatchCsv.write(
      "terrosAccountId,customerName,residentEmail,nameKey,externalLeadId,enerfloCustomerIds\n",
    );
    for (const row of unique) {
      if ((row.enerfloCustomerIds?.length ?? 0) <= 1) continue;
      multiMatchCsv.write(
        [
          row.accountId,
          row.customerName,
          row.residentEmail,
          row.nameKey,
          row.externalLeadId,
          row.enerfloCustomerIds.join("|"),
        ].map((v) => csvEscape(v)).join(",") + "\n",
      );
    }
    multiMatchCsv.end();
    console.log(
      `Name+email matches: ${unique.length} Terros account(s) (${multiEnerfloTerros} with 2+ Enerflo hits)`,
    );
    console.log(`Terros export: ${path.basename(terrosExportPath)}`);
    console.log(`Enerflo export: ${path.basename(enerfloExportPath)}`);

    for (const row of unique) {
      csvNumericByAccountId.set(row.accountId, row.enerfloCustomerId);
      nameEmailMeta.set(row.accountId, row);
    }

    const resumeSkip = resumeAuditPaths.length
      ? loadResumeSkipSet(resumeAuditPaths.join(","))
      : new Set();
    if (resumeSkip.size) {
      console.log(
        `Resume: skipping ${resumeSkip.size} account(s) from ${resumeAuditPaths.length} prior audit(s)`,
      );
    }

    const workList = unique.filter((row) => {
      if (!resumeSkip.has(row.accountId)) return true;
      stats.skippedResumePreviouslyProcessed += 1;
      writeAudit({
        action: "skip",
        reason: "resume-already-processed",
        accountId: row.accountId,
        resumeAudit: path.basename(resumeAuditPath),
      });
      return false;
    });

    if (useExportAssignments) {
      console.log(
        `Using Terros export assignments (no /account/get) for ${workList.length} account(s)…`,
      );
      for (const row of workList) {
        stats.scanned += 1;
        if (targetExternalLeadId && row.externalLeadId !== targetExternalLeadId) continue;
        linkedAccounts.push(buildAccountFromExportRow(row));
      }
      console.log(`  loaded ${linkedAccounts.length} account(s) from export`);
    } else {
      console.log(`Loading ${workList.length} Terros accounts via /account/get…`);
      for (let i = 0; i < workList.length; i++) {
        const { accountId: id } = workList[i];
        stats.scanned += 1;
        const acc = await fetchTerrosAccountById(id);
        if (!acc) {
          writeAudit({ action: "skip", reason: "terros-account-not-found", accountId: id });
          continue;
        }
        const resident = acc?.resident && typeof acc.resident === "object" ? acc.resident : {};
        const liveEmail = normalizeEmail(resident.email);
        const liveNameKey =
          normalizeName(`${resident.firstName || ""} ${resident.lastName || ""}`) ||
          normalizeName(pick(acc, ["name"]));
        const meta = nameEmailMeta.get(id);
        if (!meta || liveEmail !== meta.residentEmail || liveNameKey !== meta.nameKey) {
          stats.skippedNameEmailLiveMismatch += 1;
          writeAudit({
            action: "skip",
            reason: "name-email-terros-live-mismatch",
            accountId: id,
            exportEmail: meta?.residentEmail,
            liveEmail,
            exportNameKey: meta?.nameKey,
            liveNameKey,
          });
          continue;
        }
        if (targetExternalLeadId) {
          const externalLeadId = pick(acc, ["externalLeadId"]);
          if (externalLeadId !== targetExternalLeadId) continue;
        }
        linkedAccounts.push(acc);
        if ((i + 1) % 200 === 0 || i + 1 === workList.length) {
          console.log(
            `  fetched ${i + 1}/${workList.length} accounts (${linkedAccounts.length} verified)`,
          );
        }
      }
    }
  } else if (inputCsvPath) {
    if (!fs.existsSync(inputCsvPath)) {
      throw new Error(`INPUT_CSV not found: ${inputCsvPath}`);
    }
    inputCsvRows.push(...loadRowsFromCsv(inputCsvPath));
    for (const row of inputCsvRows) {
      if (row.enerfloCustomerId) {
        csvNumericByAccountId.set(row.accountId, row.enerfloCustomerId);
      }
    }
    console.log(
      `Loading ${inputCsvRows.length} Terros accounts from CSV via /account/get (skipped full pagination)`,
    );
    for (let i = 0; i < inputCsvRows.length; i++) {
      const { accountId: id } = inputCsvRows[i];
      stats.scanned += 1;
      const acc = await fetchTerrosAccountById(id);
      if (!acc) {
        writeAudit({ action: "skip", reason: "terros-account-not-found", accountId: id });
        continue;
      }
      const externalLeadId = pick(acc, ["externalLeadId"]);
      if (!externalLeadId && REQUIRE_EXTERNAL_LEAD_ID) {
        stats.skippedNoExternalLeadId += 1;
        writeAudit({ action: "skip", reason: "no-externalLeadId", accountId: id });
        continue;
      }
      if (targetExternalLeadId && externalLeadId !== targetExternalLeadId) continue;
      linkedAccounts.push(acc);
      if ((i + 1) % 100 === 0 || i + 1 === inputCsvRows.length) {
        console.log(`  fetched ${i + 1}/${inputCsvRows.length} accounts (${linkedAccounts.length} linked)`);
      }
    }
  } else if (targetTerrosAccountId) {
    const acc = await fetchTerrosAccountById(targetTerrosAccountId);
    if (!acc) {
      throw new Error(`Terros /account/get failed for ${targetTerrosAccountId}`);
    }
    stats.scanned = 1;
    const externalLeadId = pick(acc, ["externalLeadId"]);
    if (!externalLeadId) {
      stats.skippedNoExternalLeadId += 1;
      throw new Error(`Terros account ${targetTerrosAccountId} has no externalLeadId`);
    }
    if (targetExternalLeadId && externalLeadId !== targetExternalLeadId) {
      throw new Error(
        `Terros account ${targetTerrosAccountId} externalLeadId=${externalLeadId} does not match TARGET_EXTERNAL_LEAD_ID=${targetExternalLeadId}`,
      );
    }
    linkedAccounts.push(acc);
    console.log(`Loaded 1 Terros account via /account/get (skipped full pagination)`);
  } else {
    for await (const batch of paginateAllAccounts()) {
      for (const acc of batch) {
        stats.scanned += 1;
        const externalLeadId = pick(acc, ["externalLeadId"]);
        if (!externalLeadId) {
          stats.skippedNoExternalLeadId += 1;
          continue;
        }
        if (targetExternalLeadId && externalLeadId !== targetExternalLeadId) {
          continue;
        }
        linkedAccounts.push(acc);
      }
    }
  }

  // Prefer UUID externalLeadId (Enerflo v2 customer id). Skip numeric-only duplicates when
  // another Terros account links the same Enerflo customer via UUID.
  const canonicalUuidAccountByNumericId = new Map();
  if (inputCsvRows.length) {
    for (const row of inputCsvRows) {
      if (row.accountId && row.enerfloCustomerId && UUID_RE.test(row.externalLeadId || "")) {
        canonicalUuidAccountByNumericId.set(String(row.enerfloCustomerId), row.accountId);
      }
    }
    console.log(`Built Enerflo id map from CSV (${canonicalUuidAccountByNumericId.size} entries, no API lookup)`);
  } else if (matchMode === "name-email") {
    for (const [, meta] of nameEmailMeta) {
      for (const match of meta.enerfloMatches ?? []) {
        if (match.customerUuid && UUID_RE.test(match.customerUuid)) {
          canonicalUuidAccountByNumericId.set(String(match.customerId), meta.accountId);
        }
      }
    }
    for (const acc of linkedAccounts) {
      const externalLeadId = pick(acc, ["externalLeadId"]);
      if (!UUID_RE.test(externalLeadId)) continue;
      const accountId = pick(acc, ["accountId", "id"]);
      const numericId = csvNumericByAccountId.get(accountId);
      if (numericId) canonicalUuidAccountByNumericId.set(String(numericId), accountId);
    }
    console.log(
      `Built Enerflo id map from name-email exports (${canonicalUuidAccountByNumericId.size} entries)`,
    );
  } else {
    let resolveCount = 0;
    for (const acc of linkedAccounts) {
      const externalLeadId = pick(acc, ["externalLeadId"]);
      if (!UUID_RE.test(externalLeadId)) continue;
      const accountId = pick(acc, ["accountId", "id"]);
      const resident = acc?.resident && typeof acc.resident === "object" ? acc.resident : {};
      const residentEmail = normalizeEmail(resident?.email || "");
      const numericId = await resolveEnerfloNumericCustomerId(externalLeadId, accountId, residentEmail);
      if (numericId) {
        canonicalUuidAccountByNumericId.set(numericId, accountId);
      }
      resolveCount += 1;
      if (resolveCount % 100 === 0) {
        console.log(`  resolving Enerflo ids ${resolveCount}/${linkedAccounts.length}...`);
      }
    }
  }

  const supersededAccountIds = new Set();
  for (const acc of linkedAccounts) {
    const accountId = pick(acc, ["accountId", "id"]);
    const externalLeadId = pick(acc, ["externalLeadId"]);
    const enerfloNumericId = isNumericExternalLeadId(externalLeadId)
      ? externalLeadId
      : csvNumericByAccountId.get(accountId) || null;
    if (!enerfloNumericId) continue;
    const canonicalAccountId = canonicalUuidAccountByNumericId.get(String(enerfloNumericId));
    if (!canonicalAccountId || canonicalAccountId === accountId) continue;
    if (UUID_RE.test(externalLeadId || "")) continue;
    if (targetExternalLeadId === externalLeadId) continue;
    supersededAccountIds.add(accountId);
    stats.skippedSupersededDuplicate += 1;
    writeAudit({
      action: "skip",
      reason: "superseded-numeric-duplicate",
      accountId,
      externalLeadId,
      canonicalTerrosAccountId: canonicalAccountId,
      enerfloNumericId,
    });
  }

  if (stats.skippedSupersededDuplicate) {
    console.log(
      `Skipping ${stats.skippedSupersededDuplicate} numeric externalLeadId duplicate(s); UUID-linked account wins`,
    );
  }

  for (const acc of linkedAccounts) {
      const accountId = pick(acc, ["accountId", "id"]);
      if (supersededAccountIds.has(accountId)) continue;

      const externalLeadId = pick(acc, ["externalLeadId"]);
      const matchMeta = nameEmailMeta.get(accountId) || null;
      const name = pick(acc, ["name"]);
      const resident = acc?.resident && typeof acc.resident === "object" ? acc.resident : {};
      const residentEmail = normalizeEmail(resident?.email || "");
      const residentPhone = digitsOnly(resident?.phone || "");
      const residentName =
        `${resident?.firstName || ""} ${resident?.lastName || ""}`.trim() || name;

      const matchedTarget = Boolean(targetExternalLeadId);
      stats.linked += 1;

      const owner = acc?.owner && typeof acc.owner === "object" ? acc.owner : {};
      const closer = acc?.closer && typeof acc.closer === "object" ? acc.closer : {};
      const terrosOwnerId = pick(acc, ["ownerId"]) || pick(owner, ["userId", "id"]);
      const terrosCloserId = pick(acc, ["closerId"]) || pick(closer, ["userId", "id"]);

      const terrosOwnerEmail = resolveTerrosUserEmail(terrosOwnerId, owner);
      const terrosCloserEmail = resolveTerrosUserEmail(terrosCloserId, closer);

      if (
        (terrosOwnerEmail && isBlockedAssignmentEmail(terrosOwnerEmail)) ||
        (terrosCloserEmail && isBlockedAssignmentEmail(terrosCloserEmail))
      ) {
        stats.skippedJonasAccount += 1;
        writeAudit({
          action: "skip",
          reason: "jonas-owner-or-closer",
          accountId,
          externalLeadId,
          terrosOwnerEmail,
          terrosCloserEmail,
        });
        continue;
      }

      if (!terrosOwnerEmail && !terrosCloserEmail) {
        stats.skippedNoOwnerOrCloser += 1;
        writeAudit({
          action: "skip",
          reason: "no-owner-or-closer",
          accountId,
          externalLeadId,
          terrosOwnerId,
          terrosCloserId,
        });
        continue;
      }

      let targetSetterUserId = null;
      let targetAgentUserId = null;
      let skipOwner = false;
      let skipCloser = false;

      if (terrosOwnerEmail) {
        if (isBlockedAssignmentEmail(terrosOwnerEmail)) {
          skipOwner = true;
          stats.skippedBlockedEmail += 1;
          writeAudit({
            action: "skip-field",
            reason: "blocked-owner-email",
            accountId,
            externalLeadId,
            terrosOwnerEmail,
          });
        } else {
          targetSetterUserId = enerfloEmailToUserId.get(normalizeEmail(terrosOwnerEmail)) ?? null;
          if (targetSetterUserId == null) {
            stats.skippedOwnerEmailNotInEnerflo += 1;
            writeAudit({
              action: "skip-field",
              reason: "owner-email-not-in-enerflo",
              accountId,
              externalLeadId,
              terrosOwnerEmail,
              terrosCloserEmail,
            });
          }
        }
      }

      if (terrosCloserEmail) {
        if (isBlockedAssignmentEmail(terrosCloserEmail)) {
          skipCloser = true;
          stats.skippedBlockedEmail += 1;
          writeAudit({
            action: "skip-field",
            reason: "blocked-closer-email",
            accountId,
            externalLeadId,
            terrosCloserEmail,
          });
        } else {
          targetAgentUserId = enerfloEmailToUserId.get(normalizeEmail(terrosCloserEmail)) ?? null;
          if (targetAgentUserId == null) {
            stats.skippedCloserEmailNotInEnerflo += 1;
            writeAudit({
              action: "skip-field",
              reason: "closer-email-not-in-enerflo",
              accountId,
              externalLeadId,
              terrosOwnerEmail,
              terrosCloserEmail,
            });
          }
        }
      }

      const putBody = {};
      if (targetSetterUserId != null) putBody.setter_user_id = targetSetterUserId;
      if (targetAgentUserId != null) putBody.agent_user_id = targetAgentUserId;

      if (Object.keys(putBody).length === 0) {
        writeAudit({
          action: "skip",
          reason: skipOwner || skipCloser ? "blocked-assignment-email" : "no-resolvable-assignment",
          accountId,
          externalLeadId,
          terrosOwnerEmail,
          terrosCloserEmail,
        });
        continue;
      }

      /** @type {string[]} */
      let enerfloTargetIds = [];
      if (matchMeta?.enerfloCustomerIds?.length) {
        enerfloTargetIds = [...new Set(matchMeta.enerfloCustomerIds.map(String))];
      } else {
        let v1Row = null;
        let v1MatchedBy = null;
        let customer = externalLeadId ? await fetchEnerfloCustomer(externalLeadId) : null;
        if (!customer) {
          // A generic/shared email (e.g. "noemail@gmail.com") returns an arbitrary ~50-row
          // page out of what can be 100+ matches — "unique within this page" is meaningless
          // and was previously causing false-positive matches. Drop it from search entirely.
          const searchEmail = residentEmail && !isGenericEmail(residentEmail) ? residentEmail : "";
          const searchQueries = [...new Set([externalLeadId, searchEmail, residentPhone, residentName].filter(Boolean))];
          // Merge results across all queries into one deduped pool before disambiguating —
          // a candidate that's ambiguous within a single query's page (e.g. two people sharing
          // a phone number, one of whom doesn't appear in that page) must still be checked
          // against every other signal we have, not just the rows returned by whichever query
          // happened to include it.
          const poolById = new Map();
          for (const q of searchQueries) {
            const rows = await searchEnerfloV1Customers(q);
            for (const row of rows) {
              const id = row?.id;
              if (id != null && !poolById.has(String(id))) poolById.set(String(id), row);
            }
          }
          if (poolById.size) {
            const pool = [...poolById.values()];
            const best = chooseBestV1Row(pool, {
              externalLeadId,
              residentEmail: searchEmail,
              residentPhone,
              residentName,
            });
            if (best) {
              v1Row = best;
              v1MatchedBy = "merged-pool";
            }
          }
          if (v1Row?.id != null) {
            customer = await fetchEnerfloCustomer(String(v1Row.id));
          }
        }
        if (!customer && !v1Row) {
          stats.skippedNoEnerfloCustomer += 1;
          writeAudit({
            action: "skip",
            reason: "no-enerflo-customer",
            accountId,
            externalLeadId,
            terrosOwnerEmail,
            terrosCloserEmail,
          });
          continue;
        }
        let singleId = csvNumericByAccountId.get(accountId) || null;
        if (!singleId) {
          singleId = await resolveEnerfloNumericCustomerId(externalLeadId, accountId, residentEmail);
        }
        if (!singleId && customer?.id != null) singleId = String(customer.id);
        if (!singleId) {
          stats.skippedNoNumericId += 1;
          writeAudit({
            action: "skip",
            reason: "no-numeric-id",
            accountId,
            externalLeadId,
            terrosOwnerEmail,
            terrosCloserEmail,
            v1MatchedBy,
          });
          continue;
        }
        enerfloTargetIds = [String(singleId)];
      }

      for (const numericId of enerfloTargetIds) {
        stats.enerfloTargetsProcessed += 1;

        let customer = await fetchEnerfloCustomer(numericId);
        if (!customer) {
          stats.skippedNoEnerfloCustomer += 1;
          writeAudit({
            action: "skip",
            reason: "no-enerflo-customer",
            accountId,
            externalLeadId,
            numericId,
            terrosOwnerEmail,
            terrosCloserEmail,
          });
          continue;
        }

        if (matchMeta && !useExportAssignments) {
          const liveEnerfloEmail = normalizeEmail(customer?.email);
          const liveEnerfloName = normalizeName(
            `${customer?.first_name || ""} ${customer?.last_name || ""}`,
          );
          if (liveEnerfloEmail !== matchMeta.residentEmail || liveEnerfloName !== matchMeta.nameKey) {
            stats.skippedNameEmailLiveMismatch += 1;
            writeAudit({
              action: "skip",
              reason: "name-email-enerflo-live-mismatch",
              accountId,
              enerfloCustomerId: numericId,
              exportEmail: matchMeta.residentEmail,
              liveEmail: liveEnerfloEmail,
              exportNameKey: matchMeta.nameKey,
              liveNameKey: liveEnerfloName,
            });
            continue;
          }
        }

        // Universal identity sanity check — protects against a *stale/wrong* Terros
        // externalLeadId pointing at an unrelated Enerflo customer (discovered in the wild:
        // Terros account for "Wayne Warren" carried externalLeadId of an Enerflo customer that
        // is actually "Adan Flores"). Require at least one strong signal (name, phone, or a
        // non-generic email) to agree before ever touching setter/agent fields.
        if (!matchMeta) {
          const liveEnerfloEmail = normalizeEmail(customer?.email);
          const liveEnerfloPhone = digitsOnly(customer?.phone || customer?.mobile || "");
          const liveEnerfloName = normalizeName(
            `${customer?.first_name || ""} ${customer?.last_name || ""}` || customer?.name || "",
          );
          const nameMatches = residentName && liveEnerfloName && normalizeName(residentName) === liveEnerfloName;
          const phoneMatches = residentPhone && liveEnerfloPhone && residentPhone === liveEnerfloPhone;
          const emailMatches =
            residentEmail && liveEnerfloEmail && !isGenericEmail(residentEmail) && residentEmail === liveEnerfloEmail;
          const haveAnySignal = Boolean(residentName || residentPhone || (residentEmail && !isGenericEmail(residentEmail)));
          if (haveAnySignal && !nameMatches && !phoneMatches && !emailMatches) {
            stats.skippedIdentityMismatch = (stats.skippedIdentityMismatch || 0) + 1;
            writeAudit({
              action: "skip",
              reason: "identity-mismatch",
              accountId,
              externalLeadId,
              numericId,
              terrosName: residentName,
              terrosPhone: residentPhone,
              terrosEmail: residentEmail,
              enerfloName: `${customer?.first_name || ""} ${customer?.last_name || ""}`.trim() || customer?.name,
              enerfloPhone: customer?.phone || customer?.mobile,
              enerfloEmail: customer?.email,
            });
            continue;
          }
        }

        const currentSetterUserId = parseUserId(customer?.setter_user_id ?? customer?.setterUserId);
        const currentAgentUserId = parseUserId(customer?.agent_user_id ?? customer?.agentUserId);

        const setterDiff = targetSetterUserId != null && currentSetterUserId !== targetSetterUserId;
        const agentDiff = targetAgentUserId != null && currentAgentUserId !== targetAgentUserId;
        const needsUpdate = setterDiff || agentDiff;

        if (!needsUpdate) {
          stats.alreadyInSync += 1;
          writeAudit({
            action: "skip",
            reason: "already-in-sync",
            accountId,
            externalLeadId,
            numericId,
            currentSetterUserId,
            currentAgentUserId,
            targetSetterUserId,
            targetAgentUserId,
            terrosOwnerEmail,
            terrosCloserEmail,
          });
          continue;
        }

        if (!isRun) {
          stats.wouldUpdate += 1;
          writeAudit({
            action: "dry-run",
            accountId,
            externalLeadId,
            numericId,
            terrosOwnerEmail,
            terrosCloserEmail,
            currentSetterUserId,
            currentAgentUserId,
            targetSetterUserId,
            targetAgentUserId,
            putBody,
          });
          if (limit != null && stats.wouldUpdate >= limit) stopEarly = true;
          continue;
        }

        const result = await applyEnerfloUpdate(
          numericId,
          putBody,
          accountId,
          terrosOwnerEmail,
          terrosCloserEmail,
          resident,
        );

        if (!result.ok) {
          stats.failedUpdate += 1;
          writeAudit({
            action: "update-failed",
            accountId,
            externalLeadId,
            numericId,
            status: result.status,
            path: result.path,
            response: result.text,
            putBody,
          });
          continue;
        }

        stats.updated += 1;
        if (stats.updated % 50 === 0) {
          console.log(`  updated ${stats.updated} Enerflo customers...`);
        }
        const beforeSetterEmail = resolveEnerfloUserEmail(currentSetterUserId);
        const beforeAgentEmail = resolveEnerfloUserEmail(currentAgentUserId);
        const afterSetterUserId = putBody.setter_user_id ?? null;
        const afterAgentUserId = putBody.agent_user_id ?? null;
        writeAudit({
          action: "updated",
          accountId,
          externalLeadId,
          numericId,
          path: result.path,
          putBody,
          terrosOwnerEmail,
          terrosCloserEmail,
          beforeSetterUserId: currentSetterUserId,
          beforeSetterEmail,
          beforeAgentUserId: currentAgentUserId,
          beforeAgentEmail,
          afterSetterUserId,
          afterSetterEmail: afterSetterUserId != null ? terrosOwnerEmail : null,
          afterAgentUserId,
          afterAgentEmail: afterAgentUserId != null ? terrosCloserEmail : null,
          revertBody: {
            ...(currentSetterUserId != null ? { setter_user_id: currentSetterUserId } : {}),
            ...(currentAgentUserId != null ? { agent_user_id: currentAgentUserId } : {}),
          },
        });
        writeRevertRow({
          accountId,
          externalLeadId,
          numericId,
          customerName: name,
          residentEmail,
          beforeSetterUserId: currentSetterUserId,
          beforeSetterEmail,
          beforeAgentUserId: currentAgentUserId,
          beforeAgentEmail,
          afterSetterUserId,
          afterSetterEmail: afterSetterUserId != null ? terrosOwnerEmail : "",
          afterAgentUserId,
          afterAgentEmail: afterAgentUserId != null ? terrosCloserEmail : "",
          revertSetterUserId: currentSetterUserId,
          revertAgentUserId: currentAgentUserId,
        });
        if (limit != null && stats.updated >= limit) stopEarly = true;
      }

      if (matchedTarget) stopEarly = true;

    if (stopEarly) break;
  }

  console.log(
    `done | scanned ${stats.scanned} | linked ${stats.linked} | resumeSkipped ${stats.skippedResumePreviouslyProcessed} | skippedJonas ${stats.skippedJonasAccount} | superseded ${stats.skippedSupersededDuplicate} | nameEmailMismatch ${stats.skippedNameEmailLiveMismatch} | wouldUpdate ${stats.wouldUpdate} | updated ${stats.updated} | alreadyInSync ${stats.alreadyInSync}`,
  );

  audit.end();
  revertCsv.end();
  console.log(
    JSON.stringify(
      {
        mode: isRun ? "run" : "dry",
        matchMode: matchMode || "externalLeadId",
        auditPath,
        revertCsvPath,
        ...(matchMode === "name-email" ? { ambiguousCsvPath } : {}),
        ...stats,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
