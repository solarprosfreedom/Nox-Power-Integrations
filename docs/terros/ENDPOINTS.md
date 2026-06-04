# Terros — endpoints reference

Official hub: [Terros API docs](https://docs.terros.com/docs/info/overview) · Error handling: [Errors](https://docs.terros.com/docs/info/errors)

**Auth:** API key from Terros **Settings → API Keys** (header style is typically `Authorization: Bearer …`—confirm in your tenant’s doc).

**Base URL:** set `TERROS_API_BASE_URL` in `.env.local` (default in this app: `https://api.terros.com`). Replace `{BASE}` below with that value (no trailing slash).

> Terros documents many operations as **OpenAPI paths** under `docs.terros.com` (e.g. `/evaluation/update`). **Copy exact paths from the doc pages** linked to your subscription—paths below are **illustrative** for planning.

---

## Reporting / evaluations / stats (for competitions and dashboards)

```text
-- Update an evaluation record (example from Terros OpenAPI docs)
POST {BASE}/evaluation/update
```

Use-case: push scoring or QA outcomes from external systems into Terros.

```text
-- Generate or fetch KPI / report bundles (check Terros “Reports” / KPI sections in docs for exact routes)
GET {BASE}/reports
POST {BASE}/reports/generate
```

Use-case: feed Enerflo-derived aggregates into Terros leaderboards / stats.

---

## Accounts / territories / field data

```text
-- List or fetch accounts (door-knock territories / homeowner accounts — confirm path in Terros API reference)
GET {BASE}/accounts
GET {BASE}/accounts/{accountId}
```

Use-case: align Enerflo customer/install identifiers with Terros accounts for reporting.

```text
-- Example style from your note — verify exact path in Terros docs before calling
GET {BASE}/account/get
```

Use-case: **placeholder**—replace with the real “get account” operation from Terros once your CSM shares the canonical path.

---

## Calendar / events / users

```text
-- Calendar events (rep schedules, closer appointments)
GET {BASE}/calendar/events
POST {BASE}/calendar/events
```

Use-case: sync milestones that affect stats or competitions.

```text
-- Users / reps (permissions, teams)
GET {BASE}/users
GET {BASE}/users/{userId}
```

Use-case: map Enerflo users to Terros users for attribution in reporting.

---

## Inbound webhooks (Terros → your app)

```text
-- Optional callback URL if Terros is configured to POST events to your middleware
POST https://{your-domain}/api/webhooks/terros
```

Use-case: react to Terros-side changes (e.g. disposition) and optionally write back to Enerflo.

---

## This repo’s outbound “reporting ingest” (your wrapper)

```text
-- Worker pushes Enerflo snapshot to Terros — path configurable via TERROS_REPORTING_PATH
POST {BASE}{TERROS_REPORTING_PATH}
```

Use-case: **your** integration posts `{ purpose: "stats_and_competition", payload: … }` from `src/lib/integrations/terros-client.ts`—align `TERROS_REPORTING_PATH` with whatever Terros assigns for your integration.

---

## Terros proxy (external teams — separate endpoints)

Installers call **your** middleware with a per-installer Bearer secret. The server holds `TERROS_API_KEY`. Accounts and calendar are **different routes** — do not mix them.

### Proxy accounts

```text
GET https://{your-domain}/api/terros/proxy/accounts
Authorization: Bearer <installer_secret>
```

**Server env** (`TERROS_PROXY_ACCESS_JSON`) — JSON array, one object per installer:

```json
[
  {
    "installerId": "jonas",
    "secret": "<long-random-string>",
    "ownerEmail": "jonaslim@noxpwr.com"
  }
]
```

Also requires `TERROS_API_KEY` and `TERROS_API_BASE_URL` on the server (not shared with clients).

**Behavior:**

1. Validates `Authorization: Bearer` against a configured `secret`.
2. Resolves `ownerEmail` to a Terros `userId` via `/user/list`.
3. Calls Terros `POST /account/list` with `searchInput: { userId }` (rep’s Terros id), then keeps rows where `ownerId` **or** `closerId` matches.
4. Returns a safe subset (`TerrosSummary`: accountId, name, resident email/phone, address fields, ownerEmail, externalLeadId).

**Example:**

```bash
curl -sS \
  -H "Authorization: Bearer YOUR_INSTALLER_SECRET" \
  "https://your-app.vercel.app/api/terros/proxy/accounts"
```

**Response (200):**

```json
{
  "installerId": "jonas",
  "ownerEmail": "jonaslim@noxpwr.com",
  "ownerId": "U.xxxxx",
  "count": 42,
  "accounts": []
}
```

**Errors:** `401` invalid/missing secret · `404` owner not in Terros · `503` proxy or Terros not configured.

**Code:** [`src/app/api/terros/proxy/accounts/route.ts`](../../src/app/api/terros/proxy/accounts/route.ts) · [`src/lib/terros/proxy-config.ts`](../../src/lib/terros/proxy-config.ts) · [`src/lib/terros/proxy-accounts.ts`](../../src/lib/terros/proxy-accounts.ts)

**v1 limit:** Up to 1000 accounts per Terros list call (scoped by `searchInput.userId`); no query params to change owner (preset per installer secret).

### Proxy calendar (events only — not accounts)

```text
GET https://{your-domain}/api/terros/proxy/calendar
Authorization: Bearer <installer_secret>
```

Same `TERROS_PROXY_ACCESS_JSON` and installer secret as accounts, but a **separate URL** and response shape.

**Behavior:**

1. Same auth + resolve `ownerEmail` → Terros `userId`.
2. Loads scoped accounts internally (same filter as accounts proxy).
3. For each account, Terros `POST /calendar/event/list` with `{ accountId, size: 200 }`.
4. Keeps events where `ownerId` or `attendeeId` matches the rep.
5. Returns deduped `events[]` (not mixed into the accounts response).

**Example:**

```bash
curl -sS \
  -H "Authorization: Bearer YOUR_INSTALLER_SECRET" \
  "https://your-app.vercel.app/api/terros/proxy/calendar"
```

**Response (200):**

```json
{
  "installerId": "jonas",
  "ownerEmail": "jonaslim@noxpwr.com",
  "ownerId": "U.xxxxx",
  "accountCount": 40,
  "count": 5,
  "events": []
}
```

**Note:** Slower than accounts (~350ms Terros throttle per account). Route `maxDuration` is 60s. `/api/terros/proxy/appointments` is not used — use `/calendar` only.

**Code:** [`src/app/api/terros/proxy/calendar/route.ts`](../../src/app/api/terros/proxy/calendar/route.ts) · [`src/lib/terros/proxy-calendar.ts`](../../src/lib/terros/proxy-calendar.ts)
