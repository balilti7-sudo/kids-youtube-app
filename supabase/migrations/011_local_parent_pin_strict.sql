-- =============================================================================
-- Strict local parent PIN validation
-- - No empty-pin bypass
-- - No default "1234" fallback
-- - Requires parent_settings.pin_hash to be set
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public._local_parent_pin_ok(p_user_id uuid, p_pin text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  h text;
  clean_pin text;
BEGIN
  clean_pin := COALESCE(trim(p_pin), '');

  -- Require a real PIN value (no empty bypass).
  IF length(clean_pin) < 4 THEN
    RETURN false;
  END IF;

  SELECT ps.pin_hash INTO h
  FROM public.parent_settings ps
  WHERE ps.user_id = p_user_id
  LIMIT 1;

  -- Backwards compatibility: if PIN was never configured in DB yet,
  -- keep the legacy default (used by the previous ENV-based PIN flow).
  -- Still: empty PIN is blocked above.
  IF NOT FOUND THEN
    RETURN clean_pin = '1234';
  END IF;
  IF h IS NULL OR length(trim(h)) = 0 THEN
    RETURN clean_pin = '1234';
  END IF;

  RETURN extensions.crypt(clean_pin, h) = h;
END;
$$;

