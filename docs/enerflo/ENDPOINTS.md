# Enerflo — endpoints reference

Official hub: [Enerflo API docs](https://docs.enerflo.io/) · REST v1: [Reference](https://docs.enerflo.io/reference/) · GraphQL v2: [GraphQL docs](https://docs.enerflo.io/docs/graphql-playground) · Webhooks: [Webhooks](https://docs.enerflo.io/docs/webhooks)

**Auth (REST v1):** send your API key as header `api-key` (recommended) or query param `api-key`. See [Authentication](https://docs.enerflo.io/docs/authentication).

**Base URL:** set `ENERFLO_V1_BASE_URL` in `.env.local` to match your tenant (often `https://api.enerflo.io` or the host Enerflo documents for v1). Replace `{BASE}` below with that value (no trailing slash).

> Paths below follow common REST **patterns** aligned with Enerflo’s v1 sidebar (Customers, Installs, Users, etc.). **Confirm each path and verb** in the live [REST reference](https://docs.enerflo.io/reference/) before shipping—Enerflo may version or rename routes.

---

## REST API (Enerflo v1) — illustrative patterns

```text
-- List / search customers (CRM records tied to solar deals)
GET {BASE}/customers

-- Get one customer by id
GET {BASE}/customers/{customerId}

-- Create or update customer from your middleware / imports
POST {BASE}/customers
PATCH {BASE}/customers/{customerId}
```

```text
-- List leads (top-of-funnel / pre-deal pipeline)
GET {BASE}/leads

-- Get / update a single lead (stage changes, assignment)
GET {BASE}/leads/{leadId}
PATCH {BASE}/leads/{leadId}
```

```text
-- Installs (post-sale installation tracking for reporting handoff to field tools)
GET {BASE}/installs
GET {BASE}/installs/{installId}
PATCH {BASE}/installs/{installId}
```

```text
-- Install reports (structured reporting data for ops / Terros-style dashboards)
GET {BASE}/install-reports
GET {BASE}/install-reports/{reportId}
```

```text
-- Loan / finance products tied to proposals
GET {BASE}/loan-products
```

```text
-- Users / reps in Enerflo (identity for onboarding elsewhere)
GET {BASE}/users
GET {BASE}/users/{userId}
```

```text
-- Appointments, tasks, deals & surveys, equipment, offices, utilities, etc.
-- Use-case: scheduling, site survey data, org structure, rate data — open the matching section in the REST reference and copy the exact operation URL.
GET {BASE}/appointments
GET {BASE}/tasks
GET {BASE}/deals
```

```text
-- Webhook subscription management (register callback URLs for real-time events)
GET {BASE}/webhooks
POST {BASE}/webhooks
```

---

## GraphQL (Enerflo v2) — pre-signing deals

**Auth:** Bearer token (separate from v1 `api-key`). Set `ENERFLO_V2_GRAPHQL_URL` + `ENERFLO_V2_BEARER_TOKEN`.

```text
-- Single GraphQL endpoint: queries/mutations for deal state, proposals, lending, etc. (pre-signing lifecycle)
POST {ENERFLO_V2_GRAPHQL_URL}
```

Use-case: anything **before contract signed** that lives on the v2 Deal object—see [Getting started](https://docs.enerflo.io/docs/welcome) for v1 vs v2 split.

---

## Webhooks (Enerflo → your app)

```text
-- Your middleware receives Enerflo server events (install updates, lead changes, etc.) — configure URL in Enerflo Webhook Management
POST https://{your-domain}/api/webhooks/enerflo
```

Use-case: push solar CRM changes into your queue → Terros reporting / Sequifi onboarding without polling.

---

## This repo’s route (not Enerflo’s API)

```text
-- Inbound webhook handler (stores payload, writes reporting_events, enqueues Terros + Sequifi jobs)
POST http://localhost:3000/api/webhooks/enerflo
```

Use-case: local or production URL you register inside Enerflo’s webhook settings.
