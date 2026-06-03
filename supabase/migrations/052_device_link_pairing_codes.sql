-- Link an existing child device to a parent account via short-lived 6-digit codes.

CREATE TABLE IF NOT EXISTS public.pairing_codes (
  code TEXT PRIMARY KEY,
  device_id UUID NOT NULL REFERENCES public.devices (id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT pairing_codes_code_six_digits CHECK (code ~ '^\d{6}$')
);

CREATE INDEX IF NOT EXISTS idx_pairing_codes_device_id ON public.pairing_codes (device_id);
CREATE INDEX IF NOT EXISTS idx_pairing_codes_expires_at ON public.pairing_codes (expires_at);

ALTER TABLE public.pairing_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pairing_codes_deny_all ON public.pairing_codes;
CREATE POLICY pairing_codes_deny_all
  ON public.pairing_codes
  FOR ALL
  TO public
  USING (false)
  WITH CHECK (false);

CREATE OR REPLACE FUNCTION public._purge_expired_pairing_codes()
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.pairing_codes WHERE expires_at <= now();
$$;

CREATE OR REPLACE FUNCTION public._generate_six_digit_link_code()
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  v_code TEXT;
  v_attempt INT := 0;
BEGIN
  LOOP
    v_attempt := v_attempt + 1;
    IF v_attempt > 40 THEN
      RAISE EXCEPTION 'PAIRING_CODE_GENERATION_FAILED';
    END IF;
    v_code := lpad((floor(random() * 1000000))::INT::TEXT, 6, '0');
    IF NOT EXISTS (SELECT 1 FROM public.pairing_codes pc WHERE pc.code = v_code) THEN
      RETURN v_code;
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.child_generate_device_link_code(p_access_token UUID)
RETURNS TABLE (
  code TEXT,
  expires_at TIMESTAMPTZ,
  device_id UUID,
  device_name TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_device public.devices%ROWTYPE;
  v_code TEXT;
  v_expires TIMESTAMPTZ;
BEGIN
  PERFORM public._purge_expired_pairing_codes();

  IF p_access_token IS NULL THEN
    RAISE EXCEPTION 'ACCESS_TOKEN_REQUIRED';
  END IF;

  SELECT *
  INTO v_device
  FROM public.devices d
  WHERE d.child_access_token = p_access_token
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DEVICE_NOT_FOUND';
  END IF;

  DELETE FROM public.pairing_codes pc WHERE pc.device_id = v_device.id;

  v_code := public._generate_six_digit_link_code();
  v_expires := now() + interval '5 minutes';

  INSERT INTO public.pairing_codes (code, device_id, expires_at)
  VALUES (v_code, v_device.id, v_expires);

  code := v_code;
  expires_at := v_expires;
  device_id := v_device.id;
  device_name := v_device.name;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.parent_link_device_by_code(p_code TEXT)
RETURNS TABLE (
  device_id UUID,
  device_name TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID;
  v_trim TEXT;
  v_row public.pairing_codes%ROWTYPE;
  v_device public.devices%ROWTYPE;
  v_max_devices INT;
  v_owned_count INT;
BEGIN
  PERFORM public._purge_expired_pairing_codes();

  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  v_trim := btrim(COALESCE(p_code, ''));
  IF v_trim !~ '^\d{6}$' THEN
    RAISE EXCEPTION 'INVALID_PAIRING_CODE';
  END IF;

  SELECT *
  INTO v_row
  FROM public.pairing_codes pc
  WHERE pc.code = v_trim
    AND pc.expires_at > now()
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAIRING_CODE_INVALID_OR_EXPIRED';
  END IF;

  SELECT *
  INTO v_device
  FROM public.devices d
  WHERE d.id = v_row.device_id
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    DELETE FROM public.pairing_codes pc WHERE pc.code = v_trim;
    RAISE EXCEPTION 'DEVICE_NOT_FOUND';
  END IF;

  IF v_device.user_id IS DISTINCT FROM v_uid THEN
    SELECT COALESCE(s.max_devices, 3)
    INTO v_max_devices
    FROM public.subscriptions s
    WHERE s.user_id = v_uid;

    IF v_max_devices IS NULL THEN
      v_max_devices := 3;
    END IF;

    SELECT count(*)::INT
    INTO v_owned_count
    FROM public.devices d
    WHERE d.user_id = v_uid;

    IF v_owned_count >= v_max_devices THEN
      RAISE EXCEPTION 'DEVICE_LIMIT_REACHED';
    END IF;

    UPDATE public.devices d
    SET user_id = v_uid
    WHERE d.id = v_device.id;
  END IF;

  DELETE FROM public.pairing_codes pc WHERE pc.device_id = v_device.id;

  device_id := v_device.id;
  device_name := v_device.name;
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.child_generate_device_link_code(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.parent_link_device_by_code(TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
