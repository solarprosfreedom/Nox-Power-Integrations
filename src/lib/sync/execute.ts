import { env } from "@/lib/env";
import type { E2TRow, T2ERow, InstallsRow } from "@/lib/sync/preview";
import { resolveTerrosAccountForInstalls } from "@/lib/sync/account-matcher";
import {
  buildInstallCounterFields,
  fetchEnerfloCustomerV3,
  fetchInstallProjectCustomFields,
  fetchSalesRepEmailFromInstall,
} from "@/lib/sync/project-fields";
import {
  buildTerrosLookupMaps,
  createTerrosSearchCache,
  fetchAllTerrosAccounts,
} from "@/lib/sync/terros-accounts";
import {
  fetchTerrosUsers,
  resolveTerrosUserIdFromList,
} from "@/lib/sync/terros-users";
import { postTerros } from "@/lib/sync/terros-api";

// ── Types ──────────────────────────────────────────────────────────────────

export interface ExecuteResultRow {
  id: string;
  status: "created" | "error";
  targetId?: string;
  error?: string;
  installCount?: number;
}

export interface ExecuteResult {
  created: number;
  errors: number;
  results: ExecuteResultRow[];
}

// ── Helpers ────────────────────────────────────────────────────────────────

function terrosSuccess(text: string): boolean {
  try {
    const j = JSON.parse(text) as Record<string, unknown>;
    if (j.type === "error") return false;
  } catch { /* non-JSON */ }
  return true;
}

function splitName(full: string): { firstName: string; lastName: string } {
  const t = (full ?? "").trim();
  if (!t) return { firstName: "Unknown", lastName: "Account" };
  const parts = t.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0]!, lastName: "." };
  return { firstName: parts[0]!, lastName: parts.slice(1).join(" ") };
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

// ── Deal-count helper ──────────────────────────────────────────────────────

interface DealCounts { netDeals: number; installs: number; }

async function fetchDealCounts(
  enerfloBase: string,
  enerfloKey: string,
  enerfloId: string,
): Promise<DealCounts> {
  const headers: Record<string, string> = { "api-key": enerfloKey, "Content-Type": "application/json" };
  const tryParse = (t: string) => { try { return JSON.parse(t) as Record<string, unknown>; } catch { return null; } };

  // Both Net Deals and Installs equal the number of submitted projects (installs).
  // A project submission creates an install record — that is the source of truth for both counters.
  let installs = 0;
  try {
    const res = await fetch(
      `${enerfloBase}/api/v3/installs?customer_uuid=${encodeURIComponent(enerfloId)}&per_page=100&page=1`,
      { method: "GET", headers },
    );
    if (res.ok) {
      const parsed = tryParse(await res.text());
      if (parsed) {
        const rows = extractList(parsed, ["installs", "data", "results", "items"]);
        installs = rows.length;
      }
    }
  } catch { /* fall through */ }

  return { netDeals: installs, installs };
}

// ── E2T ────────────────────────────────────────────────────────────────────

