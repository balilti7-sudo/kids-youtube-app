-- Allow parent PIN unlock on the child device to clear today's inflated watch counter.
-- Used when unlocking the daily-limit overlay (snooze / continue watching).

CREATE OR REPLACE FUNCTION public.child_reset_daily_watch_today(p_access_token UUID)
RETURNS TABLE (
  device_id UUID,
  watch_date DATE,
  watch_seconds_today INT,
  daily_time_limit_minutes INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_device public.devices%ROWTYPE;
  v_date DATE := public._device_watch_date_today();
BEGIN
  IF p_access_token IS NULL THEN
    RAISE EXCEPTION 'INVALID_CHILD_TOKEN';
  END IF;

  SELECT * INTO v_device
  FROM public.devices d
  WHERE d.child_access_token = p_access_token
  LIMIT 1;

  IF v_device.id IS NULL THEN
    RAISE EXCEPTION 'INVALID_CHILD_TOKEN';
  END IF;

  INSERT INTO public.device_daily_watch (device_id, watch_date, watch_seconds, updated_at)
  VALUES (v_device.id, v_date, 0, now())
  ON CONFLICT (device_id, watch_date)
  DO UPDATE SET
    watch_seconds = 0,
    updated_at = now();

  device_id := v_device.id;
  watch_date := v_date;
  watch_seconds_today := 0;
  daily_time_limit_minutes := public._parent_daily_time_limit_minutes(v_device.user_id);
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.child_reset_daily_watch_today(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.child_reset_daily_watch_today(UUID) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.owner_reset_daily_watch_today(p_device_id UUID)
RETURNS TABLE (
  device_id UUID,
  watch_date DATE,
  watch_seconds_today INT,
  daily_time_limit_minutes INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_date DATE := public._device_watch_date_today();
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  SELECT d.user_id INTO v_user_id
  FROM public.devices d
  WHERE d.id = p_device_id AND d.user_id = auth.uid()
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'DEVICE_NOT_FOUND';
  END IF;

  INSERT INTO public.device_daily_watch (device_id, watch_date, watch_seconds, updated_at)
  VALUES (p_device_id, v_date, 0, now())
  ON CONFLICT (device_id, watch_date)
  DO UPDATE SET
    watch_seconds = 0,
    updated_at = now();

  device_id := p_device_id;
  watch_date := v_date;
  watch_seconds_today := 0;
  daily_time_limit_minutes := public._parent_daily_time_limit_minutes(v_user_id);
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.owner_reset_daily_watch_today(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.owner_reset_daily_watch_today(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
