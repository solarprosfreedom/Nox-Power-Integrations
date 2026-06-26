#!/usr/bin/env node
/**
 * Export Terros accounts + Enerflo leads/customers, then compare by customer name.
 *
 * CSV files are written incrementally (rows appear as each API page completes).
 * Default: only Terros accounts with externalLeadId (linked to Enerflo).
 *
 * Usage:
 *   node scripts/export-compare-terros-enerflo.mjs --export-only              # export both (linked Terros default)
 *   node scripts/export-compare-terros-enerflo.mjs --export-only --all-terros # export all Terros accounts
 *   node scripts/export-compare-terros-enerflo.mjs                            # export both + compare
 *   node scripts/export-compare-terros-enerflo.mjs --compare-only \
 *     --terros exports/terros-accounts-123.csv \
 *     --enerflo exports/enerflo-leads-123.csv
 *
 * Outputs (under integration-middleware/exports/):
 *   terros-accounts-{ts}.csv (+ .json summary)
 *   enerflo-leads-{ts}.csv (+ .json summary)
 *   compare-by-name-{ts}.csv (+ .json full report)
 */
import fs from "node:fs";
import path from "node:path";

const PAGE_SIZE = 1000;
const ENERFLO_PAGE_SIZE = 100;
const MIN_INTERVAL_MS = 80;
const MAX_RETRIES = 7;
const UUID_RE = /^[0-9a-f-]{36}$/i;

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

function pick(obj, keys) {
  for (const key of keys) {
    if (obj && obj[key] != null && String(obj[key]).trim() !== "") {
      return String(obj[key]).trim();
    }
  }
  return "";
}

function terrosOk(raw) {
  try {
    return JSON.parse(raw)?.type !== "error";
  } catch {
    return false;
  }
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function nestedEmail(obj) {
  if (!obj || typeof obj !== "object") return "";
  const user = obj.user && typeof obj.user === "object" ? obj.user : null;
  return normalizeEmail((user && user.email) || obj.email || obj.Email || "");
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

function csvEscape(value) {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function writeCsv(filePath, headers, rows) {
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(","));
  }
  fs.writeFileSync(filePath, lines.join("\n"), "utf8");
}

/** Append rows to CSV as each API batch completes. */
function createCsvWriter(filePath, headers) {
  fs.writeFileSync(filePath, `${headers.join(",")}\n`, "utf8");
  let count = 0;
  return {
    append(rows) {
      if (!rows.length) return;
      const chunk = rows.map((row) => headers.map((h) => csvEscape(row[h])).join(",")).join("\n");
      fs.appendFileSync(filePath, `${chunk}\n`, "utf8");
      count += rows.length;
    },
    get count() {
      return count;
    },
  };
}

function readCsv(filePath) {
  const raw = fs.readFileSync(filePath, "utf8").trim();
  if (!raw) return [];
  const lines = raw.split("\n");
  const headers = lines[0].split(",").map((h) => h.replace(/^"|"$/g, ""));
  return lines.slice(1).map((line) => {
    const values = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          cur += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        values.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
    values.push(cur);
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] ?? "";
    });
    return row;
  });
}

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

function parseArgs(argv) {
  const out = {
    exportOnly: false,
    compareOnly: false,
    linkedOnly: process.env.LINKED_ONLY !== "0",
    allTerros: false,
    terrosPath: "",
    enerfloPath: "",
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--export-only") out.exportOnly = true;
    else if (a === "--compare-only") out.compareOnly = true;
    else if (a === "--all-terros") {
      out.allTerros = true;
      out.linkedOnly = false;
    }
    else if (a === "--linked-only") out.linkedOnly = true;
    else if (a === "--terros" && argv[i + 1]) out.terrosPath = argv[++i];
    else if (a === "--enerflo" && argv[i + 1]) out.enerfloPath = argv[++i];
  }
  return out;
}

