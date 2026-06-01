-- Educational breaks: time-based intervals (minutes) instead of video counts.

ALTER TABLE public.devices
  ADD COLUMN IF NOT EXISTS break_interval_minutes INT NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS intercept_watch_seconds INT NOT NULL DEFAULT 0;

ALTER TABLE public.devices
  DROP CONSTRAINT IF EXISTS devices_break_interval_minutes_check;

ALTER TABLE public.devices
  ADD CONSTRAINT devices_break_interval_minutes_check
  CHECK (break_interval_minutes IN (15, 30, 45));

ALTER TABLE public.devices
  DROP CONSTRAINT IF EXISTS devices_intercept_watch_seconds_check;

ALTER TABLE public.devices
  ADD CONSTRAINT devices_intercept_watch_seconds_check
  CHECK (intercept_watch_seconds >= 0);

-- Migrate legacy video-count frequency (2/3/5) → minutes (15/30/45).
UPDATE public.devices d
SET break_interval_minutes = CASE
  WHEN d.educational_intercept_frequency::text = '2' THEN 15
  WHEN d.educational_intercept_frequency::text = '5' THEN 45
  ELSE 30
END
WHERE d.break_interval_minutes IS DISTINCT FROM CASE
  WHEN d.educational_intercept_frequency::text = '2' THEN 15
  WHEN d.educational_intercept_frequency::text = '5' THEN 45
  ELSE 30
END;

CREATE OR REPLACE FUNCTION public._normalize_break_interval_minutes(raw INT)
RETURNS INT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN raw = 15 THEN 15
    WHEN raw = 45 THEN 45
    ELSE 30
  END;
$$;

