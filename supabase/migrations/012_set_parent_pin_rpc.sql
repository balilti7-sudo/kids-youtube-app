-- =============================================================================
-- Set parent PIN (store only pin_hash)
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

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
  SET pin_hash = extensions.crypt(clean_pin, gen_salt('bf'))
  WHERE user_id = auth.uid();

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'user_not_found');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_parent_pin(text) TO anon, authenticated;

