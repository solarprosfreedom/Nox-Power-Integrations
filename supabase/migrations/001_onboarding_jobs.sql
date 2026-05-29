-- Run once in Supabase SQL Editor (Dashboard → SQL → New query)
-- onboarding_jobs: tracks Sequifi hired users → Microsoft + Enerflo + Terros + welcome email

CREATE TABLE IF NOT EXISTS onboarding_jobs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  sequifi_user_id       text NOT NULL UNIQUE,
  sequifi_employee_id   text NOT NULL,
  email                 text NOT NULL,
  email_normalized      text NOT NULL,

  first_name            text,
  last_name             text,
  phone                 text,
  role_label            text,
  welcome_email_to      text,
  raw_sequifi_payload   jsonb NOT NULL DEFAULT '{}',

  status                text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','processing','partial','completed','failed','skipped')),

  microsoft_status        text NOT NULL DEFAULT 'pending'
                        CHECK (microsoft_status IN ('pending','success','failed','skipped')),
  enerflo_status          text NOT NULL DEFAULT 'pending'
                        CHECK (enerflo_status IN ('pending','success','failed','skipped')),
  terros_status           text NOT NULL DEFAULT 'pending'
                        CHECK (terros_status IN ('pending','success','failed','skipped')),
  welcome_email_status    text NOT NULL DEFAULT 'pending'
                        CHECK (welcome_email_status IN ('pending','success','failed','skipped')),

  microsoft_user_id       text,
  microsoft_upn           text,
  enerflo_user_id         text,
  terros_user_id          text,
  temp_password           text,

  last_error              text,
  step_errors             jsonb NOT NULL DEFAULT '{}',
  attempt_count           int NOT NULL DEFAULT 0,
  next_retry_at           timestamptz,
  max_attempts            int NOT NULL DEFAULT 5,

  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  completed_at            timestamptz
);

CREATE INDEX IF NOT EXISTS onboarding_jobs_status_retry_idx
  ON onboarding_jobs (status, next_retry_at)
  WHERE status IN ('pending','partial','failed');

CREATE UNIQUE INDEX IF NOT EXISTS onboarding_jobs_email_normalized_idx
  ON onboarding_jobs (email_normalized);

CREATE INDEX IF NOT EXISTS onboarding_jobs_sequifi_employee_id_idx
  ON onboarding_jobs (sequifi_employee_id);
