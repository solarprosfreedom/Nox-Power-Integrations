#!/usr/bin/env node
/**
 * Build a CSV of Terros accountIds created within [START_TS, END_TS].
 * Paginates /account/list sorted by createdDate and advances with the response
 * sortTimestamp cursor, per Terros' List Accounts OpenAPI schema.
 *
 * Usage:
 *   START_TS=1782864000000 node scripts/build-recent-terros-accounts-csv.mjs
 *
 * Output: exports/terros-accounts-created-{ts}.csv
 */
import fs from "node:fs";
import path from "node:path";

const PAGE_SIZE = 1000;
const MIN_INTERVAL_MS = 80;
const MAX_RETRIES = 7;

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

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function main() {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const env = loadEnv(path.join(root, ".env.local"));
  const terrosBase = (env.TERROS_API_BASE_URL || "https://api.terros.com").replace(/\/$/, "");
  const terrosKey = env.TERROS_API_KEY || "";
  if (!terrosKey) throw new Error("Missing TERROS_API_KEY in .env.local");

  const startTs = Number(process.env.START_TS || 0);
  if (!startTs) throw new Error("Set START_TS (epoch ms)");
  const endTs = Number(process.env.END_TS || Date.now());

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

  async function postTerros(endpoint, body) {
    for (let attempt = 0; ; attempt++) {
      await slot();
      let res;
      try {
        res = await fetch(`${terrosBase}${endpoint}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `ApiKey ${terrosKey}` },
          body: JSON.stringify(body),
        });
      } catch (e) {
        if (attempt >= MAX_RETRIES) throw new Error(`${endpoint} network: ${e.message}`);
        await sleep(Math.min(15000, 500 * 2 ** attempt));
        continue;
      }
      if (res.status === 429 || res.status >= 500) {
        if (attempt >= MAX_RETRIES) throw new Error(`${endpoint} -> ${res.status}`);
        await sleep(Math.min(20000, 600 * 2 ** attempt));
        continue;
      }
      const text = await res.text();
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error(`${endpoint} bad json: ${text.slice(0, 200)}`);
      }
      if (parsed?.type === "error") throw new Error(`${endpoint} error: ${parsed.message}`);
      return parsed;
    }
  }

  const exportsDir = path.join(root, "exports");
  fs.mkdirSync(exportsDir, { recursive: true });
  const csvPath = path.join(exportsDir, `terros-accounts-created-${Date.now()}.csv`);
  fs.writeFileSync(
    csvPath,
    "terrosAccountId,externalLeadId,enerfloCustomerId,customerName,lastActionDate,updatedAt\n",
    "utf8",
  );

  console.log(`Window: ${new Date(startTs).toISOString()} .. ${new Date(endTs).toISOString()}`);
  console.log(`Writing → ${csvPath}`);

  let sortTimestamp;
  let priorCursor = "";
  let page = 0;
  let total = 0;
  let scanned = 0;
  while (true) {
    const body = {
      size: PAGE_SIZE,
      searchInput: {
        startTime: startTs,
        endTime: endTs,
        sortBy: "createdDate",
        sortOrder: "asc",
        ...(sortTimestamp !== undefined ? { sortTimestamp } : {}),
      },
    };
    const parsed = await postTerros("/account/list", body);
    const rows = parsed.accounts ?? parsed.data ?? [];
    if (!Array.isArray(rows) || rows.length === 0) break;
    page += 1;
    scanned += rows.length;

    const lines = [];
    for (const acc of rows) {
      const accountId = acc?.accountId || acc?.id;
      if (!accountId) continue;
      const resident = acc?.resident && typeof acc.resident === "object" ? acc.resident : {};
      const name = [resident.firstName, resident.lastName].filter(Boolean).join(" ") || acc?.name || "";
      const externalLeadId = acc?.externalLeadId || "";
      const lastActionDate = typeof acc?.lastActionDate === "number" ? acc.lastActionDate : "";
      const updatedAt = typeof acc?.updatedAt === "number" ? acc.updatedAt : "";
      lines.push(
        [
          accountId,
          externalLeadId,
          "",
          `"${String(name).replace(/"/g, '""')}"`,
          lastActionDate,
          updatedAt,
        ].join(","),
      );
      total += 1;
    }
    if (lines.length) fs.appendFileSync(csvPath, lines.join("\n") + "\n", "utf8");

    console.log(`  page ${page} | scanned ${scanned} | in-window ${total}`);

    if (rows.length < PAGE_SIZE) break;
    if (parsed.sortTimestamp == null) break;
    const nextCursor = JSON.stringify(parsed.sortTimestamp);
    if (!nextCursor || nextCursor === priorCursor) break;
    priorCursor = nextCursor;
    sortTimestamp = parsed.sortTimestamp;
  }

  console.log(`Done. ${total} account(s) in window → ${csvPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
