-- Per-profile daily watch limit + wire watch RPCs to devices.daily_time_limit_minutes.
-- 0 = unlimited; 1–1440 = minutes per calendar day (Asia/Jerusalem).

ALTER TABLE public.devices
  ADD COLUMN IF NOT EXISTS daily_time_limit_minutes INT;

-- Seed from account-level parent_settings when present, else 60.
UPDATE public.devices d
SET daily_time_limit_minutes = COALESCE(
  (
    SELECT ps.daily_time_limit_minutes
    FROM public.parent_settings ps
    WHERE ps.user_id = d.user_id
    LIMIT 1
  ),
  60
)
WHERE d.daily_time_limit_minutes IS NULL;

ALTER TABLE public.devices
  ALTER COLUMN daily_time_limit_minutes SET DEFAULT 60;

ALTER TABLE public.devices
  ALTER COLUMN daily_time_limit_minutes SET NOT NULL;

ALTER TABLE public.devices
  DROP CONSTRAINT IF EXISTS devices_daily_time_limit_minutes_check;

ALTER TABLE public.devices
  ADD CONSTRAINT devices_daily_time_limit_minutes_check
  CHECK (
    daily_time_limit_minutes = 0
    OR daily_time_limit_minutes BETWEEN 1 AND 1440
  );

COMMENT ON COLUMN public.devices.daily_time_limit_minutes IS
  'Per-profile daily watch budget in minutes (0 = unlimited).';

CREATE OR REPLACE FUNCTION public._device_daily_time_limit_minutes(p_device_id UUID)
RETURNS INT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT d.daily_time_limit_minutes
      FROM public.devices d
      WHERE d.id = p_device_id
    ),
    60
  );
$$;

-- Watch report / state RPCs use per-device limit.
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
  daily_time_limit_minutes := public._device_daily_time_limit_minutes(v_device.id);
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
  daily_time_limit_minutes := public._device_daily_time_limit_minutes(p_device_id);
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
  daily_time_limit_minutes := public._device_daily_time_limit_minutes(v_device.id);
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
  daily_time_limit_minutes := public._device_daily_time_limit_minutes(p_device_id);
  RETURN NEXT;
END;
$$;

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
  daily_time_limit_minutes := public._device_daily_time_limit_minutes(v_device.id);
  RETURN NEXT;
END;
$$;

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
  daily_time_limit_minutes := public._device_daily_time_limit_minutes(p_device_id);
  RETURN NEXT;
END;
$$;

-- Extend device settings RPCs with daily_time_limit_minutes.
DROP FUNCTION IF EXISTS public.parent_update_device_settings(UUID, BOOLEAN, BOOLEAN, BOOLEAN, TEXT[]);
DROP FUNCTION IF EXISTS public.local_parent_update_device_settings(UUID, BOOLEAN, BOOLEAN, BOOLEAN, TEXT[]);
DROP FUNCTION IF EXISTS public.parent_update_device_settings(UUID, BOOLEAN, BOOLEAN, BOOLEAN, TEXT[], INT);
DROP FUNCTION IF EXISTS public.local_parent_update_device_settings(UUID, BOOLEAN, BOOLEAN, BOOLEAN, TEXT[], INT);

CREATE OR REPLACE FUNCTION public.parent_update_device_settings(
  p_device_id UUID,
  p_allow_shorts BOOLEAN DEFAULT NULL,
  p_block_youtube_app BOOLEAN DEFAULT NULL,
  p_browser_filter_enabled BOOLEAN DEFAULT NULL,
  p_browser_whitelist TEXT[] DEFAULT NULL,
  p_daily_time_limit_minutes INT DEFAULT NULL
)
RETURNS public.devices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.devices%ROWTYPE;
  v_limit INT;
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

  IF p_daily_time_limit_minutes IS NOT NULL THEN
    v_limit := p_daily_time_limit_minutes;
    IF v_limit <> 0 AND (v_limit < 1 OR v_limit > 1440) THEN
      RAISE EXCEPTION 'INVALID_DAILY_TIME_LIMIT';
    END IF;
  END IF;

  UPDATE public.devices d
  SET
    allow_shorts = CASE
      WHEN p_allow_shorts IS NULL THEN d.allow_shorts
      ELSE p_allow_shorts
    END,
    block_youtube_app = CASE
      WHEN p_block_youtube_app IS NULL THEN d.block_youtube_app
      ELSE p_block_youtube_app
    END,
    browser_filter_enabled = CASE
      WHEN p_browser_filter_enabled IS NULL THEN d.browser_filter_enabled
      ELSE p_browser_filter_enabled
    END,
    browser_whitelist = CASE
      WHEN p_browser_whitelist IS NULL THEN d.browser_whitelist
      ELSE p_browser_whitelist
    END,
    daily_time_limit_minutes = CASE
      WHEN p_daily_time_limit_minutes IS NULL THEN d.daily_time_limit_minutes
      ELSE p_daily_time_limit_minutes
    END
  WHERE d.id = p_device_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.local_parent_update_device_settings(
  p_access_token UUID,
  p_allow_shorts BOOLEAN DEFAULT NULL,
  p_block_youtube_app BOOLEAN DEFAULT NULL,
  p_browser_filter_enabled BOOLEAN DEFAULT NULL,
  p_browser_whitelist TEXT[] DEFAULT NULL,
  p_daily_time_limit_minutes INT DEFAULT NULL
)
RETURNS public.devices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_device_id UUID;
  v_row public.devices%ROWTYPE;
  v_limit INT;
