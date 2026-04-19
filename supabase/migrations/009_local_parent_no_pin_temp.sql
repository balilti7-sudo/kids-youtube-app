-- =============================================================================
-- TEMP: allow local parent actions without PIN
-- Requested flow: QR pairing should grant local parent management with no PIN.
-- =============================================================================

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

  -- Temporary bypass by product request: no PIN required for local management.
  IF clean_pin = '' THEN
    RETURN true;
  END IF;

  SELECT ps.pin_hash INTO h
  FROM public.parent_settings ps
  WHERE ps.user_id = p_user_id
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF h IS NULL OR length(trim(h)) = 0 THEN
    RETURN clean_pin = '1234';
  END IF;
  RETURN extensions.crypt(clean_pin, h) = h;
END;
$$;
