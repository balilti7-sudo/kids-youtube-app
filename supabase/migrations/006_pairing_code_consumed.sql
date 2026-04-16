-- זיכרון קודי צימוד שכבר נוצלו — כדי להבדיל "קוד לא קיים" מ"המכשיר כבר חובר עם הקוד הזה"
CREATE TABLE IF NOT EXISTS public.pairing_code_consumed (
  code TEXT PRIMARY KEY,
  device_id UUID NOT NULL REFERENCES public.devices (id) ON DELETE CASCADE,
  consumed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pairing_code_consumed_device ON public.pairing_code_consumed (device_id);

ALTER TABLE public.pairing_code_consumed ENABLE ROW LEVEL SECURITY;

-- אין גישה ישירה מהלקוח; רק דרך פונקציות SECURITY DEFINER
CREATE POLICY pairing_code_consumed_deny_all
  ON public.pairing_code_consumed
  FOR ALL
  TO authenticated, anon
  USING (false)
  WITH CHECK (false);

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
BEGIN
  IF p_pairing_code IS NULL OR btrim(p_pairing_code) = '' THEN
    RETURN;
  END IF;

  v_trim := btrim(p_pairing_code);

  SELECT *
  INTO v_device
  FROM public.devices
  WHERE pairing_code = v_trim
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM public.pairing_code_consumed c WHERE c.code = v_trim) THEN
      RAISE EXCEPTION 'PAIRING_CODE_ALREADY_USED';
    END IF;
    RETURN;
  END IF;

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
