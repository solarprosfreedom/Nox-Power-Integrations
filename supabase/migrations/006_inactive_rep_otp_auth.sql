-- Passwordless, one-time email authentication for the inactive-rep review portal.
-- All access is server-side through SUPABASE_SERVICE_ROLE_KEY.

CREATE TABLE IF NOT EXISTS inactive_rep_otp_challenges (
  id            uuid PRIMARY KEY,
  email         text NOT NULL,
  code_hash     text NOT NULL,
  attempt_count smallint NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 5),
  expires_at    timestamptz NOT NULL,
  consumed_at   timestamptz,
  requested_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inactive_rep_otp_challenges_email_recent_idx
  ON inactive_rep_otp_challenges (email, requested_at DESC);

CREATE INDEX IF NOT EXISTS inactive_rep_otp_challenges_expiry_idx
  ON inactive_rep_otp_challenges (expires_at)
  WHERE consumed_at IS NULL;

ALTER TABLE inactive_rep_otp_challenges ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION create_inactive_rep_otp_challenge(
  p_challenge_id uuid,
  p_email text,
  p_code_hash text,
  p_expires_at timestamptz
)
RETURNS TABLE (challenge_id uuid, created boolean, retry_after_seconds integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text := lower(trim(p_email));
  v_existing_id uuid;
  v_requested_at timestamptz;
  v_retry integer;
BEGIN
  IF char_length(v_email) NOT BETWEEN 3 AND 320 OR position('@' IN v_email) = 0 THEN
    RAISE EXCEPTION 'Invalid email';
  END IF;
  IF char_length(p_code_hash) <> 64 THEN
    RAISE EXCEPTION 'Invalid code hash';
  END IF;
  IF p_expires_at <= now() OR p_expires_at > now() + interval '11 minutes' THEN
    RAISE EXCEPTION 'Invalid challenge expiry';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_email, 0));

  SELECT c.id, c.requested_at
    INTO v_existing_id, v_requested_at
    FROM inactive_rep_otp_challenges c
    WHERE c.email = v_email
      AND c.consumed_at IS NULL
      AND c.expires_at > now()
    ORDER BY c.requested_at DESC
    LIMIT 1
    FOR UPDATE;

  IF FOUND AND v_requested_at > now() - interval '60 seconds' THEN
    v_retry := greatest(1, ceil(extract(epoch FROM (v_requested_at + interval '60 seconds' - now())))::integer);
    RETURN QUERY SELECT v_existing_id, false, v_retry;
    RETURN;
  END IF;

  UPDATE inactive_rep_otp_challenges
  SET consumed_at = now()
  WHERE email = v_email
    AND consumed_at IS NULL;

  INSERT INTO inactive_rep_otp_challenges (id, email, code_hash, expires_at)
  VALUES (p_challenge_id, v_email, p_code_hash, p_expires_at);

  DELETE FROM inactive_rep_otp_challenges
  WHERE expires_at < now() - interval '1 day';

  RETURN QUERY SELECT p_challenge_id, true, 0;
END;
$$;

CREATE OR REPLACE FUNCTION consume_inactive_rep_otp_challenge(
  p_challenge_id uuid,
  p_code_hash text
)
RETURNS TABLE (result text, verified_email text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_challenge inactive_rep_otp_challenges%ROWTYPE;
BEGIN
  SELECT *
    INTO v_challenge
    FROM inactive_rep_otp_challenges
    WHERE id = p_challenge_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::text;
    RETURN;
  END IF;
  IF v_challenge.consumed_at IS NOT NULL THEN
    RETURN QUERY SELECT 'used'::text, NULL::text;
    RETURN;
  END IF;
  IF v_challenge.expires_at <= now() THEN
    UPDATE inactive_rep_otp_challenges SET consumed_at = now() WHERE id = p_challenge_id;
    RETURN QUERY SELECT 'expired'::text, NULL::text;
    RETURN;
  END IF;
  IF v_challenge.attempt_count >= 5 THEN
    UPDATE inactive_rep_otp_challenges SET consumed_at = now() WHERE id = p_challenge_id;
    RETURN QUERY SELECT 'locked'::text, NULL::text;
    RETURN;
  END IF;

  UPDATE inactive_rep_otp_challenges
  SET attempt_count = attempt_count + 1
  WHERE id = p_challenge_id;

  IF v_challenge.code_hash <> p_code_hash THEN
    IF v_challenge.attempt_count + 1 >= 5 THEN
      UPDATE inactive_rep_otp_challenges SET consumed_at = now() WHERE id = p_challenge_id;
      RETURN QUERY SELECT 'locked'::text, NULL::text;
    ELSE
      RETURN QUERY SELECT 'invalid'::text, NULL::text;
    END IF;
    RETURN;
  END IF;

  UPDATE inactive_rep_otp_challenges
  SET consumed_at = now()
  WHERE id = p_challenge_id;
  RETURN QUERY SELECT 'verified'::text, v_challenge.email;
END;
$$;

REVOKE ALL ON FUNCTION create_inactive_rep_otp_challenge(uuid, text, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION consume_inactive_rep_otp_challenge(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_inactive_rep_otp_challenge(uuid, text, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION consume_inactive_rep_otp_challenge(uuid, text) TO service_role;