export async function executeE2T(rows: E2TRow[]): Promise<ExecuteResultRow[]> {
  const terrosBase    = (env.terrosApiBaseUrl ?? "https://api.terros.com").replace(/\/$/, "");
  const terrosKey     = env.terrosApiKey      ?? "";
  const enerfloBase   = (env.enerfloV1BaseUrl ?? "https://enerflo.io").replace(/\/$/, "");
  const enerfloKey    = env.enerfloV1ApiKey   ?? "";
  const workflowId    = env.terrosWorkflowId              ?? "";
  const knockStageId  = env.terrosWorkflowKnockStageId    ?? "";
  const closedStageId = env.terrosWorkflowClosedStageId   ?? "";
  const netDealsCfId  = env.terrosCfNetDeals              ?? "";
  const installsCfId  = env.terrosCfInstalls              ?? "";

  // Fetch Terros users once for bulk owner resolution
  let terrosUsers: Record<string, unknown>[] = [];
  try {
    const res = await fetch(`${terrosBase}/user/list`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `ApiKey ${terrosKey}` },
      body: JSON.stringify({}),
    });
    if (res.ok) {
      const text = await res.text();
      if (terrosSuccess(text)) {
        const parsed = JSON.parse(text) as Record<string, unknown>;
        terrosUsers = (parsed.users as Record<string, unknown>[] | undefined) ?? [];
      }
    }
  } catch { /* best-effort */ }

  const results: ExecuteResultRow[] = [];

  for (const row of rows) {
    try {
      // Resolve Terros owner — strip +alias from both sides to handle mismatches
      let terrosOwnerId: string | null = null;
      if (row.salesRepEmail) {
        const needle   = row.salesRepEmail.trim().toLowerCase();
        const stripped = needle.replace(/\+[^@]*(@)/, "$1");
        const candidates = [needle, stripped].filter((e, i, arr) => e && arr.indexOf(e) === i);
        const match = terrosUsers.find(u => {
          if (typeof u.email !== "string") return false;
          const uEmail    = u.email.trim().toLowerCase();
          const uStripped = uEmail.replace(/\+[^@]*(@)/, "$1");
          return candidates.includes(uEmail) || candidates.includes(uStripped);
        });
        terrosOwnerId = (match?.userId as string | undefined) ?? null;
      }

      // Fetch real deal counts from Enerflo to backfill Net Deals + Installs
      const { netDeals, installs } = await fetchDealCounts(enerfloBase, enerfloKey, row.enerfloId);

      const stageId =
        installs > 0 ? (closedStageId || knockStageId) :
        netDeals > 0 ? knockStageId :
        knockStageId; // default to Knock for new accounts

      const customFields: Record<string, unknown> = {
        ...(netDealsCfId && netDeals > 0 ? { [netDealsCfId]: netDeals } : {}),
        ...(installsCfId && installs > 0  ? { [installsCfId]: installs }  : {}),
      };

      const { firstName, lastName } = splitName(row.name);
      const accountFields: Record<string, unknown> = {
        name:           row.name || "Unknown",
        externalLeadId: row.enerfloId,
        externalId:     row.enerfloId,
        sourceStatus:   "New Lead",
        ...(terrosOwnerId ? { ownerId: terrosOwnerId, assignedUserId: terrosOwnerId } : {}),
        ...(workflowId ? { workflowId } : {}),
        ...(stageId    ? { workflowStageId: stageId } : {}),
        ...(Object.keys(customFields).length > 0 ? { customFields } : {}),
        location: {
          line1: row.addressLine1 || "Unknown",
          ...(row.addressFull ? { oneLine:     row.addressFull } : {}),
          ...(row.city        ? { locality:    row.city }        : {}),
          ...(row.stateCode   ? { countrySubd: row.stateCode }   : {}),
          ...(row.zip         ? { postal1:     row.zip }         : {}),
        },
        resident: {
          name:      row.name || "Unknown",
          firstName,
          lastName,
          ...(row.email ? { email: row.email } : {}),
          ...(row.phone ? { phone: row.phone } : {}),
        },
      };

      const res = await fetch(`${terrosBase}/account/add`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `ApiKey ${terrosKey}` },
        body: JSON.stringify({ account: accountFields }),
      });
      const text = await res.text();
      const ok = res.ok && terrosSuccess(text);

      if (ok) {
        let parsed: Record<string, unknown> | undefined;
        try { parsed = JSON.parse(text) as Record<string, unknown>; } catch { /* ignore */ }
        const acc = parsed?.account as Record<string, unknown> | undefined;
        results.push({ id: row.enerfloId, status: "created", targetId: String(acc?.accountId ?? ""), installCount: installs });
      } else {
        results.push({ id: row.enerfloId, status: "error", error: text.slice(0, 300) });
      }
    } catch (e) {
      results.push({ id: row.enerfloId, status: "error", error: e instanceof Error ? e.message : String(e) });
    }
  }

  return results;
}

// ── T2E ────────────────────────────────────────────────────────────────────

