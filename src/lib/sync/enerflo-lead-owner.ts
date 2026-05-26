/**
 * Resolve Enerflo lead owner (sales rep / agent) and setter for Terros sync.
 *
 * Owner priority (matches Enerflo "Lead Owner" UI):
 *   1. v1 owner.email (Lead Owner column)
 *   2. Nested agent / leadOwner emails on the v1 customer row
 *   3. Webhook leadOwner payload
 *   4. v3 agent_user_id → user email
 *   5. Setter email (only when no sales rep / agent found)
 */

export type EnerfloLeadOwnerResolution = {
  ownerEmail: string | null;
  setterEmail: string | null;
  ownerResolvedFrom: string;
  matchedNumericId: string | null;
  debug: Record<string, unknown>;
};

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.includes("@") ? trimmed : null;
}

function nestedUserEmail(obj: Record<string, unknown> | undefined): string | null {
  if (!obj || typeof obj !== "object") return null;
  const user = obj.user as Record<string, unknown> | undefined;
  return (
    normalizeEmail(user?.email) ??
    normalizeEmail(obj.email) ??
    normalizeEmail(obj.Email)
  );
}

/** Sales rep / agent emails from a v1 customer search row (not setter). */
export function extractSalesRepEmailsFromV1Row(
  row: Record<string, unknown>,
): Array<{ email: string; from: string }> {
  const out: Array<{ email: string; from: string }> = [];
  const seen = new Set<string>();

  function add(from: string, email: string | null) {
    if (!email) return;
    const key = email.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ email, from });
  }

  const ownerObj = (row.owner ?? row.agent ?? row.leadOwner) as Record<string, unknown> | undefined;
  const agentUser = row.agent_user as Record<string, unknown> | undefined;
  const leadOwnerObj = row.leadOwner as Record<string, unknown> | undefined;

  add("v1:owner.email", nestedUserEmail(ownerObj));
  add("v1:agent_user.email", nestedUserEmail(agentUser));
  add("v1:leadOwner.email", nestedUserEmail(leadOwnerObj));

  return out;
}

export function extractSetterEmailFromV1Row(row: Record<string, unknown>): string | null {
  const setterUser = row.setter_user as Record<string, unknown> | undefined;
  return nestedUserEmail(setterUser);
}

/** Direct GET /api/v3/users/{id}, then paginate user list as fallback. */
export async function fetchEnerfloUserEmailByNumericId(
  enerfloBase: string,
  enerfloKey: string,
  numericId: string | number,
): Promise<string | null> {
  if (!numericId || !enerfloKey) return null;
  const target = String(numericId);
  const headers = { "api-key": enerfloKey, "Content-Type": "application/json" };

  try {
    const singleUrl = `${enerfloBase}/api/v3/users/${encodeURIComponent(target)}`;
    const res = await fetch(singleUrl, { method: "GET", headers });
    if (res.ok) {
      const parsed = JSON.parse(await res.text()) as Record<string, unknown>;
      const u = (parsed.user ?? parsed.data ?? parsed) as Record<string, unknown>;
      const email = normalizeEmail(u.email ?? u.user_email ?? u.Email);
      if (email) return email;
    }
  } catch {
    /* fall through to list */
  }

  for (let page = 1; page <= 50; page++) {
    try {
      const r = await fetch(
        `${enerfloBase}/api/v3/users?page=${page}&pageSize=100`,
        { headers },
      );
      if (!r.ok) break;
      const parsed = JSON.parse(await r.text()) as Record<string, unknown>;
      const rows = (
        parsed.results ?? parsed.items ?? parsed.users ?? parsed.data
      ) as Record<string, unknown>[] | undefined;
      if (!Array.isArray(rows) || rows.length === 0) break;
      const match = rows.find(u => String(u.id ?? u.user_id) === target);
      if (match) {
        const email = normalizeEmail(match.email ?? match.user_email);
        if (email) return email;
      }
      if (rows.length < 100) break;
    } catch {
      break;
    }
  }
  return null;
}

export function pickEnerfloOwnerEmail(
  salesRepCandidates: Array<{ email: string; from: string }>,
  setterEmail: string | null,
): { ownerEmail: string | null; ownerResolvedFrom: string } {
  for (const c of salesRepCandidates) {
    if (c.email.includes("@")) {
      return { ownerEmail: c.email.trim(), ownerResolvedFrom: c.from };
    }
  }
  if (setterEmail?.includes("@")) {
    return {
      ownerEmail: setterEmail.trim(),
      ownerResolvedFrom: "v3:setter_user_id→fallback-owner",
    };
  }
  return { ownerEmail: null, ownerResolvedFrom: "" };
}

