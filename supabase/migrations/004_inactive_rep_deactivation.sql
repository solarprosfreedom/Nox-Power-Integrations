-- Daily inactive-rep report batches and idempotent per-platform deactivation actions.
-- All access is server-side through SUPABASE_SERVICE_ROLE_KEY.

CREATE TABLE IF NOT EXISTS inactive_rep_batches (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_date           date NOT NULL UNIQUE,
  criteria_version      text NOT NULL,
  status                text NOT NULL DEFAULT 'preparing'
                        CHECK (status IN ('preparing','emailing','email_failed','emailed','processing','partial','completed')),
  cutoff_at             timestamptz NOT NULL,
  checked_at            timestamptz NOT NULL,
  email_subject         text NOT NULL UNIQUE,
  email_from            text,
  email_to              text NOT NULL,
  emailed_at            timestamptz,
  sent_message_id       text,
  candidates            jsonb NOT NULL DEFAULT '[]',
  report_csv            text NOT NULL DEFAULT '',
  source_summary        jsonb NOT NULL DEFAULT '{}',
  errors                jsonb NOT NULL DEFAULT '[]',
  processing_started_at timestamptz,
  completed_at          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inactive_rep_batches_due_idx
  ON inactive_rep_batches (status, emailed_at)
  WHERE status IN ('emailed','processing','partial');

CREATE TABLE IF NOT EXISTS inactive_rep_actions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id              uuid NOT NULL REFERENCES inactive_rep_batches(id) ON DELETE CASCADE,
  identity_key          text NOT NULL,
  platform              text NOT NULL CHECK (platform IN ('enerflo','microsoft','terros')),
  account_id            text NOT NULL,
  account_email         text NOT NULL,
  status                text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','success','skipped','blocked','failed')),
  attempts              int NOT NULL DEFAULT 0,
  last_error            text,
  metadata              jsonb NOT NULL DEFAULT '{}',
  processed_at          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (batch_id, platform, account_id)
);

CREATE INDEX IF NOT EXISTS inactive_rep_actions_pending_idx
  ON inactive_rep_actions (batch_id, status)
  WHERE status IN ('pending','blocked','failed');

ALTER TABLE inactive_rep_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE inactive_rep_actions ENABLE ROW LEVEL SECURITY;
