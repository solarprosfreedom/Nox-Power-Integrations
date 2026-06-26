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
 *     equals this value exactly (smoke test / single-lead run). Prefer the Enerflo v2 UUID, not
 *     the numeric customer id — e.g. c0a3e1cc-… not 3567978.
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

  const auditPath = path.join(root, `terros-enerflo-assignment-audit-${Date.now()}.jsonl`);
  const audit = fs.createWriteStream(auditPath, { flags: "a" });

  const terrosUserIdToEmail = new Map();
  const enerfloEmailToUserId = new Map();
  const enerfloCustomerCache = new Map();
  const enerfloV1SearchCache = new Map();

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

  function chooseBestV1Row(rows, opts) {
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const externalLeadId = String(opts.externalLeadId || "").trim();
    const residentEmail = normalizeEmail(opts.residentEmail || "");
    const residentPhone = digitsOnly(opts.residentPhone || "");
    const residentName = String(opts.residentName || "").trim().toLowerCase();

    const byIntegration = rows.find((r) => {
      const integrations = r?.integrations;
      const map = integrations?.["Enerflo V2"];
      const rec = map?.EnerfloV2Customer;
      return String(rec?.integration_record_id || "").trim() === externalLeadId;
    });
    if (byIntegration) return byIntegration;

    const byNumericId = rows.find((r) => String(r?.id || "").trim() === externalLeadId);
    if (byNumericId) return byNumericId;

    if (UUID_RE.test(externalLeadId)) {
      const byUuid = rows.find((r) => {
        const integV2 = ((r?.integrations)?.["Enerflo V2"])?.EnerfloV2Customer;
        return String(integV2?.integration_record_id || "").trim() === externalLeadId;
      });
      if (byUuid) return byUuid;
    }

    if (residentEmail) {
      const byEmail = rows.find((r) => normalizeEmail(r?.email || r?.Email) === residentEmail);
      if (byEmail) return byEmail;
    }

    if (residentPhone) {
      const byPhone = rows.find((r) => digitsOnly(r?.phone || r?.mobile_phone) === residentPhone);
      if (byPhone) return byPhone;
    }

    if (residentName) {
      const byName = rows.find((r) => {
        const full = `${r?.first_name || ""} ${r?.last_name || ""}`.trim().toLowerCase();
        return full === residentName;
      });
      if (byName) return byName;
    }

    return rows[0];
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
        if (email && id != null) enerfloEmailToUserId.set(email, id);
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
  console.log(`Mode: ${isRun ? "RUN" : "DRY RUN"}${limit ? ` (limit=${limit})` : ""}${targetExternalLeadId ? ` (target=${targetExternalLeadId})` : ""}`);
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
    skippedSupersededDuplicate: 0,
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

  // Prefer UUID externalLeadId (Enerflo v2 customer id). Skip numeric-only duplicates when
  // another Terros account links the same Enerflo customer via UUID.
  const canonicalUuidAccountByNumericId = new Map();
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
  }

  const supersededAccountIds = new Set();
  for (const acc of linkedAccounts) {
    const accountId = pick(acc, ["accountId", "id"]);
    const externalLeadId = pick(acc, ["externalLeadId"]);
    if (!isNumericExternalLeadId(externalLeadId)) continue;
    const canonicalAccountId = canonicalUuidAccountByNumericId.get(externalLeadId);
    if (!canonicalAccountId || canonicalAccountId === accountId) continue;
    if (targetExternalLeadId === externalLeadId) continue;
    supersededAccountIds.add(accountId);
    stats.skippedSupersededDuplicate += 1;
    writeAudit({
      action: "skip",
      reason: "superseded-numeric-duplicate",
      accountId,
      externalLeadId,
      canonicalTerrosAccountId: canonicalAccountId,
      enerfloNumericId: externalLeadId,
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

      let customer = await fetchEnerfloCustomer(externalLeadId);
      let v1Row = null;
      let v1MatchedBy = null;

      if (!customer) {
        const searchQueries = [...new Set([externalLeadId, residentEmail, residentPhone, residentName].filter(Boolean))];
        for (const q of searchQueries) {
          const rows = await searchEnerfloV1Customers(q);
          if (!rows.length) continue;
          const best = chooseBestV1Row(rows, { externalLeadId, residentEmail, residentPhone, residentName });
          if (best) {
            v1Row = best;
            v1MatchedBy = q;
            break;
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

      const numericId = await resolveEnerfloNumericCustomerId(externalLeadId, accountId, residentEmail);
      if (!numericId) {
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

      if (!customer || String(customer.id ?? "") !== numericId) {
        customer = await fetchEnerfloCustomer(numericId);
      }

      const currentSetterUserId = parseUserId(customer?.setter_user_id ?? customer?.setterUserId);
      const currentAgentUserId = parseUserId(customer?.agent_user_id ?? customer?.agentUserId);

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
            numericId,
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
              numericId,
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
            numericId,
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
              numericId,
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
          numericId,
        });
        continue;
      }

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
          v1MatchedBy,
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
      writeAudit({
        action: "updated",
        accountId,
        externalLeadId,
        numericId,
        path: result.path,
        putBody,
        terrosOwnerEmail,
        terrosCloserEmail,
      });
      if (limit != null && stats.updated >= limit) stopEarly = true;
      if (matchedTarget) stopEarly = true;

    if (stopEarly) break;
  }

  console.log(
    `done | scanned ${stats.scanned} | linked ${stats.linked} | superseded ${stats.skippedSupersededDuplicate} | wouldUpdate ${stats.wouldUpdate} | alreadyInSync ${stats.alreadyInSync}`,
  );

  audit.end();
  console.log(
    JSON.stringify({ mode: isRun ? "run" : "dry", auditPath, ...stats }, null, 2),
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
