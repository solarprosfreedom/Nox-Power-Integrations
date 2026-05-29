# Sequifi — endpoints reference

Product: [Sequifi](https://www.sequifi.com/) · Marketplace API: `https://marketplace-api.sequifi.com`

**Auth:** OAuth bearer token (`SEQUIFI_ACCESS_TOKEN`) from Sequifi marketplace login.

---

## Users (hired / active — onboarding trigger source)

```text
-- List hired users with optional filters (used by integration-middleware cron + gap scan)
GET {SEQUIFI_API_BASE_URL}/v1/users?page=1&per_page=100&status=active

-- Get a single user by ID
GET {SEQUIFI_API_BASE_URL}/v1/users/{id}

-- Update employee personal & additional info
POST {SEQUIFI_API_BASE_URL}/v1/users

-- Toggle dismiss/enable an active employee
POST {SEQUIFI_API_BASE_URL}/v1/users/termination
```

Use-case: **after hire**, active users appear in `/v1/users?status=active` (`status_id = 1`). Our middleware polls this list daily (8:30 PM PHT cron) and provisions Microsoft + Enerflo + Terros for reps missing a member `@noxpwr.com` account, then appends each new Microsoft account to the Google Sheets **EMPWR** roster tab. Inactive users are excluded.

---

## Onboarding (pre-hire pipeline — not used as trigger)

```text
-- List onboarding employees with optional filters
GET {SEQUIFI_API_BASE_URL}/v1/onboarding

-- Create a new onboarding employee record
POST {SEQUIFI_API_BASE_URL}/v1/onboarding

-- Get a single onboarding employee by ID
GET {SEQUIFI_API_BASE_URL}/v1/onboarding/{id}

-- Promote an onboarding employee to an active/hired user
PUT {SEQUIFI_API_BASE_URL}/v1/onboarding/hire
```

Use-case: reps in progress before hire. After `PUT /v1/onboarding/hire`, they move to `/v1/users`. We do **not** poll onboarding for provisioning today.

---

## This repo’s behavior

| Component | Endpoint |
|---|---|
| Gap scan + cron | `GET /v1/users` |
| Sequifi client | [`src/lib/sequifi/client.ts`](../../src/lib/sequifi/client.ts) |
| Daily cron | `GET /api/cron/sequifi-onboarding` at `30 12 * * *` UTC (8:30 PM PHT) — provisions accounts + appends to Google Sheets **EMPWR** tab |

---

## Inbound webhooks (optional)

```text
POST https://{your-domain}/api/webhooks/sequifi
```

Use-case: receive events from Sequifi if outbound webhooks are enabled — verify with `SEQUIFI_WEBHOOK_SECRET`.
