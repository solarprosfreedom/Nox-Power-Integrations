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
