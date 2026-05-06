# Sequifi integration channel (vendor discovery)

Sequifi does not publish a public API reference comparable to Enerflo or Terros. Before replacing the `NoopSequifiAdapter` or `CsvSequifiAdapter` with production logic, obtain the following from your Sequifi CSM or solutions engineering.

## Checklist

1. **Transport**: REST API, GraphQL, SFTP/CSV drops, native connector (e.g. CRM/job tool), Zapier/Make, or webhook callbacks from Sequifi.
2. **Authentication**: API key header, OAuth2 client credentials, mutual TLS, or signed URLs for file drops.
3. **Environments**: Sandbox base URL or test company; how to rotate credentials.
4. **Idempotency**: Required idempotency keys or natural keys for commission events and onboarding payloads.
5. **Inbound events** (if any): Webhook signing algorithm, retry policy, and sample payloads for hire, termination, payroll run, commission accrual.
6. **Outbound operations** (from this hub): Which objects you may create or update (employee, job, payout request) and rate limits.
7. **Data mapping**: Canonical fields this hub sends (see `src/domain/canonical.ts`) vs Sequifi-required fields.

## Placeholder adapters in this repo

- `NoopSequifiAdapter`: logs structured events; safe for production until Sequifi is wired.
- `CsvSequifiAdapter`: appends rows to a local CSV for manual upload or SFTP pickup; use only with a agreed file spec from Sequifi.

Record answers in your internal wiki and extend `src/adapters/sequifi/httpAdapter.ts` (create when spec is available).
