-- Parent-controlled bedtime grace: no auto countdown until parent explicitly starts it.

ALTER TABLE public.device_bedtime_settings
  ADD COLUMN IF NOT EXISTS grace_period_minutes INT NOT NULL DEFAULT 5;

ALTER TABLE public.device_bedtime_settings
  DROP CONSTRAINT IF EXISTS device_bedtime_settings_grace_period_minutes_check;

ALTER TABLE public.device_bedtime_settings
  ADD CONSTRAINT device_bedtime_settings_grace_period_minutes_check
  CHECK (grace_period_minutes BETWEEN 1 AND 120);

ALTER TABLE public.device_bedtime_daily
  ADD COLUMN IF NOT EXISTS grace_countdown_started_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public._normalize_bedtime_grace_minutes(raw INT)
RETURNS INT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT GREATEST(1, LEAST(120, COALESCE(raw, 5)));
$$;

DROP FUNCTION IF EXISTS public.parent_update_bedtime_settings(UUID, BOOLEAN, INT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.parent_update_bedtime_settings(
  p_device_id UUID,
  p_enabled BOOLEAN DEFAULT NULL,
  p_treasure_points_threshold INT DEFAULT NULL,
  p_treasure_prize_title TEXT DEFAULT NULL,
  p_treasure_prize_description TEXT DEFAULT NULL,
  p_grace_period_minutes INT DEFAULT NULL
)
RETURNS public.device_bedtime_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.device_bedtime_settings%ROWTYPE;
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

  PERFORM public._bedtime_ensure_settings(p_device_id);

  UPDATE public.device_bedtime_settings s
  SET
    enabled = COALESCE(p_enabled, s.enabled),
    treasure_points_threshold = COALESCE(p_treasure_points_threshold, s.treasure_points_threshold),
    treasure_prize_title = COALESCE(NULLIF(btrim(p_treasure_prize_title), ''), s.treasure_prize_title),
    treasure_prize_description = COALESCE(NULLIF(btrim(p_treasure_prize_description), ''), s.treasure_prize_description),
    grace_period_minutes = CASE
      WHEN p_grace_period_minutes IS NULL THEN s.grace_period_minutes
      ELSE public._normalize_bedtime_grace_minutes(p_grace_period_minutes)
    END
  WHERE s.device_id = p_device_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.parent_start_bedtime_grace(
  p_device_id UUID,
  p_routine_date DATE DEFAULT NULL
)
RETURNS TABLE (
  routine_date DATE,
  grace_period_minutes INT,
  grace_countdown_started_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_date DATE := COALESCE(p_routine_date, public._bedtime_routine_date(now()));
  v_settings public.device_bedtime_settings%ROWTYPE;
  v_daily public.device_bedtime_daily%ROWTYPE;
  v_now TIMESTAMPTZ := now();
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

  SELECT * INTO v_settings FROM public._bedtime_ensure_settings(p_device_id);

  IF NOT v_settings.enabled THEN
    RAISE EXCEPTION 'BEDTIME_ROUTINE_DISABLED';
  END IF;

  PERFORM public._bedtime_ensure_daily_row(p_device_id, v_date);

  UPDATE public.device_bedtime_daily bd
  SET grace_countdown_started_at = v_now
  WHERE bd.device_id = p_device_id
    AND bd.routine_date = v_date
    AND bd.wheel_spun_at IS NULL
  RETURNING * INTO v_daily;

  IF v_daily.id IS NULL THEN
    RAISE EXCEPTION 'BEDTIME_ALREADY_COMPLETE';
  END IF;

  routine_date := v_date;
  grace_period_minutes := v_settings.grace_period_minutes;
  grace_countdown_started_at := v_daily.grace_countdown_started_at;
  RETURN NEXT;
END;
$$;

-- child_get_bedtime_state: expose grace settings + start timestamp
CREATE OR REPLACE FUNCTION public.child_get_bedtime_state(p_access_token UUID)
RETURNS TABLE (
  server_now TIMESTAMPTZ,
  routine_date DATE,
  week_start DATE,
  enabled BOOLEAN,
  grace_period_minutes INT,
  grace_countdown_started_at TIMESTAMPTZ,
  teeth_confirmed BOOLEAN,
  bathroom_confirmed BOOLEAN,
  tasks_completed BOOLEAN,
  parent_approved BOOLEAN,
  can_spin_wheel BOOLEAN,
  wheel_spun BOOLEAN,
  wheel_points_today INT,
  weekly_total_points INT,
  treasure_threshold INT,
  treasure_eligible BOOLEAN,
  treasure_window_open BOOLEAN,
  treasure_opened BOOLEAN,
  treasure_claimed BOOLEAN,
  treasure_prize_title TEXT,
  treasure_prize_description TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_device_id UUID;
  v_now TIMESTAMPTZ := now();
  v_date DATE := public._bedtime_routine_date(v_now);
  v_week DATE := public._bedtime_week_start(v_now);
  v_daily public.device_bedtime_daily%ROWTYPE;
  v_weekly public.device_bedtime_weekly_points%ROWTYPE;
  v_settings public.device_bedtime_settings%ROWTYPE;
  v_treasure_window BOOLEAN;
BEGIN
  SELECT d.id INTO v_device_id
  FROM public.devices d
  WHERE d.child_access_token = p_access_token
  LIMIT 1;

  IF v_device_id IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO v_settings FROM public._bedtime_ensure_settings(v_device_id);
  SELECT * INTO v_daily FROM public._bedtime_ensure_daily_row(v_device_id, v_date);
  SELECT * INTO v_weekly FROM public._bedtime_ensure_weekly_row(v_device_id, v_week);
  v_treasure_window := public._bedtime_is_treasure_window(v_now);

  server_now := v_now;
  routine_date := v_date;
  week_start := v_week;
  enabled := v_settings.enabled;
  grace_period_minutes := v_settings.grace_period_minutes;
  grace_countdown_started_at := v_daily.grace_countdown_started_at;
  teeth_confirmed := v_daily.child_teeth_confirmed_at IS NOT NULL;
  bathroom_confirmed := v_daily.child_bathroom_confirmed_at IS NOT NULL;
  tasks_completed := v_daily.child_tasks_completed_at IS NOT NULL;
  parent_approved := v_daily.parent_approved_at IS NOT NULL;
  can_spin_wheel := v_settings.enabled
    AND v_daily.parent_approved_at IS NOT NULL
    AND v_daily.wheel_spun_at IS NULL;
  wheel_spun := v_daily.wheel_spun_at IS NOT NULL;
  wheel_points_today := COALESCE(v_daily.wheel_points, 0);
  weekly_total_points := v_weekly.total_points;
  treasure_threshold := v_settings.treasure_points_threshold;
  treasure_window_open := v_treasure_window;
  treasure_eligible := v_settings.enabled
    AND v_treasure_window
    AND v_weekly.total_points >= v_settings.treasure_points_threshold
    AND v_weekly.treasure_claimed_at IS NULL;
  treasure_opened := v_weekly.treasure_opened_at IS NOT NULL;
  treasure_claimed := v_weekly.treasure_claimed_at IS NOT NULL;
  treasure_prize_title := v_settings.treasure_prize_title;
  treasure_prize_description := v_settings.treasure_prize_description;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_get_bedtime_state(p_device_id UUID)
RETURNS TABLE (
  server_now TIMESTAMPTZ,
  routine_date DATE,
  week_start DATE,
  enabled BOOLEAN,
  grace_period_minutes INT,
  grace_countdown_started_at TIMESTAMPTZ,
  teeth_confirmed BOOLEAN,
  bathroom_confirmed BOOLEAN,
  tasks_completed BOOLEAN,
  parent_approved BOOLEAN,
  can_spin_wheel BOOLEAN,
  wheel_spun BOOLEAN,
  wheel_points_today INT,
  weekly_total_points INT,
  treasure_threshold INT,
  treasure_eligible BOOLEAN,
  treasure_window_open BOOLEAN,
  treasure_opened BOOLEAN,
  treasure_claimed BOOLEAN,
  treasure_prize_title TEXT,
  treasure_prize_description TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := now();
  v_date DATE := public._bedtime_routine_date(v_now);
  v_week DATE := public._bedtime_week_start(v_now);
  v_daily public.device_bedtime_daily%ROWTYPE;
  v_weekly public.device_bedtime_weekly_points%ROWTYPE;
  v_settings public.device_bedtime_settings%ROWTYPE;
  v_treasure_window BOOLEAN;
BEGIN
  PERFORM public._assert_device_owner(p_device_id);

  SELECT * INTO v_settings FROM public._bedtime_ensure_settings(p_device_id);
  SELECT * INTO v_daily FROM public._bedtime_ensure_daily_row(p_device_id, v_date);
  SELECT * INTO v_weekly FROM public._bedtime_ensure_weekly_row(p_device_id, v_week);
  v_treasure_window := public._bedtime_is_treasure_window(v_now);

  server_now := v_now;
  routine_date := v_date;
  week_start := v_week;
  enabled := v_settings.enabled;
  grace_period_minutes := v_settings.grace_period_minutes;
  grace_countdown_started_at := v_daily.grace_countdown_started_at;
  teeth_confirmed := v_daily.child_teeth_confirmed_at IS NOT NULL;
  bathroom_confirmed := v_daily.child_bathroom_confirmed_at IS NOT NULL;
  tasks_completed := v_daily.child_tasks_completed_at IS NOT NULL;
  parent_approved := v_daily.parent_approved_at IS NOT NULL;
  can_spin_wheel := v_settings.enabled
    AND v_daily.parent_approved_at IS NOT NULL
    AND v_daily.wheel_spun_at IS NULL;
  wheel_spun := v_daily.wheel_spun_at IS NOT NULL;
  wheel_points_today := COALESCE(v_daily.wheel_points, 0);
  weekly_total_points := v_weekly.total_points;
  treasure_threshold := v_settings.treasure_points_threshold;
  treasure_window_open := v_treasure_window;
  treasure_eligible := v_settings.enabled
    AND v_treasure_window
    AND v_weekly.total_points >= v_settings.treasure_points_threshold
    AND v_weekly.treasure_claimed_at IS NULL;
  treasure_opened := v_weekly.treasure_opened_at IS NOT NULL;
  treasure_claimed := v_weekly.treasure_claimed_at IS NOT NULL;
  treasure_prize_title := v_settings.treasure_prize_title;
  treasure_prize_description := v_settings.treasure_prize_description;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.parent_get_bedtime_state(
  p_device_id UUID,
  p_routine_date DATE DEFAULT NULL
)
RETURNS TABLE (
  routine_date DATE,
  week_start DATE,
  enabled BOOLEAN,
  grace_period_minutes INT,
  grace_countdown_started_at TIMESTAMPTZ,
  teeth_confirmed BOOLEAN,
  bathroom_confirmed BOOLEAN,
  tasks_completed BOOLEAN,
  parent_approved BOOLEAN,
  parent_approved_at TIMESTAMPTZ,
  wheel_spun BOOLEAN,
  wheel_points_today INT,
  weekly_total_points INT,
  treasure_threshold INT,
  treasure_prize_title TEXT,
  treasure_prize_description TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_date DATE := COALESCE(p_routine_date, public._bedtime_routine_date(now()));
  v_week DATE := public._bedtime_week_start(now());
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

  PERFORM public._bedtime_ensure_settings(p_device_id);
  PERFORM public._bedtime_ensure_daily_row(p_device_id, v_date);
  PERFORM public._bedtime_ensure_weekly_row(p_device_id, v_week);

  RETURN QUERY
  SELECT
    v_date,
    v_week,
    s.enabled,
    s.grace_period_minutes,
    bd.grace_countdown_started_at,
    bd.child_teeth_confirmed_at IS NOT NULL,
    bd.child_bathroom_confirmed_at IS NOT NULL,
    bd.child_tasks_completed_at IS NOT NULL,
    bd.parent_approved_at IS NOT NULL,
    bd.parent_approved_at,
    bd.wheel_spun_at IS NOT NULL,
    COALESCE(bd.wheel_points, 0),
    COALESCE(w.total_points, 0),
    s.treasure_points_threshold,
    s.treasure_prize_title,
    s.treasure_prize_description
  FROM public.device_bedtime_settings s
  LEFT JOIN public.device_bedtime_daily bd
    ON bd.device_id = s.device_id AND bd.routine_date = v_date
  LEFT JOIN public.device_bedtime_weekly_points w
    ON w.device_id = s.device_id AND w.week_start = v_week
  WHERE s.device_id = p_device_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.parent_update_bedtime_settings(UUID, BOOLEAN, INT, TEXT, TEXT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.parent_start_bedtime_grace(UUID, DATE) TO authenticated;

NOTIFY pgrst, 'reload schema';