CREATE OR REPLACE FUNCTION public._child_runtime_row(d public.devices, p_server_now TIMESTAMPTZ)
RETURNS TABLE (
  server_now TIMESTAMPTZ,
  device_id UUID,
  is_blocked BOOLEAN,
  screen_time_phase TEXT,
  screen_time_limit_minutes INT,
  remaining_seconds INT,
  playback_blocked BOOLEAN,
  challenge_task TEXT,
  intercept_active BOOLEAN,
  intercept_video_count INT,
  intercept_watch_seconds INT,
  intercept_pending_video JSONB,
  intercept_scene_progress JSONB,
  lion_level INT,
  lion_xp INT,
  lion_active_outfit TEXT,
  educational_intercept_enabled BOOLEAN,
  educational_intercept_frequency TEXT,
  break_interval_minutes INT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    p_server_now,
    d.id,
    d.is_blocked,
    d.screen_time_phase,
    d.screen_time_limit_minutes,
    CASE
      WHEN d.screen_time_phase = 'active' AND d.screen_time_session_started_at IS NOT NULL THEN
        GREATEST(
          0,
          EXTRACT(
            EPOCH FROM (
              d.screen_time_session_started_at
                + (d.screen_time_limit_minutes || ' minutes')::interval
                - p_server_now
            )
          )::INT
        )
      ELSE NULL
    END,
    public._device_playback_blocked(d),
    d.screen_time_challenge_task,
    d.intercept_active,
    d.intercept_video_count,
    d.intercept_watch_seconds,
    d.intercept_pending_video,
    d.intercept_scene_progress,
    d.lion_level,
    d.lion_xp,
    d.lion_active_outfit,
    d.educational_intercept_enabled,
    d.educational_intercept_frequency,
    public._normalize_break_interval_minutes(d.break_interval_minutes);
$$;

CREATE OR REPLACE FUNCTION public.child_try_begin_playback(
  p_access_token UUID,
  p_pending_video JSONB DEFAULT NULL
)
RETURNS TABLE (allowed BOOLEAN, intercept_activated BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_device public.devices%ROWTYPE;
  v_interval INT;
  v_threshold INT;
  v_assert RECORD;
BEGIN
  SELECT * INTO v_assert
  FROM public.child_assert_playback_allowed(p_access_token) AS t;

  IF NOT COALESCE(v_assert.allowed, false) THEN
    allowed := false;
    intercept_activated := false;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT * INTO v_device
  FROM public.devices d
  WHERE d.child_access_token = p_access_token
  LIMIT 1;

  IF NOT v_device.educational_intercept_enabled THEN
    allowed := true;
    intercept_activated := false;
    RETURN NEXT;
    RETURN;
  END IF;

  v_interval := public._normalize_break_interval_minutes(v_device.break_interval_minutes);
  v_threshold := v_interval * 60;

  IF v_device.intercept_watch_seconds >= v_threshold THEN
    UPDATE public.devices d
    SET
      intercept_active = true,
      intercept_pending_video = COALESCE(p_pending_video, d.intercept_pending_video),
      intercept_scene_progress = '[]'::jsonb
    WHERE d.id = v_device.id;

    allowed := false;
    intercept_activated := true;
    RETURN NEXT;
    RETURN;
  END IF;

  allowed := true;
  intercept_activated := false;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.child_add_intercept_watch_seconds(
  p_access_token UUID,
  p_seconds INT DEFAULT 1
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_device public.devices%ROWTYPE;
  v_delta INT;
  v_next INT;
  v_interval INT;
  v_threshold INT;
BEGIN
  v_delta := GREATEST(0, LEAST(30, COALESCE(p_seconds, 1)));

  SELECT * INTO v_device
  FROM public.devices d
  WHERE d.child_access_token = p_access_token
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  IF public._device_playback_blocked(v_device)
    OR NOT v_device.educational_intercept_enabled
    OR v_device.intercept_active THEN
    RETURN v_device.intercept_watch_seconds;
  END IF;

  v_next := v_device.intercept_watch_seconds + v_delta;
  v_interval := public._normalize_break_interval_minutes(v_device.break_interval_minutes);
  v_threshold := v_interval * 60;

  UPDATE public.devices d
  SET intercept_watch_seconds = v_next
  WHERE d.id = v_device.id;

  IF v_next >= v_threshold THEN
    UPDATE public.devices d
    SET
      intercept_active = true,
      intercept_scene_progress = '[]'::jsonb
    WHERE d.id = v_device.id
      AND NOT d.intercept_active;
  END IF;

  RETURN v_next;
END;
$$;

CREATE OR REPLACE FUNCTION public.child_report_video_playback_started(
  p_access_token UUID,
  p_video_id TEXT DEFAULT NULL
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.child_add_intercept_watch_seconds(p_access_token, 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.child_complete_intercept(p_access_token UUID)
RETURNS TABLE (
  lion_level INT,
  lion_xp INT,
  leveled_up BOOLEAN,
  levels_gained INT,
  xp_gained INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_device_id UUID;
  v_award RECORD;
BEGIN
  UPDATE public.devices d
  SET
    intercept_video_count = 0,
    intercept_watch_seconds = 0,
    intercept_active = false,
    intercept_pending_video = NULL,
    intercept_scene_progress = '[]'::jsonb
  WHERE d.child_access_token = p_access_token
    AND d.intercept_active = true
  RETURNING d.id INTO v_device_id;

  IF v_device_id IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO v_award
  FROM public._award_lion_xp_on_device(v_device_id, 50) AS t;

  lion_level := v_award.lion_level;
  lion_xp := v_award.lion_xp;
  leveled_up := v_award.leveled_up;
  levels_gained := v_award.levels_gained;
  xp_gained := 50;
  RETURN NEXT;
END;
$$;

DROP FUNCTION IF EXISTS public.parent_update_device_settings(UUID, BOOLEAN);

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
    allow_shorts = COALESCE(p_allow_shorts, d.allow_shorts),
    break_interval_minutes = CASE
      WHEN p_break_interval_minutes IS NULL THEN d.break_interval_minutes
      ELSE public._normalize_break_interval_minutes(p_break_interval_minutes)
    END,
    educational_intercept_enabled = COALESCE(p_educational_intercept_enabled, d.educational_intercept_enabled)
  WHERE d.id = p_device_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

DROP FUNCTION IF EXISTS public.child_get_device_state(UUID);

CREATE OR REPLACE FUNCTION public.child_get_device_state(p_access_token UUID)
RETURNS TABLE (
  device_id UUID,
  device_name TEXT,
  is_blocked BOOLEAN,
  is_online BOOLEAN,
  last_seen_at TIMESTAMPTZ,
  educational_intercept_enabled BOOLEAN,
  educational_intercept_frequency TEXT,
  break_interval_minutes INT,
  allow_shorts BOOLEAN
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
    d.educational_intercept_enabled,
    d.educational_intercept_frequency,
    public._normalize_break_interval_minutes(d.break_interval_minutes),
    d.allow_shorts
  FROM public.devices d
  WHERE d.child_access_token = p_access_token
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.child_add_intercept_watch_seconds(UUID, INT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.parent_update_device_settings(UUID, BOOLEAN, INT, BOOLEAN) TO authenticated;

NOTIFY pgrst, 'reload schema';