async function main() {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const env = loadEnv(path.join(root, ".env.local"));
  const args = parseArgs(process.argv);

  const terrosBase = (env.TERROS_API_BASE_URL || "https://api.terros.com").replace(/\/$/, "");
  const terrosKey = env.TERROS_API_KEY || "";
  const enerfloBase = (env.ENERFLO_V1_BASE_URL || "https://enerflo.io").replace(/\/$/, "");
  const enerfloKey = env.ENERFLO_V1_API_KEY || "";

  if (!terrosKey || !enerfloKey) {
    throw new Error("Missing TERROS_API_KEY or ENERFLO_V1_API_KEY in .env.local");
  }

  const exportsDir = path.join(root, "exports");
  fs.mkdirSync(exportsDir, { recursive: true });
  const ts = Date.now();

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
        if (attempt >= MAX_RETRIES) throw new Error(`${tag} -> ${res.status}`);
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
    return { ok: res.ok && terrosOk(text), text };
  }

  function terrosCustomerName(acc) {
    const resident = acc?.resident && typeof acc.resident === "object" ? acc.resident : {};
    const first = String(resident.firstName || "").trim();
    const last = String(resident.lastName || "").trim();
    const fromParts = [first, last].filter(Boolean).join(" ");
    if (fromParts) return fromParts;
    const resName = String(resident.name || "").trim();
    if (resName) return resName;
    return String(acc?.name || "").trim();
  }

  function enerfloCustomerName(row) {
    const first = String(row?.first_name || "").trim();
    const last = String(row?.last_name || "").trim();
    const fromParts = [first, last].filter(Boolean).join(" ");
    if (fromParts) return fromParts;
    return String(row?.name || row?.full_name || "").trim();
  }

  function getEnerfloUuid(row) {
    const integV2 = row?.integrations?.["Enerflo V2"]?.EnerfloV2Customer;
    const fromInteg = integV2?.integration_record_id;
    if (typeof fromInteg === "string" && UUID_RE.test(fromInteg.trim())) return fromInteg.trim();
    for (const key of ["uuid", "external_id"]) {
      const raw = row?.[key];
      if (typeof raw === "string" && UUID_RE.test(raw.trim())) return raw.trim();
    }
    return "";
  }

  async function loadTerrosUsers() {
    const resp = await postTerros("/user/list", {});
    if (!resp.ok) throw new Error("Terros /user/list failed");
    const parsed = JSON.parse(resp.text);
    const users = Array.isArray(parsed.users) ? parsed.users : [];
    const idToEmail = new Map();
    for (const u of users) {
      const id = pick(u, ["userId", "id"]);
      const email = normalizeEmail(u?.email);
      if (id && email) idToEmail.set(id, email);
    }
    return idToEmail;
  }

  async function* paginateAllAccounts() {
    let sortTimestamp;
    while (true) {
      const resp = await postTerros("/account/list", {
        size: PAGE_SIZE,
        searchInput: {
          sortBy: "lastActionDate",
          sortOrder: "asc",
          ...(sortTimestamp !== undefined ? { sortTimestamp } : {}),
        },
      });
      if (!resp.ok) throw new Error(`Terros /account/list failed`);
      const parsed = JSON.parse(resp.text);
      const rows = parsed.accounts ?? parsed.data ?? [];
      if (!Array.isArray(rows) || rows.length === 0) break;
      yield rows;
      if (rows.length < PAGE_SIZE) break;
      const next = rows[rows.length - 1]?.lastActionDate;
      if (typeof next !== "number") break;
      sortTimestamp = next;
    }
  }

  const TERROS_HEADERS = [
    "accountId",
    "customerName",
    "nameKey",
    "residentEmail",
    "residentPhone",
    "externalLeadId",
    "ownerId",
    "ownerEmail",
    "closerId",
    "closerEmail",
  ];

  const ENERFLO_HEADERS = [
    "customerId",
    "customerUuid",
    "customerName",
    "nameKey",
    "email",
    "phone",
    "leadOwnerId",
    "leadOwnerEmail",
    "setterId",
    "setterEmail",
  ];

  async function exportTerros(userIdToEmail, linkedOnly) {
    const label = linkedOnly ? "linked only (externalLeadId set)" : "all accounts";
    console.log(`Exporting Terros accounts (${label})…`);

    const csvPath = path.join(exportsDir, `terros-accounts-${ts}.csv`);
    const jsonPath = path.join(exportsDir, `terros-accounts-${ts}.json`);
    const writer = createCsvWriter(csvPath, TERROS_HEADERS);

    const seen = new Set();
    const rows = [];
    let page = 0;
    let scanned = 0;

    for await (const batch of paginateAllAccounts()) {
      page += 1;
      scanned += batch.length;
      const batchOut = [];

      for (const acc of batch) {
        const flat = flattenTerrosAccount(acc, userIdToEmail);
        if (!flat.accountId || seen.has(flat.accountId)) continue;
        seen.add(flat.accountId);
        if (linkedOnly && !flat.externalLeadId) continue;
        batchOut.push(flat);
        rows.push(flat);
      }

      writer.append(batchOut);
      if (page === 1 || page % 10 === 0) {
        console.log(`  page ${page} | scanned ${scanned} | exported ${writer.count}`);
      }
    }

    fs.writeFileSync(
      jsonPath,
      JSON.stringify({
        exported_at: new Date().toISOString(),
        source: "terros",
        linkedOnly,
        scanned,
        total: rows.length,
        csvPath,
        rows,
      }, null, 2),
      "utf8",
    );

    console.log(`Terros CSV → ${csvPath} (${writer.count} rows)`);
    return { jsonPath, csvPath, rows, scanned };
  }

  async function exportEnerflo() {
    console.log("Exporting Enerflo leads/customers (v1 list)…");

    const csvPath = path.join(exportsDir, `enerflo-leads-${ts}.csv`);
    const jsonPath = path.join(exportsDir, `enerflo-leads-${ts}.json`);
    const writer = createCsvWriter(csvPath, ENERFLO_HEADERS);

    const rows = [];
    let page = 1;

    while (true) {
      const res = await req(
        `${enerfloBase}/api/v1/customers?page=${page}&pageSize=${ENERFLO_PAGE_SIZE}`,
        { headers: enerfloHeaders },
        `enerflo p${page}`,
      );
      if (!res.ok) throw new Error(`Enerflo v1 page ${page} -> ${res.status}`);
      const parsed = JSON.parse(await res.text());
      const batch = Array.isArray(parsed?.data) ? parsed.data : [];
      if (!batch.length) break;

      const batchOut = batch.map((row) => flattenEnerfloLead(row));
      writer.append(batchOut);
      rows.push(...batchOut);

      if (page === 1 || page % 20 === 0) {
        console.log(`  page ${page}: ${writer.count} rows in CSV`);
      }

      if (batch.length < ENERFLO_PAGE_SIZE) break;
      page += 1;
    }

    fs.writeFileSync(
      jsonPath,
      JSON.stringify({
        exported_at: new Date().toISOString(),
        source: "enerflo",
        total: rows.length,
        csvPath,
        rows,
      }, null, 2),
      "utf8",
    );

    console.log(`Enerflo CSV → ${csvPath} (${writer.count} rows)`);
    return { jsonPath, csvPath, rows };
  }

  function flattenTerrosAccount(acc, userIdToEmail) {
    const accountId = pick(acc, ["accountId", "id"]);
    const customerName = terrosCustomerName(acc);
    const resident = acc?.resident && typeof acc.resident === "object" ? acc.resident : {};
    const owner = acc?.owner && typeof acc.owner === "object" ? acc.owner : {};
    const closer = acc?.closer && typeof acc.closer === "object" ? acc.closer : {};
    const ownerId = pick(acc, ["ownerId"]) || pick(owner, ["userId", "id"]);
    const closerId = pick(acc, ["closerId"]) || pick(closer, ["userId", "id"]);
    const ownerEmail = nestedEmail(owner) || userIdToEmail.get(ownerId) || "";
    const closerEmail = nestedEmail(closer) || userIdToEmail.get(closerId) || "";

    return {
      accountId,
      customerName,
      nameKey: normalizeName(customerName),
      residentEmail: normalizeEmail(resident.email),
      residentPhone: String(resident.phone || "").trim(),
      externalLeadId: pick(acc, ["externalLeadId"]),
      ownerId,
      ownerEmail,
      closerId,
      closerEmail,
    };
  }

  function flattenEnerfloLead(row) {
    const customerId = row?.id != null ? String(row.id) : "";
    const customerName = enerfloCustomerName(row);
    const ownerObj = row?.owner ?? row?.agent ?? row?.leadOwner;
    const setterObj = row?.setter_user ?? row?.setterUser;

    return {
      customerId,
      customerUuid: getEnerfloUuid(row),
      customerName,
      nameKey: normalizeName(customerName),
      email: normalizeEmail(row?.email ?? row?.Email),
      phone: String(row?.phone ?? row?.mobile_phone ?? "").trim(),
      leadOwnerId: row?.owner?.id != null ? String(row.owner.id) : row?.agent_id != null ? String(row.agent_id) : "",
      leadOwnerEmail: nestedEmail(ownerObj),
      setterId: row?.setter_id != null ? String(row.setter_id) : row?.setter?.id != null ? String(row.setter.id) : "",
      setterEmail: nestedEmail(setterObj),
    };
  }

  function compareByName(terrosRows, enerfloRows) {
    const enerfloByName = new Map();
    for (const row of enerfloRows) {
      if (!row.nameKey) continue;
      if (!enerfloByName.has(row.nameKey)) enerfloByName.set(row.nameKey, []);
      enerfloByName.get(row.nameKey).push(row);
    }

    const matched = [];
    const unmatchedTerros = [];
    const ambiguousTerros = [];

    for (const t of terrosRows) {
      if (!t.nameKey) {
        unmatchedTerros.push({ ...t, reason: "empty-name" });
        continue;
      }

      const candidates = enerfloByName.get(t.nameKey) ?? [];

      if (candidates.length === 0) {
        unmatchedTerros.push({ ...t, reason: "no-name-match" });
        continue;
      }

      let best = candidates[0];
      if (candidates.length > 1) {
        if (t.residentEmail) {
          const byEmail = candidates.find((e) => e.email && e.email === t.residentEmail);
          if (byEmail) best = byEmail;
        }
        if (candidates.length > 1 && t.externalLeadId) {
          const byId = candidates.find(
            (e) =>
              e.customerId === t.externalLeadId || e.customerUuid === t.externalLeadId,
          );
          if (byId) best = byId;
        }
        if (best === candidates[0] && candidates.length > 1) {
          ambiguousTerros.push({
            terros: t,
            enerfloCandidates: candidates,
          });
        }
      }

      const setterWouldChange =
        t.ownerEmail &&
        best.setterEmail &&
        normalizeEmail(t.ownerEmail) !== normalizeEmail(best.setterEmail);
      const leadOwnerWouldChange =
        t.closerEmail &&
        best.leadOwnerEmail &&
        normalizeEmail(t.closerEmail) !== normalizeEmail(best.leadOwnerEmail);

      matched.push({
        nameKey: t.nameKey,
        customerName: t.customerName,
        terrosAccountId: t.accountId,
        terrosExternalLeadId: t.externalLeadId,
        terrosOwnerEmail: t.ownerEmail,
        terrosCloserEmail: t.closerEmail,
        enerfloCustomerId: best.customerId,
        enerfloCustomerUuid: best.customerUuid,
        enerfloLeadOwnerEmail: best.leadOwnerEmail,
        enerfloSetterEmail: best.setterEmail,
        enerfloEmail: best.email,
        matchCandidateCount: candidates.length,
        assignmentDiff: {
          setter: setterWouldChange || Boolean(t.ownerEmail && !best.setterEmail),
          leadOwner: leadOwnerWouldChange || Boolean(t.closerEmail && !best.leadOwnerEmail),
        },
      });
    }

    const matchedNameKeys = new Set(matched.map((m) => `${m.nameKey}::${m.enerfloCustomerId}`));
    const unmatchedEnerflo = enerfloRows.filter((e) => {
      if (!e.nameKey) return true;
      return !matched.some(
        (m) => m.nameKey === e.nameKey && m.enerfloCustomerId === e.customerId,
      );
    });

    return {
      summary: {
        terrosTotal: terrosRows.length,
        enerfloTotal: enerfloRows.length,
        matched: matched.length,
        unmatchedTerros: unmatchedTerros.length,
        unmatchedEnerflo: unmatchedEnerflo.length,
        ambiguousTerros: ambiguousTerros.length,
        wouldChangeSetter: matched.filter((m) => m.assignmentDiff.setter).length,
        wouldChangeLeadOwner: matched.filter((m) => m.assignmentDiff.leadOwner).length,
      },
      matched,
      unmatchedTerros,
      unmatchedEnerflo: unmatchedEnerflo.map((e) => ({ ...e, reason: "no-terros-name-match" })),
      ambiguousTerros,
    };
  }

  function writeCompareReport(result) {
    const jsonPath = path.join(exportsDir, `compare-by-name-${ts}.json`);
    const csvPath = path.join(exportsDir, `compare-by-name-${ts}.csv`);

    fs.writeFileSync(
      jsonPath,
      JSON.stringify({ exported_at: new Date().toISOString(), ...result }, null, 2),
      "utf8",
    );

    const headers = [
      "nameKey",
      "customerName",
      "terrosAccountId",
      "terrosExternalLeadId",
      "terrosOwnerEmail",
      "terrosCloserEmail",
      "enerfloCustomerId",
      "enerfloCustomerUuid",
      "enerfloLeadOwnerEmail",
      "enerfloSetterEmail",
      "matchCandidateCount",
      "wouldChangeSetter",
      "wouldChangeLeadOwner",
    ];
    const csvRows = result.matched.map((m) => ({
      nameKey: m.nameKey,
      customerName: m.customerName,
      terrosAccountId: m.terrosAccountId,
      terrosExternalLeadId: m.terrosExternalLeadId,
      terrosOwnerEmail: m.terrosOwnerEmail,
      terrosCloserEmail: m.terrosCloserEmail,
      enerfloCustomerId: m.enerfloCustomerId,
      enerfloCustomerUuid: m.enerfloCustomerUuid,
      enerfloLeadOwnerEmail: m.enerfloLeadOwnerEmail,
      enerfloSetterEmail: m.enerfloSetterEmail,
      matchCandidateCount: m.matchCandidateCount,
      wouldChangeSetter: m.assignmentDiff.setter,
      wouldChangeLeadOwner: m.assignmentDiff.leadOwner,
    }));
    writeCsv(csvPath, headers, csvRows);

    console.log(`Compare report → ${jsonPath}`);
    console.log(`Compare CSV    → ${csvPath}`);
    return { jsonPath, csvPath };
  }

  function loadExportRows(filePath) {
    if (filePath.endsWith(".csv")) return readCsv(filePath);
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return parsed.rows ?? [];
  }

  function latestExport(prefix, ext) {
    return fs
      .readdirSync(exportsDir)
      .filter((f) => f.startsWith(prefix) && f.endsWith(ext))
      .sort()
      .pop();
  }

  // ── Run ─────────────────────────────────────────────────────────────────────
  let terrosRows;
  let enerfloRows;
  let terrosPaths = {};
  let enerfloPaths = {};

  console.log(`Linked-only Terros export: ${args.linkedOnly}`);

  if (!args.compareOnly) {
    const userIdToEmail = await loadTerrosUsers();
    console.log(`Loaded ${userIdToEmail.size} Terros users`);
    const terros = await exportTerros(userIdToEmail, args.linkedOnly);
    terrosRows = terros.rows;
    terrosPaths = { json: terros.jsonPath, csv: terros.csvPath };

    const enerflo = await exportEnerflo();
    enerfloRows = enerflo.rows;
    enerfloPaths = { json: enerflo.jsonPath, csv: enerflo.csvPath };
  } else {
    const terrosFile =
      args.terrosPath ||
      latestExport("terros-accounts-", ".csv") ||
      latestExport("terros-accounts-", ".json");
    const enerfloFile =
      args.enerfloPath ||
      latestExport("enerflo-leads-", ".csv") ||
      latestExport("enerflo-leads-", ".json");
    if (!terrosFile || !enerfloFile) {
      throw new Error("--compare-only requires --terros and --enerflo paths, or existing exports in exports/");
    }
    const terrosFull = path.isAbsolute(terrosFile) ? terrosFile : path.join(exportsDir, terrosFile);
    const enerfloFull = path.isAbsolute(enerfloFile) ? enerfloFile : path.join(exportsDir, enerfloFile);
    terrosRows = loadExportRows(terrosFull);
    enerfloRows = loadExportRows(enerfloFull);
    terrosPaths = { file: terrosFull };
    enerfloPaths = { file: enerfloFull };
    console.log(`Loaded Terros: ${terrosRows.length}, Enerflo: ${enerfloRows.length}`);
  }

  if (args.exportOnly) {
    console.log(JSON.stringify({ terros: terrosPaths, enerflo: enerfloPaths }, null, 2));
    return;
  }

  console.log("Comparing by normalized customer name…");
  const compareResult = compareByName(terrosRows, enerfloRows);
  const comparePaths = writeCompareReport(compareResult);

  console.log(JSON.stringify({
    terros: terrosPaths,
    enerflo: enerfloPaths,
    compare: comparePaths,
    summary: compareResult.summary,
  }, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
