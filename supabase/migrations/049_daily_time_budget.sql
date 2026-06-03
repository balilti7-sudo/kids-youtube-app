-- Phase 1: Daily watch budget — parent limit + per-device daily watch seconds.

ALTER TABLE public.parent_settings
  ADD COLUMN IF NOT EXISTS daily_time_limit_minutes INT;

UPDATE public.parent_settings ps
SET daily_time_limit_minutes = COALESCE(
  ps.daily_time_limit_minutes,
  ps.daily_screen_limit_minutes,
  60
)
WHERE ps.daily_time_limit_minutes IS NULL;

ALTER TABLE public.parent_settings
  ALTER COLUMN daily_time_limit_minutes SET DEFAULT 60;

ALTER TABLE public.parent_settings
  ALTER COLUMN daily_time_limit_minutes SET NOT NULL;

ALTER TABLE public.parent_settings
  DROP CONSTRAINT IF EXISTS parent_settings_daily_time_limit_minutes_check;

ALTER TABLE public.parent_settings
  ADD CONSTRAINT parent_settings_daily_time_limit_minutes_check
  CHECK (daily_time_limit_minutes BETWEEN 1 AND 1440);

COMMENT ON COLUMN public.parent_settings.daily_time_limit_minutes IS
  'Max viewing minutes per child device per calendar day (Asia/Jerusalem).';

CREATE TABLE IF NOT EXISTS public.device_daily_watch (
  device_id UUID NOT NULL REFERENCES public.devices (id) ON DELETE CASCADE,
  watch_date DATE NOT NULL,
  watch_seconds INT NOT NULL DEFAULT 0 CHECK (watch_seconds >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, watch_date)
);

CREATE INDEX IF NOT EXISTS idx_device_daily_watch_date
  ON public.device_daily_watch (watch_date DESC);

ALTER TABLE public.device_daily_watch ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS device_daily_watch_select_own ON public.device_daily_watch;
CREATE POLICY device_daily_watch_select_own
  ON public.device_daily_watch FOR SELECT TO authenticated
  USING (
    device_id IN (SELECT d.id FROM public.devices d WHERE d.user_id = auth.uid())
  );

CREATE OR REPLACE FUNCTION public._device_watch_date_today()
RETURNS DATE
LANGUAGE sql
STABLE
AS $$
  SELECT (timezone('Asia/Jerusalem', now()))::date;
$$;

CREATE OR REPLACE FUNCTION public._device_watch_seconds_today(p_device_id UUID)
RETURNS INT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT w.watch_seconds
      FROM public.device_daily_watch w
      WHERE w.device_id = p_device_id
        AND w.watch_date = public._device_watch_date_today()
    ),
    0
  );
$$;

CREATE OR REPLACE FUNCTION public._parent_daily_time_limit_minutes(p_user_id UUID)
RETURNS INT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT ps.daily_time_limit_minutes
      FROM public.parent_settings ps
      WHERE ps.user_id = p_user_id
    ),
    60
  );
$$;

CREATE OR REPLACE FUNCTION public._add_device_watch_seconds(p_device_id UUID, p_seconds INT)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_add INT;
  v_total INT;
BEGIN
  IF p_device_id IS NULL OR p_seconds IS NULL OR p_seconds <= 0 THEN
    RETURN public._device_watch_seconds_today(p_device_id);
  END IF;

  v_add := LEAST(p_seconds, 120);

  INSERT INTO public.device_daily_watch (device_id, watch_date, watch_seconds, updated_at)
  VALUES (p_device_id, public._device_watch_date_today(), v_add, now())
  ON CONFLICT (device_id, watch_date)
  DO UPDATE SET
    watch_seconds = public.device_daily_watch.watch_seconds + EXCLUDED.watch_seconds,
    updated_at = now()
  RETURNING watch_seconds INTO v_total;

  RETURN v_total;
END;
$$;

CREATE OR REPLACE FUNCTION public.child_report_watch_seconds(
  p_access_token UUID,
  p_seconds INT
)
RETURNS TABLE (
  watch_seconds_today INT,
  daily_time_limit_minutes INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_device public.devices%ROWTYPE;
  v_total INT;
BEGIN
  SELECT * INTO v_device
  FROM public.devices d
  WHERE d.child_access_token = p_access_token
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_total := public._add_device_watch_seconds(v_device.id, p_seconds);

  watch_seconds_today := v_total;
  daily_time_limit_minutes := public._parent_daily_time_limit_minutes(v_device.user_id);
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_report_watch_seconds(
  p_device_id UUID,
  p_seconds INT
)
RETURNS TABLE (
  watch_seconds_today INT,
  daily_time_limit_minutes INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_total INT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  SELECT d.user_id INTO v_user_id
  FROM public.devices d
  WHERE d.id = p_device_id AND d.user_id = auth.uid()
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DEVICE_NOT_FOUND';
  END IF;

  v_total := public._add_device_watch_seconds(p_device_id, p_seconds);

  watch_seconds_today := v_total;
  daily_time_limit_minutes := public._parent_daily_time_limit_minutes(v_user_id);
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.child_get_daily_watch_state(p_access_token UUID)
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
BEGIN
  SELECT * INTO v_device
  FROM public.devices d
  WHERE d.child_access_token = p_access_token
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  device_id := v_device.id;
  watch_date := public._device_watch_date_today();
  watch_seconds_today := public._device_watch_seconds_today(v_device.id);
  daily_time_limit_minutes := public._parent_daily_time_limit_minutes(v_device.user_id);
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_get_daily_watch_state(p_device_id UUID)
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
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  SELECT d.user_id INTO v_user_id
  FROM public.devices d
  WHERE d.id = p_device_id AND d.user_id = auth.uid()
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DEVICE_NOT_FOUND';
  END IF;

  device_id := p_device_id;
  watch_date := public._device_watch_date_today();
  watch_seconds_today := public._device_watch_seconds_today(p_device_id);
  daily_time_limit_minutes := public._parent_daily_time_limit_minutes(v_user_id);
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.child_report_watch_seconds(UUID, INT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.child_get_daily_watch_state(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.owner_report_watch_seconds(UUID, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_get_daily_watch_state(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
