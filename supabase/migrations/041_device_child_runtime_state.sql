-- Server-authoritative child runtime: screen time, educational intercept, lion progression.
-- Replaces client-only localStorage as the source of truth for enforcement.

ALTER TABLE public.devices
  ADD COLUMN IF NOT EXISTS screen_time_phase TEXT NOT NULL DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS screen_time_limit_minutes INT NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS screen_time_session_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS screen_time_challenge_task TEXT,
  ADD COLUMN IF NOT EXISTS intercept_video_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS intercept_active BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS intercept_pending_video JSONB,
  ADD COLUMN IF NOT EXISTS intercept_scene_progress JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS lion_level INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS lion_xp INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lion_active_outfit TEXT NOT NULL DEFAULT 'cub';

ALTER TABLE public.devices
  DROP CONSTRAINT IF EXISTS devices_screen_time_phase_check;

ALTER TABLE public.devices
  ADD CONSTRAINT devices_screen_time_phase_check
  CHECK (screen_time_phase IN ('idle', 'active', 'challenge', 'locked'));

ALTER TABLE public.devices
  DROP CONSTRAINT IF EXISTS devices_screen_time_limit_minutes_check;

ALTER TABLE public.devices
  ADD CONSTRAINT devices_screen_time_limit_minutes_check
  CHECK (screen_time_limit_minutes BETWEEN 1 AND 1440);

ALTER TABLE public.devices
  DROP CONSTRAINT IF EXISTS devices_intercept_video_count_check;

ALTER TABLE public.devices
  ADD CONSTRAINT devices_intercept_video_count_check
  CHECK (intercept_video_count >= 0);

ALTER TABLE public.devices
  DROP CONSTRAINT IF EXISTS devices_lion_level_check;

ALTER TABLE public.devices
  ADD CONSTRAINT devices_lion_level_check
  CHECK (lion_level >= 1);

ALTER TABLE public.devices
  DROP CONSTRAINT IF EXISTS devices_lion_xp_check;

ALTER TABLE public.devices
  ADD CONSTRAINT devices_lion_xp_check
  CHECK (lion_xp >= 0 AND lion_xp < 100);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._pick_gift_challenge_task()
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  tasks TEXT[] := ARRAY[
    'תן חיבוק ענק לאבא או אמא!',
    'סדר 3 צעצועים או ספרים במקום.',
    'שתה כוס מים שלמה בישיבה.',
    'מצא 3 חפצים בצבע כחול בחדר וגע בהם.',
    'אמור למישהו בבית "תודה" בקול רם וחיוך.',
    'עשה 5 קפיצות קטנות במקום.',
    'ספר בקול לאחד מבני הבית על היום שלך.'
  ];
BEGIN
  RETURN tasks[1 + floor(random() * array_length(tasks, 1))::int];
END;
$$;

CREATE OR REPLACE FUNCTION public._device_playback_blocked(d public.devices)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    d.is_blocked
    OR d.screen_time_phase IN ('challenge', 'locked')
    OR d.intercept_active;
$$;

CREATE OR REPLACE FUNCTION public._normalize_intercept_frequency(raw TEXT)
RETURNS INT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN raw = '2' THEN 2
    WHEN raw = '5' THEN 5
    ELSE 3
  END;
$$;

