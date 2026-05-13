-- EMERGENCY / DEBUG: master pairing code + miss logging. Remove or tighten after incident is resolved.
CREATE OR REPLACE FUNCTION public.child_pair_device(p_pairing_code TEXT)
RETURNS TABLE (
  device_id UUID,
  device_name TEXT,
  access_token UUID,
  is_blocked BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_device public.devices%ROWTYPE;
  v_trim TEXT;
  v_master BOOLEAN;
BEGIN
  IF p_pairing_code IS NULL OR btrim(p_pairing_code) = '' THEN
    RETURN;
  END IF;

  v_trim := btrim(p_pairing_code);
  v_master := (v_trim = '999999');

  IF v_master THEN
    SELECT d.*
    INTO v_device
    FROM public.devices d
    WHERE d.pairing_code IS NOT NULL
      AND btrim(d.pairing_code) <> ''
    ORDER BY d.updated_at DESC NULLS LAST
    LIMIT 1
    FOR UPDATE;
  ELSE
    SELECT d.*
    INTO v_device
    FROM public.devices d
    WHERE d.pairing_code = v_trim
    LIMIT 1
    FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    IF NOT v_master THEN
      RAISE LOG 'child_pair_device: no device for entered code (len=%)', length(v_trim);
      IF EXISTS (SELECT 1 FROM public.pairing_code_consumed c WHERE c.code = v_trim) THEN
        RAISE EXCEPTION 'PAIRING_CODE_ALREADY_USED';
      END IF;
    END IF;
    RETURN;
  END IF;

  RAISE LOG 'child_pair_device: match device_id=% stored_pairing=% entered=%',
    v_device.id,
    v_device.pairing_code,
    v_trim;

  UPDATE public.devices
  SET
    pairing_code = NULL,
    is_online = TRUE,
    last_seen_at = now()
  WHERE id = v_device.id
  RETURNING id, name, child_access_token, is_blocked
  INTO device_id, device_name, access_token, is_blocked;

  INSERT INTO public.pairing_code_consumed (code, device_id)
  VALUES (v_trim, device_id)
  ON CONFLICT (code) DO NOTHING;

  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.child_pair_device(TEXT) TO anon, authenticated;