export async function executeT2E(rows: T2ERow[]): Promise<ExecuteResultRow[]> {
  const enerfloBase = (env.enerfloV1BaseUrl ?? "https://enerflo.io").replace(/\/$/, "");
  const enerfloKey  = env.enerfloV1ApiKey   ?? "";
  const terrosBase  = (env.terrosApiBaseUrl ?? "https://api.terros.com").replace(/\/$/, "");
  const terrosKey   = env.terrosApiKey      ?? "";

  // Fetch Enerflo users once for bulk owner resolution
  const allEnerfloUsers: Record<string, unknown>[] = [];
  try {
    for (let page = 1; page <= 3; page++) {
      const res = await fetch(`${enerfloBase}/api/v3/users?page=${page}&pageSize=100`, {
        method: "GET",
        headers: { "api-key": enerfloKey, "Content-Type": "application/json" },
      });
      if (!res.ok) break;
      const parsed = JSON.parse(await res.text()) as Record<string, unknown>;
      const batch = (["results", "items", "users", "data"] as const)
        .map(k => parsed[k])
        .find(v => Array.isArray(v)) as Record<string, unknown>[] | undefined;
      if (!batch || batch.length === 0) break;
      allEnerfloUsers.push(...batch);
      if (batch.length < 100) break;
    }
  } catch { /* best-effort */ }

  function findEnerfloOwnerEmail(rawEmail: string): string | undefined {
    const needle   = rawEmail.trim().toLowerCase();
    const stripped = needle.replace(/\+[^@]*(@)/, "$1");
    const candidates = [needle, stripped].filter((e, i, arr) => e && arr.indexOf(e) === i);
    const match = allEnerfloUsers.find(u => {
      if (typeof u.email !== "string") return false;
      const uEmail    = u.email.trim().toLowerCase();
      const uStripped = uEmail.replace(/\+[^@]*(@)/, "$1");
      return candidates.includes(uEmail) || candidates.includes(uStripped);
    });
    if (match?.email) return typeof match.email === "string" ? match.email.trim() : rawEmail;
    return undefined;
  }

  const results: ExecuteResultRow[] = [];

  for (const row of rows) {
    try {
      const assignToEmail = row.ownerEmail ? findEnerfloOwnerEmail(row.ownerEmail) : undefined;
      const { firstName, lastName } = splitName(row.name);

      const lead: Record<string, unknown> = {
        first_name: firstName,
        last_name:  lastName,
        address:    row.addressLine1 || "Unknown",
        city:       row.city         || "Unknown",
        state:      row.stateCode    || "XX",
        zip:        row.zip          || "00000",
        integration_record_id: row.terrosAccountId,
        office_match: "manual",
      };
      if (row.email)     lead.email          = row.email;
      if (row.phone)     lead.mobile         = row.phone;
      if (assignToEmail) lead.assign_to_email = assignToEmail;

      const res = await fetch(`${enerfloBase}/api/v1/partner/action/lead/add`, {
        method: "POST",
        headers: { "api-key": enerfloKey, "Content-Type": "application/json" },
        body: JSON.stringify({ lead }),
      });
      const text = await res.text();

      if (res.ok) {
        let parsed: Record<string, unknown> | undefined;
        try { parsed = JSON.parse(text) as Record<string, unknown>; } catch { /* ignore */ }
        const customerId   = parsed?.customer_id ?? parsed?.customerId;
        const newEnerfloId = customerId != null ? String(customerId) : "";

        // Back-link: store Enerflo customer ID on Terros account
        if (newEnerfloId && terrosKey) {
          try {
            await fetch(`${terrosBase}/account/update`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `ApiKey ${terrosKey}` },
              body: JSON.stringify({
                account: { accountId: row.terrosAccountId, id: row.terrosAccountId, externalLeadId: newEnerfloId },
              }),
            });
          } catch { /* best-effort */ }
        }

        results.push({ id: row.terrosAccountId, status: "created", targetId: newEnerfloId });
      } else {
        results.push({ id: row.terrosAccountId, status: "error", error: text.slice(0, 300) });
      }
    } catch (e) {
        results.push({ id: row.terrosAccountId, status: "error", error: e instanceof Error ? e.message : String(e) });
    }
  }

  return results;
}

// ── Installs Resync ────────────────────────────────────────────────────────