CREATE OR REPLACE FUNCTION public._award_lion_xp_on_device(p_device_id UUID, p_amount INT)
RETURNS TABLE (lion_level INT, lion_xp INT, leveled_up BOOLEAN, levels_gained INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_level INT;
  v_xp INT;
  v_gain INT := GREATEST(0, p_amount);
  v_levels_gained INT := 0;
BEGIN
  SELECT d.lion_level, d.lion_xp
  INTO v_level, v_xp
  FROM public.devices d
  WHERE d.id = p_device_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_xp := v_xp + v_gain;
  WHILE v_xp >= 100 LOOP
    v_xp := v_xp - 100;
    v_level := v_level + 1;
    v_levels_gained := v_levels_gained + 1;
  END LOOP;

  UPDATE public.devices d
  SET lion_level = v_level, lion_xp = v_xp
  WHERE d.id = p_device_id;

  lion_level := v_level;
  lion_xp := v_xp;
  leveled_up := v_levels_gained > 0;
  levels_gained := v_levels_gained;
  RETURN NEXT;
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
  intercept_pending_video JSONB,
  intercept_scene_progress JSONB,
  lion_level INT,
  lion_xp INT,
  lion_active_outfit TEXT,
  educational_intercept_enabled BOOLEAN,
  educational_intercept_frequency TEXT
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
    d.intercept_pending_video,
    d.intercept_scene_progress,
    d.lion_level,
    d.lion_xp,
    d.lion_active_outfit,
    d.educational_intercept_enabled,
    d.educational_intercept_frequency;
$$;

-- ---------------------------------------------------------------------------
-- Parent: start / reset screen-time session (authenticated owner only)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.parent_start_screen_time(
  p_device_id UUID,
  p_limit_minutes INT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  UPDATE public.devices d
  SET
    screen_time_phase = 'active',
    screen_time_limit_minutes = LEAST(1440, GREATEST(1, p_limit_minutes)),
    screen_time_session_started_at = now(),
    screen_time_challenge_task = NULL
  WHERE d.id = p_device_id
    AND d.user_id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DEVICE_NOT_FOUND';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Child tick: heartbeat + expiry + full runtime snapshot (server clock)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.child_tick_screen_time(p_access_token UUID)
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
  intercept_pending_video JSONB,
  intercept_scene_progress JSONB,
  lion_level INT,
  lion_xp INT,
  lion_active_outfit TEXT,
  educational_intercept_enabled BOOLEAN,
  educational_intercept_frequency TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_device public.devices%ROWTYPE;
  v_now TIMESTAMPTZ := now();
  v_ends TIMESTAMPTZ;
BEGIN
  UPDATE public.devices d
  SET is_online = TRUE, last_seen_at = v_now
  WHERE d.child_access_token = p_access_token
  RETURNING * INTO v_device;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_device.screen_time_phase = 'active' AND v_device.screen_time_session_started_at IS NOT NULL THEN
    v_ends := v_device.screen_time_session_started_at
      + (v_device.screen_time_limit_minutes || ' minutes')::interval;
    IF v_now >= v_ends THEN
      UPDATE public.devices d
      SET
        screen_time_phase = 'challenge',
        screen_time_challenge_task = COALESCE(d.screen_time_challenge_task, public._pick_gift_challenge_task())
      WHERE d.id = v_device.id
      RETURNING * INTO v_device;
    END IF;
  END IF;

  RETURN QUERY
  SELECT * FROM public._child_runtime_row(v_device, v_now);
END;
$$;

CREATE OR REPLACE FUNCTION public.child_complete_screen_time_challenge(p_access_token UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.devices d
  SET
    screen_time_phase = 'locked',
    screen_time_session_started_at = NULL,
    screen_time_challenge_task = NULL
  WHERE d.child_access_token = p_access_token
    AND d.screen_time_phase = 'challenge';
END;
$$;

CREATE OR REPLACE FUNCTION public.child_assert_playback_allowed(p_access_token UUID)
RETURNS TABLE (allowed BOOLEAN, reason TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_device public.devices%ROWTYPE;
  v_now TIMESTAMPTZ := now();
  v_ends TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_device
  FROM public.devices d
  WHERE d.child_access_token = p_access_token
  LIMIT 1;

  IF NOT FOUND THEN
    allowed := false;
    reason := 'DEVICE_NOT_FOUND';
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_device.screen_time_phase = 'active' AND v_device.screen_time_session_started_at IS NOT NULL THEN
    v_ends := v_device.screen_time_session_started_at
      + (v_device.screen_time_limit_minutes || ' minutes')::interval;
    IF v_now >= v_ends THEN
      UPDATE public.devices d
      SET
        screen_time_phase = 'challenge',
        screen_time_challenge_task = COALESCE(d.screen_time_challenge_task, public._pick_gift_challenge_task())
      WHERE d.id = v_device.id
      RETURNING * INTO v_device;
    END IF;
  END IF;

  IF v_device.is_blocked THEN
    allowed := false;
    reason := 'PARENT_BLOCKED';
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_device.screen_time_phase IN ('challenge', 'locked') THEN
    allowed := false;
    reason := 'SCREEN_TIME_BLOCKED';
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_device.intercept_active THEN
    allowed := false;
    reason := 'INTERCEPT_ACTIVE';
    RETURN NEXT;
    RETURN;
  END IF;

  allowed := true;
  reason := NULL;
  RETURN NEXT;
END;
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
  v_freq INT;
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

  v_freq := public._normalize_intercept_frequency(v_device.educational_intercept_frequency);

  IF v_device.intercept_video_count >= v_freq THEN
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

CREATE OR REPLACE FUNCTION public.child_report_video_playback_started(
  p_access_token UUID,
  p_video_id TEXT DEFAULT NULL
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_device public.devices%ROWTYPE;
  v_next INT;
BEGIN
  SELECT * INTO v_device
  FROM public.devices d
  WHERE d.child_access_token = p_access_token
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  IF public._device_playback_blocked(v_device) OR NOT v_device.educational_intercept_enabled THEN
    RETURN v_device.intercept_video_count;
  END IF;

  v_next := v_device.intercept_video_count + 1;

  UPDATE public.devices d
  SET intercept_video_count = v_next
  WHERE d.id = v_device.id;

  RETURN v_next;
END;
$$;

CREATE OR REPLACE FUNCTION public.child_mark_intercept_item_fixed(
  p_access_token UUID,
  p_item_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_progress JSONB;
BEGIN
  IF p_item_id IS NULL OR btrim(p_item_id) = '' THEN
    RETURN '[]'::jsonb;
  END IF;

  UPDATE public.devices d
  SET intercept_scene_progress = (
    SELECT COALESCE(jsonb_agg(to_jsonb(x)), '[]'::jsonb)
    FROM (
      SELECT DISTINCT val AS x
      FROM (
        SELECT jsonb_array_elements_text(COALESCE(d.intercept_scene_progress, '[]'::jsonb)) AS val
        UNION ALL
        SELECT btrim(p_item_id)
      ) AS merged
    ) AS uniq
  )
  WHERE d.child_access_token = p_access_token
    AND d.intercept_active = true
  RETURNING intercept_scene_progress INTO v_progress;

  RETURN COALESCE(v_progress, '[]'::jsonb);
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

CREATE OR REPLACE FUNCTION public.child_equip_lion_outfit(
  p_access_token UUID,
  p_outfit_id TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  const v_outfit TEXT := COALESCE(NULLIF(btrim(p_outfit_id), ''), 'cub');
BEGIN
  UPDATE public.devices d
  SET lion_active_outfit = v_outfit
  WHERE d.child_access_token = p_access_token;

  RETURN v_outfit;
END;
$$;

-- ---------------------------------------------------------------------------
-- Guard video list RPCs when parent blocked or screen-time locked
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.child_get_cached_channel_videos(
  p_access_token UUID,
  p_youtube_channel_id TEXT
)
RETURNS TABLE (
  youtube_video_id TEXT,
  title TEXT,
  thumbnail_url TEXT,
  published_at TIMESTAMPTZ,
  duration_seconds INT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    cvc.youtube_video_id,
    cvc.title,
    cvc.thumbnail_url,
    cvc.published_at,
    cvc.duration_seconds
  FROM public.devices d
  JOIN public.device_whitelist dw
    ON dw.device_id = d.id
  JOIN public.whitelisted_channels wc
    ON wc.id = dw.channel_id
  JOIN public.channel_videos_cache cvc
    ON cvc.channel_id = wc.id
  WHERE d.child_access_token = p_access_token
    AND d.is_blocked = false
    AND d.screen_time_phase NOT IN ('challenge', 'locked')
    AND btrim(wc.youtube_channel_id) = btrim(p_youtube_channel_id)
    AND NOT EXISTS (
      SELECT 1
      FROM public.device_hidden_videos dhv
      WHERE dhv.device_id = d.id
        AND dhv.youtube_video_id = cvc.youtube_video_id
    )
  ORDER BY cvc.position ASC, cvc.published_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.child_get_allowed_videos(p_access_token UUID)
RETURNS TABLE (
  device_id UUID,
  is_blocked BOOLEAN,
  youtube_video_id TEXT,
  title TEXT,
  thumbnail_url TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    d.id AS device_id,
    d.is_blocked,
    wv.youtube_video_id,
    wv.title,
    wv.thumbnail_url
  FROM public.devices d
  JOIN public.device_video_whitelist dvw
    ON dvw.device_id = d.id
  JOIN public.whitelisted_videos wv
    ON wv.id = dvw.video_id
  WHERE d.child_access_token = p_access_token
    AND d.is_blocked = false
    AND d.screen_time_phase NOT IN ('challenge', 'locked')
  ORDER BY dvw.added_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.parent_start_screen_time(UUID, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.child_tick_screen_time(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.child_complete_screen_time_challenge(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.child_assert_playback_allowed(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.child_try_begin_playback(UUID, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.child_report_video_playback_started(UUID, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.child_mark_intercept_item_fixed(UUID, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.child_complete_intercept(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.child_equip_lion_outfit(UUID, TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
