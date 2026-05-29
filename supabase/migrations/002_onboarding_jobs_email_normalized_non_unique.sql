-- Allow multiple Sequifi hires that share the same personal inbox
-- (e.g. carldeveloper01@gmail.com and carldeveloper01+test@gmail.com both normalize
-- to carldeveloper01@gmail.com). Jobs are keyed by sequifi_user_id (already unique).

DROP INDEX IF EXISTS onboarding_jobs_email_normalized_idx;

CREATE INDEX IF NOT EXISTS onboarding_jobs_email_normalized_idx
  ON onboarding_jobs (email_normalized);
