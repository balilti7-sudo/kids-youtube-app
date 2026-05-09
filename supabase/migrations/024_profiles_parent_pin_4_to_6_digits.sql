-- profiles.parent_pin: document + validate 4–6 numeric digits (column added in 014).
-- Aligns child-device RPC helpers (013) with the same length rules.

COMMENT ON COLUMN public.profiles.parent_pin IS
  'Parental management PIN: 4–6 digits only when set; NULL = not configured.';

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_parent_pin_digits_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_parent_pin_digits_check
  CHECK (
    parent_pin IS NULL
    OR (
      length(trim(parent_pin)) BETWEEN 4 AND 6
      AND trim(parent_pin) ~ '^[0-9]+$'
    )
  );

-- 013: plain-text parent_settings.pin_hash — allow storing 4–6 digit PINs
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

  IF length(clean_pin) > 6 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'pin_too_long');
  END IF;

  IF clean_pin !~ '^[0-9]+$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'pin_not_numeric');
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

  IF length(clean_pin) < 4 OR length(clean_pin) > 6 THEN
    RETURN false;
  END IF;

  IF clean_pin !~ '^[0-9]+$' THEN
    RETURN false;
  END IF;

  SELECT ps.pin_hash INTO h
  FROM public.parent_settings ps
  WHERE ps.user_id = p_user_id
  LIMIT 1;

  IF NOT FOUND OR h IS NULL OR length(trim(h)) = 0 THEN
    RETURN clean_pin = '1234';
  END IF;

  RETURN clean_pin = trim(h);
END;
$$;
