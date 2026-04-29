-- =============================================================================
-- TEMP FIX: remove pgcrypto dependency for parent PIN flow
-- - Avoids gen_salt/crypt requirements
-- - Stores PIN as plain text in parent_settings.pin_hash (temporary)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.set_parent_pin(p_pin text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  clean_pin text;
  v_updated int;
BEGIN
  clean_pin := COALESCE(trim(p_pin), '');

  IF length(clean_pin) < 4 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'pin_too_short');
  END IF;

  UPDATE public.parent_settings
  SET pin_hash = clean_pin
  WHERE user_id = auth.uid();

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'user_not_found');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_parent_pin(text) TO anon, authenticated;

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

  IF length(clean_pin) < 4 THEN
    RETURN false;
  END IF;

  SELECT ps.pin_hash INTO h
  FROM public.parent_settings ps
  WHERE ps.user_id = p_user_id
  LIMIT 1;

  IF NOT FOUND OR h IS NULL OR length(trim(h)) = 0 THEN
    RETURN clean_pin = '1234';
  END IF;

  -- Temporary plain-text compare (no pgcrypto dependency).
  RETURN clean_pin = trim(h);
END;
$$;
