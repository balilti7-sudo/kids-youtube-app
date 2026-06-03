-- Fix ambiguous parent_update_device_settings overloads (2-arg vs 4-arg).
-- PostgREST / RPC calls with only p_device_id + p_allow_shorts matched both signatures.

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'parent_update_device_settings'
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS public.parent_update_device_settings(%s)', r.args);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.parent_update_device_settings(
  p_device_id UUID,
  p_allow_shorts BOOLEAN DEFAULT NULL,
  p_break_interval_minutes INT DEFAULT NULL,
  p_educational_intercept_enabled BOOLEAN DEFAULT NULL
)
RETURNS public.devices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.devices%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.devices d
    WHERE d.id = p_device_id AND d.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'DEVICE_NOT_FOUND';
  END IF;

  UPDATE public.devices d
  SET
    allow_shorts = CASE
      WHEN p_allow_shorts IS NULL THEN d.allow_shorts
      ELSE p_allow_shorts
    END,
    break_interval_minutes = CASE
      WHEN p_break_interval_minutes IS NULL THEN d.break_interval_minutes
      ELSE public._normalize_break_interval_minutes(p_break_interval_minutes)
    END,
    educational_intercept_enabled = CASE
      WHEN p_educational_intercept_enabled IS NULL THEN d.educational_intercept_enabled
      ELSE p_educational_intercept_enabled
    END
  WHERE d.id = p_device_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.parent_update_device_settings(UUID, BOOLEAN, INT, BOOLEAN) TO authenticated;

NOTIFY pgrst, 'reload schema';
