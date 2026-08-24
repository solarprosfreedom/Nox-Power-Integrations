# Inactive rep Vercel cron

The production deactivation cron calls `GET /api/cron/inactive-rep-deactivation`
at 14:00, 14:15, and 14:30 UTC (07:00, 07:15, and 07:30 in
`America/Phoenix`) Monday through Friday. It processes each emailed batch on the
first weekday run at least 23 hours after the confirmed send time. At 14:45 UTC
(07:45 Phoenix) on weekdays,
`GET /api/cron/inactive-rep-report-prepare` pulls the live sources and stores the
completed CSV. `GET /api/cron/inactive-rep-report` first attempts delivery at
15:00 UTC (08:00 Phoenix) on weekdays, with idempotent retries at 08:05, 08:10,
and 08:20.
If preparation failed, the sender generates the batch on demand before delivery.
The CSV contains one row per representative, with separate account ID, status,
creation, last-login, and inactivity-evidence columns for each platform.

No inactive-rep cron runs on Saturday or Sunday. A Friday report therefore
remains in review through the weekend and is first eligible for processing on
Monday morning, after another complete live revalidation.

A separate weekly job, `GET /api/cron/inactive-closer-report`, is not the
deactivation report. It emails the inactive-closers-with-tied-projects CSV
(one row per project) at 15:00 UTC on Mondays, with an idempotent retry at
15:10 UTC. That is 11:00 PM and 11:10 PM in `Asia/Manila`. Recipients are
`samjensen@noxpwr.com` and `noxpwr@gmail.com`.

The inactive-rep review portal is separate from the integration dashboard. Open
`/inactive-reps`, which redirects unauthenticated reviewers to
`/inactive-reps/login`. Access is restricted to `jorgesalazar@noxpwr.com`,
`jonaslim@noxpwr.com`, and `admin@noxpwr.com`; each sign-in requires a six-digit,
one-time code sent by Microsoft Graph to the selected mailbox. Codes expire
after 10 minutes, allow five attempts, and can only be requested once per
minute. The portal uses a dedicated session cookie, so the main dashboard login
does not grant access. It reads the durable Supabase batch and action records to
show confirmed report emails, recipients, review deadlines, scheduled
representatives, and manager protections. It refreshes automatically every
minute and can also be refreshed manually.

Production deployments are triggered from `main`; feature-branch deployments are
previews and do not register the production cron schedule.

## Rollout

1. Apply migrations `004_inactive_rep_deactivation.sql`,
   `005_inactive_rep_exemptions.sql`, and `006_inactive_rep_otp_auth.sql` to the
   configured Supabase project, in order.
2. Configure the required production environment variables in Vercel.
3. Deploy with `INACTIVE_REP_DEACTIVATION_ENABLED=false` and confirm the CSV email.
4. After the report and stored batch have been reviewed, set
   `INACTIVE_REP_DEACTIVATION_ENABLED=true` and redeploy.

When the switch is false, the cron still creates and emails reports but does not
process due account actions.

## Required environment

- `CRON_SECRET`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SEQUIFI_ACCESS_TOKEN`
- `ENERFLO_V1_API_KEY`
- `ENERFLO_GRAPHQL_API_KEY` — a separate Enerflo V2 key generated from
  Settings → Users → Integrations; the V1 key cannot read `lastLogin`
- `ENERFLO_ORG_SLUG`
- `TERROS_API_KEY`
- `PUBLIC_DEALS_API_KEY`
- `INACTIVE_REPS_AUTH_SECRET` — independent session-signing secret; generate
  with `openssl rand -hex 32` (minimum 32 characters)
- `AZURE_TENANT_ID`
- `AZURE_CLIENT_ID`
- `AZURE_CLIENT_SECRET`
- `WELCOME_EMAIL_FROM` (normally `admin@noxpwr.com`)

Optional controls:

- `INACTIVE_REP_EMAIL_TO` defaults to `noxpwr@gmail.com`
- `INACTIVE_REP_EMAIL_ADDITIONAL_RECIPIENTS` defaults to `admin@noxpwr.com`;
  separate multiple addresses with commas. Every scheduled report is sent to the
  primary and additional recipients in one message, and retries verify that all
  configured recipients are present in Sent Items.
- `INACTIVE_REP_DEACTIVATION_ENABLED` defaults to `false`
- `PUBLIC_DEALS_API_BASE` defaults to `https://hub.noxpwr.com/api/public/deals`
- `USER_EMAIL_ALIASES_JSON` supplies explicit cross-platform email aliases

The Microsoft app registration must be able to read users and sign-in activity,
send and verify mailbox messages, update users, and remove directly assigned
licenses.

## Safety behavior

- A recent login on any existing Enerflo, Microsoft, or Terros account protects
  the person.
- A blank login is inactive only when account age proves it is older than 30 days.
- Any attributable sale within the rolling 30-day window in Axia, Illum, Tron,
  EMPWR, GoodPWR, or OWE protects the person, regardless of status.
- Only verified Sales Rep, Setter, or Closer roles are eligible; admins, managers,
  operations, and service accounts are excluded.
- The emailed batch is immutable. Only stable account IDs listed in that batch can
  be processed, and each person is fully revalidated after the 23-hour wait.
- Microsoft direct licenses are removed first. If any license remains, including a
  group-based license, the Microsoft account is not disabled.
- Enerflo users are set inactive. Terros users are archived, never hard-deleted.
- Supabase uniqueness constraints and action rows make retries idempotent.
