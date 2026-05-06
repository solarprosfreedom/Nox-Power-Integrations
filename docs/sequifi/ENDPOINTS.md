# Sequifi — endpoints reference

Product: [Sequifi](https://www.sequifi.com/)

**Important:** Sequifi does **not** publish an open REST catalog like Enerflo or Terros in this repo’s research. Endpoints below are **placeholders** for planning. Replace with URLs, headers, and payloads from **Sequifi solutions / API PDF / partner portal** once Management shares access.

Internal checklist (also see [docs/SEQUIFI_INTEGRATION.md](../docs/SEQUIFI_INTEGRATION.md) if present): transport (REST vs CSV vs Zapier), auth scheme, sandbox base URL, idempotency, webhook signing.

---

## Onboarding (hire / docs / workflows)

```text
-- Start or update an onboarding case for a new rep (placeholder — replace with Sequifi-documented route)
POST {SEQUIFI_API_BASE_URL}/v1/onboarding/cases
```

Use-case: when Enerflo signals “new user / hired”, your middleware opens or updates onboarding in Sequifi.

```text
-- Fetch onboarding status for a worker (placeholder)
GET {SEQUIFI_API_BASE_URL}/v1/onboarding/cases/{caseId}
```

Use-case: poll or reconcile before marking complete in your DB.

---

## Employees / contractors (1099 / W2 context)

```text
-- Create or sync employee profile (placeholder)
POST {SEQUIFI_API_BASE_URL}/v1/employees
PATCH {SEQUIFI_API_BASE_URL}/v1/employees/{employeeId}
```

Use-case: keep Sequifi HR records aligned with Enerflo “Users” or CRM owner fields.

---

## Payroll / commission (if exposed via API)

```text
-- Trigger or fetch a commission run (placeholder)
GET {SEQUIFI_API_BASE_URL}/v1/commission-runs
POST {SEQUIFI_API_BASE_URL}/v1/commission-runs
```

Use-case: after install milestones from Enerflo, confirm payout state in Sequifi (only if their API exposes it).

---

## Inbound webhooks (Sequifi → your app)

```text
-- Optional: Sequifi POSTs onboarding completion or payroll events (placeholder URL on your side)
POST https://{your-domain}/api/webhooks/sequifi
```

Use-case: receive “onboarding complete” or similar when Sequifi supports outbound webhooks—verify auth headers (`x-sequifi-token` / `x-sequifi-signature`) against `SEQUIFI_WEBHOOK_SECRET` in `.env.local`.

---

## This repo’s current behavior (until real URLs exist)

```text
-- No external HTTP: Sequifi adapter returns noop JSON until SEQUIFI_API_BASE_URL + SEQUIFI_API_KEY are set
(see src/lib/integrations/sequifi-client.ts)
```

Use-case: safe skeleton so outbox jobs succeed while you wait for vendor documentation.
