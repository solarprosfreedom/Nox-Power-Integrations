#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

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
  const targetOwnerId = (process.env.TARGET_OWNER_ID || "U.a19_7hSDbg").trim();
  const targetOwnerEmail = normalizeEmail(process.env.TARGET_OWNER_EMAIL || "");
  const targetOwnerName = (process.env.TARGET_OWNER_NAME || "jonas").trim().toLowerCase();
  const targetOwnerSearchQuery = (process.env.TARGET_OWNER_SEARCH_QUERY || "Jonas Lim").trim();
  const auditPath = path.join(root, `terros-owner-fix-audit-${Date.now()}.jsonl`);
  const audit = fs.createWriteStream(auditPath, { flags: "a" });

  const userEmailToId = new Map();
  const enerfloUserEmailCache = new Map();

  async function postTerros(endpoint, body) {
    const res = await fetch(`${terrosBase}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `ApiKey ${terrosKey}`,
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, ok: res.ok && terrosOk(text), text };
  }

  async function fetchEnerfloCustomer(lookupId) {
    const res = await fetch(`${enerfloBase}/api/v3/customers/${encodeURIComponent(lookupId)}`, {
      headers: { "api-key": enerfloKey, "Content-Type": "application/json" },
    });
    if (!res.ok) return null;
    return JSON.parse(await res.text());
  }

  async function fetchEnerfloUserEmailById(userId) {
    const id = String(userId || "").trim();
    if (!id) return null;
    if (enerfloUserEmailCache.has(id)) return enerfloUserEmailCache.get(id);
    const res = await fetch(`${enerfloBase}/api/v3/users/${encodeURIComponent(id)}`, {
      headers: { "api-key": enerfloKey, "Content-Type": "application/json" },
    });
    if (!res.ok) {
      enerfloUserEmailCache.set(id, null);
      return null;
    }
    const parsed = JSON.parse(await res.text());
    const user = parsed.user ?? parsed.data ?? parsed;
    const email = normalizeEmail(user?.email ?? user?.user_email ?? "");
    const out = email || null;
    enerfloUserEmailCache.set(id, out);
    return out;
  }

  function writeAudit(obj) {
    audit.write(`${JSON.stringify({ ts: nowTs(), ...obj })}\n`);
  }

  // Load Terros users once for email->userId matching.
  const usersResp = await postTerros("/user/list", {});
  if (!usersResp.ok) {
    throw new Error(`Terros /user/list failed (${usersResp.status})`);
  }
  const usersParsed = JSON.parse(usersResp.text);
  const users = Array.isArray(usersParsed.users) ? usersParsed.users : [];
  for (const u of users) {
    const email = normalizeEmail(u?.email);
    const userId = pick(u, ["userId", "id"]);
    if (email && userId) userEmailToId.set(email, userId);
  }

  // Fetch Jonas-owned subset via account/list search (more reliable than the
  // default top-N list ordering).
  const accBody = targetOwnerSearchQuery
    ? { size: 1000, searchInput: { query: targetOwnerSearchQuery } }
    : { size: 1000 };
  const accResp = await postTerros("/account/list", accBody);
  if (!accResp.ok) {
    throw new Error(`Terros /account/list failed (${accResp.status})`);
  }
  const accParsed = JSON.parse(accResp.text);
  const accounts = Array.isArray(accParsed.accounts) ? accParsed.accounts : [];
  const fetchedTotal = Number(accParsed.total ?? accounts.length);

  const candidates = accounts.filter((acc) => {
    const owner = (acc?.owner && typeof acc.owner === "object") ? acc.owner : {};
    const ownerId = pick(acc, ["ownerId"]) || pick(owner, ["userId", "id"]);
    const ownerEmail = normalizeEmail(owner?.email);
    const ownerName = String(owner?.name || "").toLowerCase();
    if (targetOwnerId && ownerId === targetOwnerId) return true;
    if (targetOwnerEmail && ownerEmail === targetOwnerEmail) return true;
    if (targetOwnerName && (ownerName.includes(targetOwnerName) || ownerEmail.includes(targetOwnerName))) return true;
    return false;
  });

  const stats = {
    scanned: accounts.length,
    fetchedTotal,
    candidates: candidates.length,
    updated: 0,
    skippedNoExternalLeadId: 0,
    skippedNoEnerfloCustomer: 0,
    skippedNoOwnerResolved: 0,
    skippedNoTerrosUserMatch: 0,
    failedUpdate: 0,
  };

  for (const acc of candidates) {
    const accountId = pick(acc, ["accountId", "id"]);
    const externalLeadId = pick(acc, ["externalLeadId"]);
    const owner = (acc?.owner && typeof acc.owner === "object") ? acc.owner : {};
    const currentOwnerId = pick(acc, ["ownerId"]) || pick(owner, ["userId", "id"]);
    const currentOwnerEmail = normalizeEmail(owner?.email);
    const name = pick(acc, ["name"]);

    if (!externalLeadId) {
      stats.skippedNoExternalLeadId += 1;
      writeAudit({ action: "skip", reason: "no-externalLeadId", accountId, name, currentOwnerId, currentOwnerEmail });
      continue;
    }

    const customer = await fetchEnerfloCustomer(externalLeadId);
    if (!customer) {
      stats.skippedNoEnerfloCustomer += 1;
      writeAudit({ action: "skip", reason: "enerflo-customer-not-found", accountId, externalLeadId });
      continue;
    }

    const agentId = pick(customer, ["agent_user_id", "agentUserId"]);
    const setterId = pick(customer, ["setter_user_id", "setterUserId"]);
    const ownerEmail = agentId ? await fetchEnerfloUserEmailById(agentId) : null;
    const setterEmail = setterId ? await fetchEnerfloUserEmailById(setterId) : null;
    const targetOwnerEmailResolved = setterEmail || ownerEmail || null;
    const targetCloserEmail = ownerEmail && ownerEmail !== targetOwnerEmailResolved ? ownerEmail : null;

    if (!targetOwnerEmailResolved) {
      stats.skippedNoOwnerResolved += 1;
      writeAudit({
        action: "skip",
        reason: "no-owner-email-resolved",
        accountId,
        externalLeadId,
        agentId,
        setterId,
      });
      continue;
    }

    const targetOwnerTerrosId = userEmailToId.get(normalizeEmail(targetOwnerEmailResolved)) || null;
    const targetCloserTerrosId = targetCloserEmail
      ? (userEmailToId.get(normalizeEmail(targetCloserEmail)) || null)
      : null;

    if (!targetOwnerTerrosId) {
      stats.skippedNoTerrosUserMatch += 1;
      writeAudit({
        action: "skip",
        reason: "owner-email-not-in-terros-user-list",
        accountId,
        externalLeadId,
        targetOwnerEmailResolved,
      });
      continue;
    }

    const updatePayload = {
      account: {
        accountId,
        id: accountId,
        ownerId: targetOwnerTerrosId,
        ...(targetCloserTerrosId ? { closerId: targetCloserTerrosId } : {}),
      },
    };

    if (!isRun) {
      writeAudit({
        action: "dry-run",
        accountId,
        externalLeadId,
        currentOwnerId,
        currentOwnerEmail,
        targetOwnerEmailResolved,
        targetOwnerTerrosId,
        targetCloserEmail,
        targetCloserTerrosId,
      });
      continue;
    }

    const upd = await postTerros("/account/update", updatePayload);
    if (!upd.ok) {
      stats.failedUpdate += 1;
      writeAudit({
        action: "update-failed",
        accountId,
        externalLeadId,
        status: upd.status,
        response: upd.text.slice(0, 300),
      });
      continue;
    }

    stats.updated += 1;
    writeAudit({
      action: "updated",
      accountId,
      externalLeadId,
      targetOwnerEmailResolved,
      targetOwnerTerrosId,
      targetCloserEmail,
      targetCloserTerrosId,
    });
  }

  audit.end();
  console.log(JSON.stringify({ mode: isRun ? "run" : "dry", auditPath, ...stats }, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
