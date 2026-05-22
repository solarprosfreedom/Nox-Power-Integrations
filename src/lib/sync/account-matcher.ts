import {
  fetchTerrosAccountListPage,
  parseTerrosAccountRow,
  type TerrosLookupMaps,
  type TerrosSearchCache,
  type TerrosSummary,
} from "@/lib/sync/terros-accounts";

export function getEnerfloIntegrationRecordId(c: Record<string, unknown>): string | null {
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

/** Terros Account ID from Enerflo v3 integration_maps (Partner/Lead external_id). */
export function getTerrosAccountIdFromIntegrationMaps(c: Record<string, unknown>): string | null {
  const maps = c.integration_maps as Record<string, unknown>[] | undefined;
  if (!Array.isArray(maps)) return null;
  for (const map of maps) {
    const extId = map.external_id as string | undefined;
    if (extId?.startsWith("Account.")) return extId;
  }
  return null;
}

export function getEnerfloCustomerUuid(c: Record<string, unknown>): string | null {
  const top = (c.uuid ?? c.external_id) as string | undefined;
  if (top && /^[0-9a-f-]{36}$/i.test(top)) return top;
  return null;
}

/** Enerflo V2 UUID from integration_maps — may appear as Terros externalLeadId on a linked account. */
export function getEnerfloIntegrationExternalId(c: Record<string, unknown>): string | null {
  if (!Array.isArray(c.integration_maps)) return null;
  for (const map of c.integration_maps as Record<string, unknown>[]) {
    const extId = map.external_id as string | undefined;
    if (extId && /^[0-9a-f-]{36}$/i.test(extId)) return extId;
  }
  return null;
}

function matchFromMaps(
  c: Record<string, unknown>,
  uuid: string,
  integrationExternalId: string,
  numericId: string,
  email: string,
  phone: string,
  maps: TerrosLookupMaps,
): string | null {
  const linkedTerrosId =
    getTerrosAccountIdFromIntegrationMaps(c) ?? getEnerfloIntegrationRecordId(c);
  if (linkedTerrosId) {
    const acc = maps.terrosExternalLeadIdToAccount.get(linkedTerrosId)
      ?? maps.terrosAccounts.find(a => a.accountId === linkedTerrosId);
    if (acc?.accountId || linkedTerrosId.startsWith("Account.")) {
      return acc?.accountId ?? linkedTerrosId;
    }
  }

  // Prefer Enerflo numeric customer id on Terros externalLeadId (strongest link for install customers).
  if (numericId) {
    const byNumeric = maps.terrosExternalLeadIdToAccount.get(numericId);
    if (byNumeric) return byNumeric.accountId;
  }

  if (uuid) {
    const byUuid = maps.terrosExternalLeadIdToAccount.get(uuid);
    if (byUuid) return byUuid.accountId;
  }

  if (integrationExternalId && integrationExternalId !== uuid) {
    const byIntegration = maps.terrosExternalLeadIdToAccount.get(integrationExternalId);
    if (byIntegration) return byIntegration.accountId;
  }

  if (email) {
    const byEmail = maps.terrosEmailToAccount.get(email);
    if (byEmail) return byEmail.accountId;
  }

  const normPhone = phone.replace(/\D/g, "");
  if (normPhone.length >= 7) {
    const byPhone = maps.terrosPhoneToAccount.get(normPhone);
    if (byPhone) return byPhone.accountId;
  }

  return null;
}

export interface ResolveTerrosAccountInput {
  customer: Record<string, unknown>;
  uuid: string;
  numericId: string;
  integrationExternalId?: string;
  email: string;
  phone: string;
  name?: string;
  addressLine1?: string;
  city?: string;
  zip?: string;
  maps: TerrosLookupMaps;
  terrosBase?: string;
  terrosKey?: string;
  /** Reuse Terros search results across many customers in one preview run. */
  searchCache?: TerrosSearchCache;
}

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "").slice(-10);
}

/** Collapse punctuation/spacing so "O'Brien" and "Obrien" compare equal. */
function normalizeNameForMatch(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[''`]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeAddressToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function lastNameSearchVariants(name: string): string[] {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const last = parts[parts.length - 1];
  if (!last || last.length < 3) return [];
  const variants = new Set<string>([last]);
  // Enerflo often drops apostrophes (Obrien) while Terros keeps them (O'Brien).
  if (/^[A-Za-z]+$/.test(last)) {
    variants.add(`${last[0]}'${last.slice(1)}`);
  }
  return [...variants];
}