BEGIN
  IF p_access_token IS NULL THEN
    RAISE EXCEPTION 'INVALID_LOCAL_PARENT_TOKEN';
  END IF;

  SELECT d.id INTO v_device_id
  FROM public.devices d
  WHERE d.child_access_token = p_access_token
  LIMIT 1;

  IF v_device_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_LOCAL_PARENT_TOKEN';
  END IF;

  IF p_daily_time_limit_minutes IS NOT NULL THEN
    v_limit := p_daily_time_limit_minutes;
    IF v_limit <> 0 AND (v_limit < 1 OR v_limit > 1440) THEN
      RAISE EXCEPTION 'INVALID_DAILY_TIME_LIMIT';
    END IF;
  END IF;

  UPDATE public.devices d
  SET
    allow_shorts = CASE
      WHEN p_allow_shorts IS NULL THEN d.allow_shorts
      ELSE p_allow_shorts
    END,
    block_youtube_app = CASE
      WHEN p_block_youtube_app IS NULL THEN d.block_youtube_app
      ELSE p_block_youtube_app
    END,
    browser_filter_enabled = CASE
      WHEN p_browser_filter_enabled IS NULL THEN d.browser_filter_enabled
      ELSE p_browser_filter_enabled
    END,
    browser_whitelist = CASE
      WHEN p_browser_whitelist IS NULL THEN d.browser_whitelist
      ELSE p_browser_whitelist
    END,
    daily_time_limit_minutes = CASE
      WHEN p_daily_time_limit_minutes IS NULL THEN d.daily_time_limit_minutes
      ELSE p_daily_time_limit_minutes
    END
  WHERE d.id = v_device_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.parent_update_device_settings(UUID, BOOLEAN, BOOLEAN, BOOLEAN, TEXT[], INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.parent_update_device_settings(UUID, BOOLEAN, BOOLEAN, BOOLEAN, TEXT[], INT) TO authenticated;

REVOKE ALL ON FUNCTION public.local_parent_update_device_settings(UUID, BOOLEAN, BOOLEAN, BOOLEAN, TEXT[], INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.local_parent_update_device_settings(UUID, BOOLEAN, BOOLEAN, BOOLEAN, TEXT[], INT) TO anon, authenticated;

DROP FUNCTION IF EXISTS public.child_get_device_state(UUID);

CREATE OR REPLACE FUNCTION public.child_get_device_state(p_access_token UUID)
RETURNS TABLE (
  device_id UUID,
  device_name TEXT,
  is_blocked BOOLEAN,
  is_online BOOLEAN,
  last_seen_at TIMESTAMPTZ,
  allow_shorts BOOLEAN,
  block_youtube_app BOOLEAN,
  browser_filter_enabled BOOLEAN,
  browser_whitelist TEXT[],
  daily_time_limit_minutes INT
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
    d.allow_shorts,
    d.block_youtube_app,
    d.browser_filter_enabled,
    d.browser_whitelist,
    d.daily_time_limit_minutes
  FROM public.devices d
  WHERE d.child_access_token = p_access_token
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.child_get_device_state(UUID) TO anon, authenticated;

DROP FUNCTION IF EXISTS public.local_parent_device_summary(UUID);

CREATE OR REPLACE FUNCTION public.local_parent_device_summary(p_access_token UUID)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  name TEXT,
  device_type TEXT,
  pairing_code TEXT,
  is_online BOOLEAN,
  is_blocked BOOLEAN,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  channel_count BIGINT,
  allow_shorts BOOLEAN,
  block_youtube_app BOOLEAN,
  browser_filter_enabled BOOLEAN,
  browser_whitelist TEXT[],
  daily_time_limit_minutes INT
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
    (SELECT COUNT(*) FROM public.device_whitelist w WHERE w.device_id = d.id),
    d.allow_shorts,
    d.block_youtube_app,
    d.browser_filter_enabled,
    d.browser_whitelist,
    d.daily_time_limit_minutes
  FROM public.devices d
  WHERE d.child_access_token = p_access_token
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.local_parent_device_summary(UUID) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
