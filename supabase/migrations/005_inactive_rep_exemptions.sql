-- Auditable manager protections for scheduled inactive-rep deactivations.
-- All access is server-side through SUPABASE_SERVICE_ROLE_KEY.

CREATE TABLE IF NOT EXISTS inactive_rep_exemptions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_key text NOT NULL,
  display_name text NOT NULL DEFAULT '',
  scope        text NOT NULL CHECK (scope IN ('batch','persistent')),
  batch_id     uuid REFERENCES inactive_rep_batches(id) ON DELETE CASCADE,
  reason       text NOT NULL CHECK (char_length(trim(reason)) BETWEEN 3 AND 500),
  created_by   text NOT NULL,
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  revoked_at   timestamptz,
  revoked_by   text,
  CHECK (
    (scope = 'batch' AND batch_id IS NOT NULL) OR
    (scope = 'persistent' AND batch_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS inactive_rep_exemptions_active_batch_idx
  ON inactive_rep_exemptions (batch_id, identity_key)
  WHERE active AND scope = 'batch';

CREATE UNIQUE INDEX IF NOT EXISTS inactive_rep_exemptions_active_persistent_idx
  ON inactive_rep_exemptions (identity_key)
  WHERE active AND scope = 'persistent';

CREATE INDEX IF NOT EXISTS inactive_rep_exemptions_active_lookup_idx
  ON inactive_rep_exemptions (active, identity_key, batch_id);

ALTER TABLE inactive_rep_exemptions ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION protect_inactive_rep(
  p_batch_id uuid,
  p_identity_key text,
  p_scope text,
  p_reason text,
  p_created_by text
)
RETURNS TABLE (exemption_id uuid, skipped_actions integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch_status text;
  v_display_name text;
  v_exemption_id uuid;
  v_skipped integer := 0;
  v_now timestamptz := now();
BEGIN
  IF p_scope NOT IN ('batch', 'persistent') THEN
    RAISE EXCEPTION 'Protection scope must be batch or persistent';
  END IF;
  IF char_length(trim(coalesce(p_reason, ''))) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'Protection reason must be between 3 and 500 characters';
  END IF;
  IF char_length(trim(coalesce(p_identity_key, ''))) NOT BETWEEN 3 AND 320 THEN
    RAISE EXCEPTION 'Invalid representative identity';
  END IF;

  SELECT b.status
    INTO v_batch_status
    FROM inactive_rep_batches b
    WHERE b.id = p_batch_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inactive-rep batch was not found';
  END IF;
  IF v_batch_status IN ('processing', 'completed') THEN
    RAISE EXCEPTION 'This batch is already % and can no longer be changed', v_batch_status;
  END IF;

  SELECT coalesce(nullif(a.metadata->>'emailedName', ''), a.account_email)
    INTO v_display_name
    FROM inactive_rep_actions a
    WHERE a.batch_id = p_batch_id
      AND a.identity_key = lower(trim(p_identity_key))
    ORDER BY a.created_at
    LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Representative is not part of this emailed batch';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM inactive_rep_actions a
    WHERE a.batch_id = p_batch_id
      AND a.identity_key = lower(trim(p_identity_key))
      AND a.status IN ('pending', 'blocked', 'failed')
  ) THEN
    RAISE EXCEPTION 'Representative does not have any remaining scheduled account actions';
  END IF;

  IF p_scope = 'persistent' THEN
    SELECT e.id
      INTO v_exemption_id
      FROM inactive_rep_exemptions e
      WHERE e.identity_key = lower(trim(p_identity_key))
        AND e.scope = 'persistent'
        AND e.active
      FOR UPDATE;
    IF FOUND THEN
      UPDATE inactive_rep_exemptions
      SET display_name = v_display_name,
          reason = trim(p_reason),
          created_by = p_created_by,
          updated_at = v_now
      WHERE id = v_exemption_id;
    ELSE
      INSERT INTO inactive_rep_exemptions (
        identity_key, display_name, scope, batch_id, reason, created_by
      ) VALUES (
        lower(trim(p_identity_key)), v_display_name, 'persistent', NULL, trim(p_reason), p_created_by
      )
      RETURNING id INTO v_exemption_id;
    END IF;
  ELSE
    SELECT e.id
      INTO v_exemption_id
      FROM inactive_rep_exemptions e
      WHERE e.batch_id = p_batch_id
        AND e.identity_key = lower(trim(p_identity_key))
        AND e.scope = 'batch'
        AND e.active
      FOR UPDATE;
    IF FOUND THEN
      UPDATE inactive_rep_exemptions
      SET display_name = v_display_name,
          reason = trim(p_reason),
          created_by = p_created_by,
          updated_at = v_now
      WHERE id = v_exemption_id;
    ELSE
      INSERT INTO inactive_rep_exemptions (
        identity_key, display_name, scope, batch_id, reason, created_by
      ) VALUES (
        lower(trim(p_identity_key)), v_display_name, 'batch', p_batch_id, trim(p_reason), p_created_by
      )
      RETURNING id INTO v_exemption_id;
    END IF;
  END IF;

  UPDATE inactive_rep_actions a
  SET status = 'skipped',
      last_error = NULL,
      metadata = coalesce(a.metadata, '{}'::jsonb) || jsonb_build_object(
        'manuallyProtected', true,
        'protectionScope', p_scope,
        'protectionReason', trim(p_reason),
        'protectedBy', p_created_by,
        'protectedAt', v_now,
        'exemptionId', v_exemption_id
      ),
      processed_at = v_now,
      updated_at = v_now
  WHERE a.batch_id = p_batch_id
    AND a.identity_key = lower(trim(p_identity_key))
    AND a.status IN ('pending', 'blocked', 'failed');
  GET DIAGNOSTICS v_skipped = ROW_COUNT;

  RETURN QUERY SELECT v_exemption_id, v_skipped;
END;
$$;

CREATE OR REPLACE FUNCTION revoke_inactive_rep_exemption(
  p_exemption_id uuid,
  p_revoked_by text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_changed boolean := false;
BEGIN
  UPDATE inactive_rep_exemptions
  SET active = false,
      revoked_at = now(),
      revoked_by = p_revoked_by,
      updated_at = now()
  WHERE id = p_exemption_id
    AND scope = 'persistent'
    AND active
  RETURNING true INTO v_changed;
  RETURN coalesce(v_changed, false);
END;
$$;

REVOKE ALL ON FUNCTION protect_inactive_rep(uuid, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION revoke_inactive_rep_exemption(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION protect_inactive_rep(uuid, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION revoke_inactive_rep_exemption(uuid, text) TO service_role;