/** Find v1 customer row by resident email + optional V2 UUID. */
export async function findEnerfloV1CustomerRow(
  enerfloBase: string,
  enerfloKey: string,
  customerEmail: string,
  customerUuid?: string,
): Promise<{ row: Record<string, unknown> | null; numericId: string | null; debug: Record<string, unknown> }> {
  const debug: Record<string, unknown> = {};
  if (!customerEmail || !enerfloKey) {
    return { row: null, numericId: null, debug };
  }

  try {
    const searchUrl = `${enerfloBase}/api/v1/customers?search=${encodeURIComponent(customerEmail)}&pageSize=20`;
    const res = await fetch(searchUrl, {
      method: "GET",
      headers: { "api-key": enerfloKey, "Content-Type": "application/json" },
    });
    debug.searchStatus = res.status;
    if (!res.ok) return { row: null, numericId: null, debug };

    const raw = JSON.parse(await res.text()) as Record<string, unknown>;
    const rows = raw.data as Record<string, unknown>[] | undefined;
    debug.searchCount = raw.dataCount ?? 0;
    if (!Array.isArray(rows) || rows.length === 0) {
      return { row: null, numericId: null, debug };
    }

    let matchedRow = customerUuid
      ? rows.find(r => {
          const integId = (
            (r.integrations as Record<string, unknown> | undefined)?.["Enerflo V2"] as
              | Record<string, unknown>
              | undefined
          )?.EnerfloV2Customer as Record<string, unknown> | undefined;
          return integId?.integration_record_id === customerUuid;
        })
      : undefined;

    if (!matchedRow && rows.length > 0) {
      matchedRow = rows.reduce((best, r) => {
        const bId = typeof best?.id === "number" ? best.id : 0;
        const rId = typeof r.id === "number" ? r.id : 0;
        return rId > bId ? r : best;
      }, rows[0]);
      debug.matchedBy = "highest-numeric-id";
    } else if (matchedRow) {
      debug.matchedBy = "integration-uuid";
    }

    const numericId = matchedRow?.id != null ? String(matchedRow.id) : null;
    debug.matchedRowId = numericId;
    return { row: matchedRow ?? null, numericId, debug };
  } catch (e) {
    debug.searchError = e instanceof Error ? e.message : String(e);
    return { row: null, numericId: null, debug };
  }
}

export async function resolveEnerfloCustomerLeadOwner(options: {
  enerfloBase: string;
  enerfloKey: string;
  customerEmail?: string;
  customerUuid?: string;
  /** Pre-fetched v1 row (optional). */
  v1Row?: Record<string, unknown> | null;
  v1NumericId?: string | null;
  /** Pre-fetched v3 customer JSON (optional). */
  v3Customer?: Record<string, unknown> | null;
  payloadLeadOwnerEmail?: string | null;
}): Promise<EnerfloLeadOwnerResolution> {
  const {
    enerfloBase,
    enerfloKey,
    customerEmail = "",
    customerUuid,
    v3Customer: v3Provided,
    payloadLeadOwnerEmail,
  } = options;

  const debug: Record<string, unknown> = {};
  let v1Row = options.v1Row ?? null;
  let matchedNumericId = options.v1NumericId ?? null;

  if (!v1Row && customerEmail && enerfloKey) {
    const found = await findEnerfloV1CustomerRow(
      enerfloBase,
      enerfloKey,
      customerEmail,
      customerUuid,
    );
    v1Row = found.row;
    matchedNumericId = found.numericId;
    Object.assign(debug, found.debug);
  }

  const salesRepCandidates: Array<{ email: string; from: string }> = [];
  if (v1Row) {
    salesRepCandidates.push(...extractSalesRepEmailsFromV1Row(v1Row));
  }
  const payloadEmail = normalizeEmail(payloadLeadOwnerEmail);
  if (payloadEmail) {
    salesRepCandidates.push({ email: payloadEmail, from: "payload:leadOwner.email" });
  }

  let setterEmail: string | null = v1Row ? extractSetterEmailFromV1Row(v1Row) : null;

  let v3Data = v3Provided ?? null;
  if (!v3Data && matchedNumericId && enerfloKey) {
    try {
      const v3Res = await fetch(
        `${enerfloBase}/api/v3/customers/${encodeURIComponent(matchedNumericId)}`,
        { headers: { "api-key": enerfloKey, "Content-Type": "application/json" } },
      );
      debug.v3Status = v3Res.status;
      if (v3Res.ok) {
        v3Data = JSON.parse(await v3Res.text()) as Record<string, unknown>;
      }
    } catch (e) {
      debug.v3Error = e instanceof Error ? e.message : String(e);
    }
  }

  if (v3Data && enerfloKey) {
    const agentId = v3Data.agent_user_id != null ? String(v3Data.agent_user_id) : null;
    const setterId = v3Data.setter_user_id != null ? String(v3Data.setter_user_id) : null;
    debug.agentUserId = agentId;
    debug.setterUserId = setterId;

    if (agentId) {
      const agentEmail = await fetchEnerfloUserEmailByNumericId(enerfloBase, enerfloKey, agentId);
      debug.agentEmailResolved = agentEmail;
      if (agentEmail) {
        salesRepCandidates.push({
          email: agentEmail,
          from: "v3:agent_user_id→user",
        });
      }
    }

    if (setterId) {
      const resolvedSetter = await fetchEnerfloUserEmailByNumericId(
        enerfloBase,
        enerfloKey,
        setterId,
      );
      debug.setterEmailResolved = resolvedSetter;
      if (resolvedSetter) setterEmail = resolvedSetter;
    }
  }

  const { ownerEmail, ownerResolvedFrom } = pickEnerfloOwnerEmail(
    salesRepCandidates,
    setterEmail,
  );

  debug.salesRepCandidates = salesRepCandidates.map(c => ({ from: c.from, email: c.email }));

  return {
    ownerEmail,
    setterEmail,
    ownerResolvedFrom,
    matchedNumericId,
    debug,
  };
}
