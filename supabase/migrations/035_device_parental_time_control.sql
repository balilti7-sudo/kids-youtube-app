-- Per-device parental time controls + daily watch tracking

ALTER TABLE public.devices
  ADD COLUMN IF NOT EXISTS time_limit_minutes INT
    CHECK (time_limit_minutes IS NULL OR (time_limit_minutes >= 0 AND time_limit_minutes <= 1440)),
  ADD COLUMN IF NOT EXISTS sleep_time_start TEXT
    CHECK (sleep_time_start IS NULL OR sleep_time_start ~ '^\d{2}:\d{2}$'),
  ADD COLUMN IF NOT EXISTS is_remote_paused BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS public.device_daily_watch (
  device_id UUID NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  watch_date DATE NOT NULL,
  watch_seconds INT NOT NULL DEFAULT 0 CHECK (watch_seconds >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, watch_date)
);

ALTER TABLE public.device_daily_watch ENABLE ROW LEVEL SECURITY;

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
  SELECT coalesce(
    (
      SELECT w.watch_seconds
      FROM public.device_daily_watch w
      WHERE w.device_id = p_device_id
        AND w.watch_date = public._device_watch_date_today()
    ),
    0
  );
$$;

CREATE OR REPLACE FUNCTION public.child_get_device_state(p_access_token UUID)
RETURNS TABLE (
  device_id UUID,
  device_name TEXT,
  is_blocked BOOLEAN,
  is_online BOOLEAN,
  last_seen_at TIMESTAMPTZ,
  time_limit_minutes INT,
  sleep_time_start TEXT,
  is_remote_paused BOOLEAN,
  watch_seconds_today INT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    d.id,
    d.name,
    d.is_blocked,
    d.is_online,
    d.last_seen_at,
    d.time_limit_minutes,
    d.sleep_time_start,
    d.is_remote_paused,
    public._device_watch_seconds_today(d.id)
  FROM public.devices d
  WHERE d.child_access_token = p_access_token
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.child_heartbeat(p_access_token UUID)
RETURNS TABLE (
  device_id UUID,
  is_blocked BOOLEAN,
  last_seen_at TIMESTAMPTZ,
  time_limit_minutes INT,
  sleep_time_start TEXT,
  is_remote_paused BOOLEAN,
  watch_seconds_today INT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.devices d
  SET is_online = TRUE, last_seen_at = now()
  WHERE d.child_access_token = p_access_token
  RETURNING
    d.id,
    d.is_blocked,
    d.last_seen_at,
    d.time_limit_minutes,
    d.sleep_time_start,
    d.is_remote_paused,
    public._device_watch_seconds_today(d.id);
$$;

CREATE OR REPLACE FUNCTION public.child_report_watch_seconds(
  p_access_token UUID,
  p_seconds INT
)
RETURNS TABLE (watch_seconds_today INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_device_id UUID;
  v_add INT;
  v_total INT;
BEGIN
  IF p_seconds IS NULL OR p_seconds <= 0 THEN
    RETURN;
  END IF;

  v_add := LEAST(p_seconds, 120);

  SELECT d.id INTO v_device_id
  FROM public.devices d
  WHERE d.child_access_token = p_access_token
  LIMIT 1;

  IF v_device_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.device_daily_watch (device_id, watch_date, watch_seconds, updated_at)
  VALUES (v_device_id, public._device_watch_date_today(), v_add, now())
  ON CONFLICT (device_id, watch_date)
  DO UPDATE SET
    watch_seconds = public.device_daily_watch.watch_seconds + EXCLUDED.watch_seconds,
    updated_at = now()
  RETURNING watch_seconds INTO v_total;

  RETURN QUERY SELECT v_total;
END;
$$;

CREATE OR REPLACE FUNCTION public.local_parent_device_summary(p_access_token uuid)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  name text,
  device_type text,
  pairing_code text,
  is_online boolean,
  is_blocked boolean,
  last_seen_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  channel_count bigint,
  time_limit_minutes int,
  sleep_time_start text,
  is_remote_paused boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    d.id,
    d.user_id,
    d.name,
    d.device_type,
    d.pairing_code,
    d.is_online,
    d.is_blocked,
    d.last_seen_at,
    d.created_at,
    d.updated_at,
    (SELECT count(*)::bigint FROM public.device_whitelist dw WHERE dw.device_id = d.id) AS channel_count,
    d.time_limit_minutes,
    d.sleep_time_start,
    d.is_remote_paused
  FROM public.devices d
  WHERE d.child_access_token = p_access_token
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.child_report_watch_seconds(UUID, INT) TO anon, authenticated;
