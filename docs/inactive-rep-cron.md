# Inactive rep Vercel cron

The production cron calls `GET /api/cron/inactive-rep-deactivation` every day at
15:00 UTC, which is 08:00 in `America/Phoenix` year-round.

## Rollout

1. Apply `supabase/migrations/004_inactive_rep_deactivation.sql` to the configured
   Supabase project.
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
- `AZURE_TENANT_ID`
- `AZURE_CLIENT_ID`
- `AZURE_CLIENT_SECRET`
- `WELCOME_EMAIL_FROM` (normally `admin@noxpwr.com`)

Optional controls:

- `INACTIVE_REP_EMAIL_TO` defaults to `noxpwr@gmail.com`
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
  be processed, and each person is fully revalidated after the 24-hour wait.
- Microsoft direct licenses are removed first. If any license remains, including a
  group-based license, the Microsoft account is not disabled.
- Enerflo users are set inactive. Terros users are archived, never hard-deleted.
- Supabase uniqueness constraints and action rows make retries idempotent.
