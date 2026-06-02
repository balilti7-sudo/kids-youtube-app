-- Ensure break-interval helper exists and parent_update_device_settings uses it.
-- Safe to run even if 046 was skipped (fixes "function does not exist" after 047).

ALTER TABLE public.devices
  DROP CONSTRAINT IF EXISTS devices_break_interval_minutes_check;

ALTER TABLE public.devices
  ADD CONSTRAINT devices_break_interval_minutes_check
  CHECK (break_interval_minutes IN (5, 10, 15, 30, 45, 60));

CREATE OR REPLACE FUNCTION public._normalize_break_interval_minutes(raw INT)
RETURNS INT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN raw IN (5, 10, 15, 30, 45, 60) THEN raw
    ELSE 15
  END;
$$;

COMMENT ON FUNCTION public._normalize_break_interval_minutes(INT) IS
  'Clamp break interval to 5/10/15/30/45/60 minutes; invalid values become 15.';

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