function scoreTerrosCandidate(
  parsed: TerrosSummary,
  input: {
    email: string;
    phone: string;
    name?: string;
    addressLine1?: string;
    city?: string;
    zip?: string;
    uuid: string;
    integrationExternalId: string;
    numericId: string;
  },
): number {
  let score = 0;
  // Enerflo numeric customer id stored on Terros externalLeadId — best signal when duplicates exist.
  if (input.numericId && parsed.externalLeadId === input.numericId) score += 1000;
  if (input.uuid && parsed.externalLeadId === input.uuid) score += 500;
  if (
    input.integrationExternalId &&
    parsed.externalLeadId === input.integrationExternalId
  ) score += 300;
  if (input.email && parsed.email === input.email) score += 100;
  const inPhone = normalizePhone(input.phone);
  const candPhone = normalizePhone(parsed.phone);
  if (inPhone.length >= 7 && candPhone === inPhone) score += 80;
  if (
    input.name &&
    normalizeNameForMatch(parsed.name) === normalizeNameForMatch(input.name)
  ) score += 70;

  const inLine1 = normalizeAddressToken(input.addressLine1 ?? "");
  const candLine1 = normalizeAddressToken(parsed.addressLine1);
  if (inLine1 && candLine1 && inLine1 === candLine1) score += 60;
  else if (inLine1 && candLine1 && (inLine1.includes(candLine1) || candLine1.includes(inLine1))) {
    score += 40;
  }

  const inCity = normalizeAddressToken(input.city ?? "");
  const candCity = normalizeAddressToken(parsed.city);
  if (inCity && candCity && inCity === candCity) score += 20;

  const inZip = (input.zip ?? "").replace(/\D/g, "").slice(0, 5);
  const candZip = parsed.zip.replace(/\D/g, "").slice(0, 5);
  if (inZip.length >= 5 && candZip === inZip) score += 30;

  return score;
}

function pickBestTerrosMatch(
  rows: Record<string, unknown>[],
  input: {
    email: string;
    phone: string;
    name?: string;
    addressLine1?: string;
    city?: string;
    zip?: string;
    uuid: string;
    integrationExternalId: string;
    numericId: string;
  },
): { accountId: string | null; score: number } {
  let bestId: string | null = null;
  let bestScore = 0;
  for (const row of rows) {
    const parsed = parseTerrosAccountRow(row);
    if (!parsed) continue;
    const score = scoreTerrosCandidate(parsed, input);
    if (score > bestScore) {
      bestScore = score;
      bestId = parsed.accountId;
    }
  }
  return { accountId: bestScore > 0 ? bestId : null, score: bestScore };
}

/** Stop searching once we have a match this strong — avoids dozens of API calls per row. */
const STRONG_MATCH_SCORE = 100;

function buildTerrosSearchQueries(input: ResolveTerrosAccountInput): string[] {
  const queries: string[] = [];
  const add = (q: string) => {
    const t = q.trim();
    if (t && !queries.includes(t)) queries.push(t);
  };

  if (input.numericId) add(input.numericId);
  if (input.integrationExternalId) add(input.integrationExternalId);
  if (input.uuid) add(input.uuid);
  if (input.email) {
    add(input.email);
    const local = input.email.split("@")[0] ?? "";
    if (local.length >= 4) add(local);
    const domain = input.email.split("@")[1] ?? "";
    if (local && domain) add(`${local.split("+")[0]}@${domain}`);
  }
  if (input.name) add(input.name);
  for (const lastName of lastNameSearchVariants(input.name ?? "")) add(lastName);
  if (input.addressLine1) add(input.addressLine1);
  if (input.addressLine1 && input.city) {
    add(`${input.addressLine1}, ${input.city}`);
  }
  const phone = normalizePhone(input.phone);
  if (phone.length >= 7) add(phone);

  return queries;
}

async function searchTerrosAccounts(
  base: string,
  key: string,
  query: string,
  cache?: TerrosSearchCache,
): Promise<Record<string, unknown>[]> {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return [];

  if (cache?.has(normalizedQuery)) {
    return cache.get(normalizedQuery)!;
  }

  const { raw } = await fetchTerrosAccountListPage(base, key, 10, { query: query.trim() });
  cache?.set(normalizedQuery, raw);
  return raw;
}

/**
 * Resolve an existing Terros account for an Enerflo install customer.
 * Uses in-memory maps first, then account/list search with multiple query strategies.
 */
export async function resolveTerrosAccountForInstalls(
  input: ResolveTerrosAccountInput,
): Promise<string | null> {
  const {
    customer,
    uuid,
    numericId,
    integrationExternalId = getEnerfloIntegrationExternalId(customer) ?? "",
    email,
    phone,
    name,
    maps,
    terrosBase,
    terrosKey,
    searchCache,
  } = input;

  const fromMaps = matchFromMaps(
    customer, uuid, integrationExternalId, numericId, email, phone, maps,
  );
  if (fromMaps) return fromMaps;

  if (!terrosBase || !terrosKey) return null;

  const matchInput = {
    email,
    phone,
    name,
    addressLine1: input.addressLine1,
    city: input.city,
    zip: input.zip,
    uuid,
    integrationExternalId,
    numericId,
  };
  const allRows: Record<string, unknown>[] = [];
  const seenRowIds = new Set<string>();

  for (const query of buildTerrosSearchQueries({ ...input, integrationExternalId })) {
    const rows = await searchTerrosAccounts(terrosBase, terrosKey, query, searchCache);
    for (const row of rows) {
      const id = String(row.accountId ?? row.id ?? "").trim();
      if (!id || seenRowIds.has(id)) continue;
      seenRowIds.add(id);
      allRows.push(row);
    }

    const { accountId, score } = pickBestTerrosMatch(allRows, matchInput);
    if (accountId && score >= STRONG_MATCH_SCORE) return accountId;
  }

  return pickBestTerrosMatch(allRows, matchInput).accountId;
}