export async function executeInstallsResync(rows: InstallsRow[]): Promise<ExecuteResultRow[]> {
  const terrosBase    = (env.terrosApiBaseUrl ?? "https://api.terros.com").replace(/\/$/, "");
  const terrosKey     = env.terrosApiKey      ?? "";
  const enerfloBase   = (env.enerfloV1BaseUrl ?? "https://enerflo.io").replace(/\/$/, "");
  const enerfloKey    = env.enerfloV1ApiKey   ?? "";
  const workflowId    = env.terrosWorkflowId              ?? "";
  const knockStageId  = env.terrosWorkflowKnockStageId    ?? "";
  const closedStageId = env.terrosWorkflowClosedStageId   ?? "";

  const needsAccountResolve = rows.some((r) => !r.terrosAccountId);
  const terrosAccounts = needsAccountResolve
    ? await fetchAllTerrosAccounts(terrosBase, terrosKey)
    : [];
  const terrosMaps = buildTerrosLookupMaps(terrosAccounts);
  const terrosUsers = await fetchTerrosUsers(terrosBase, terrosKey);

  function resolveTerrosOwner(email: string): string | null {
    return resolveTerrosUserIdFromList(email, terrosUsers);
  }

  async function mergeExistingCustomFields(
    accountId: string,
    customFields: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    let mergedCfs = { ...customFields };
    try {
      const { ok, text } = await postTerros(terrosBase, terrosKey, "/account/get", { accountId });
      if (ok) {
        const getParsed = JSON.parse(text) as Record<string, unknown>;
        const acc = (getParsed.account ?? getParsed) as Record<string, unknown>;
        const existingCfs = acc.customFields as Record<string, unknown> | undefined;
        if (existingCfs && typeof existingCfs === "object") {
          mergedCfs = { ...existingCfs, ...customFields };
        }
      }
    } catch { /* proceed with customFields only */ }
    return mergedCfs;
  }

  async function updateTerrosAccount(
    accountId: string,
    row: InstallsRow,
    customFields: Record<string, unknown>,
    ownerId: string | null,
    stageId: string,
  ): Promise<{ ok: boolean; text: string }> {
    const mergedCfs = await mergeExistingCustomFields(accountId, customFields);
    const phone = row.phone ? row.phone.replace(/\D/g, "").slice(-10) : "";
    const { firstName: fn, lastName: ln } = splitName(row.name);
    const updateBody: Record<string, unknown> = {
      accountId,
      id: accountId,
      ...(workflowId ? { workflowId } : {}),
      ...(stageId ? { workflowStageId: stageId } : {}),
      ...(ownerId ? { ownerId, assignedUserId: ownerId, closerId: ownerId } : {}),
      ...(Object.keys(mergedCfs).length > 0 ? { customFields: mergedCfs } : {}),
      resident: {
        name: row.name || `${fn} ${ln}`.trim(),
        firstName: fn,
        lastName: ln,
        ...(row.email ? { email: row.email } : {}),
        ...(phone ? { phone } : {}),
      },
    };

    const { ok, text } = await postTerros(terrosBase, terrosKey, "/account/update", { account: updateBody });
    return { ok, text };
  }

  const results: ExecuteResultRow[] = [];
  const stageId = closedStageId || knockStageId;
  const searchCache = createTerrosSearchCache();

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex]!;
    try {
      const customerIdForFetch = row.enerfloNumericId ?? row.enerfloId;
      const v3Customer = await fetchEnerfloCustomerV3(enerfloBase, enerfloKey, customerIdForFetch);

      const uuid = row.enerfloUuid ?? String(v3Customer?.uuid ?? "").trim();
      const numericId = row.enerfloNumericId ?? String(v3Customer?.id ?? "").trim();
      const customerRecord = v3Customer ?? {};

      let resolvedAccountId: string | null = row.terrosAccountId;
      if (!resolvedAccountId) {
        resolvedAccountId = await resolveTerrosAccountForInstalls({
          customer: customerRecord,
          uuid,
          numericId,
          email: row.email,
          phone: row.phone,
          name: row.name,
          addressLine1: row.addressLine1,
          city: row.city,
          zip: row.zip,
          maps: terrosMaps,
          terrosBase,
          terrosKey,
          searchCache,
        });
      }

      const projectCfs = row.installIds.length > 0
        ? await fetchInstallProjectCustomFields(
          enerfloBase,
          enerfloKey,
          row.installIds[0]!,
          customerIdForFetch,
        )
        : {};
      const customFields = { ...projectCfs, ...buildInstallCounterFields(row.installCount) };

      let salesRepEmail = row.salesRepEmail;
      if (!salesRepEmail && row.installIds[0]) {
        salesRepEmail = await fetchSalesRepEmailFromInstall(
          enerfloBase,
          enerfloKey,
          row.installIds[0]!,
        );
      }
      const terrosOwnerId = salesRepEmail ? resolveTerrosOwner(salesRepEmail) : null;

      if (resolvedAccountId) {
        const { ok, text } = await updateTerrosAccount(
          resolvedAccountId,
          row,
          customFields,
          terrosOwnerId,
          stageId,
        );

        if (ok) {
          results.push({
            id: row.enerfloId,
            status: "created",
            targetId: resolvedAccountId,
            installCount: row.installCount,
          });
        } else {
          results.push({ id: row.enerfloId, status: "error", error: text.slice(0, 300) });
        }
        continue;
      }

      // ── Create new Terros account ─────────────────────────────────────────
      const { firstName, lastName } = splitName(row.name);
      const externalLeadId = uuid || numericId || row.enerfloId;

      const accountFields: Record<string, unknown> = {
        name:           row.name || "Unknown",
        externalLeadId,
        externalId:     externalLeadId,
        sourceStatus:   "Project Submitted",
        ...(terrosOwnerId ? { ownerId: terrosOwnerId, assignedUserId: terrosOwnerId } : {}),
        ...(workflowId ? { workflowId } : {}),
        ...(stageId    ? { workflowStageId: stageId } : {}),
        ...(Object.keys(customFields).length > 0 ? { customFields } : {}),
        location: {
          line1: row.addressLine1 || "Unknown",
          ...(row.city      ? { locality:    row.city }      : {}),
          ...(row.stateCode ? { countrySubd: row.stateCode } : {}),
          ...(row.zip       ? { postal1:     row.zip }       : {}),
        },
        resident: {
          name: row.name || "Unknown",
          firstName,
          lastName,
          ...(row.email ? { email: row.email } : {}),
          ...(row.phone ? { phone: row.phone } : {}),
        },
      };

      const upsertRes = await postTerros(terrosBase, terrosKey, "/account/upsert", { account: accountFields });
      const upsertText = upsertRes.text;
      const upsertOk = upsertRes.ok;

      if (upsertOk) {
        let parsed: Record<string, unknown> | undefined;
        try { parsed = JSON.parse(upsertText) as Record<string, unknown>; } catch { /* ignore */ }
        const acc = parsed?.account as Record<string, unknown> | undefined;
        const newAccountId = String(acc?.accountId ?? "");

        if (newAccountId && stageId) {
          const { ok, text } = await updateTerrosAccount(
            newAccountId,
            row,
            customFields,
            terrosOwnerId,
            stageId,
          );
          if (!ok) {
            results.push({
              id: row.enerfloId,
              status: "error",
              targetId: newAccountId,
              error: `upsert OK but stage update failed: ${text.slice(0, 250)}`,
            });
            continue;
          }
        }

        const backLinkId = numericId || (row.enerfloId.includes("-") ? "" : row.enerfloId);
        if (newAccountId && enerfloKey && backLinkId) {
          try {
            await fetch(`${enerfloBase}/api/v3/customers/${backLinkId}`, {
              method: "PUT",
              headers: { "api-key": enerfloKey, "Content-Type": "application/json" },
              body: JSON.stringify({ integration_record_id: newAccountId }),
            });
          } catch { /* best-effort */ }
        }

        results.push({
          id: row.enerfloId,
          status: "created",
          targetId: newAccountId,
          installCount: row.installCount,
        });
      } else {
        results.push({ id: row.enerfloId, status: "error", error: upsertText.slice(0, 300) });
      }
    } catch (e) {
      results.push({ id: row.enerfloId, status: "error", error: e instanceof Error ? e.message : String(e) });
    }
  }

  return results;
}
