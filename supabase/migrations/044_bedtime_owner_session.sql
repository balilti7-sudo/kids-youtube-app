-- Bedtime RPCs for the single authenticated-app flow (auth.uid() owns device, no child_access_token).

CREATE OR REPLACE FUNCTION public._assert_device_owner(p_device_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.devices d
    WHERE d.id = p_device_id
      AND d.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'DEVICE_NOT_FOUND';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_get_bedtime_state(p_device_id UUID)
RETURNS TABLE (
  server_now TIMESTAMPTZ,
  routine_date DATE,
  week_start DATE,
  enabled BOOLEAN,
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

CREATE OR REPLACE FUNCTION public.owner_confirm_bedtime_task(
  p_device_id UUID,
  p_task TEXT
)
RETURNS TABLE (
  out_routine_date DATE,
  out_teeth_confirmed BOOLEAN,
  out_bathroom_confirmed BOOLEAN,
  out_tasks_completed BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_date DATE := public._bedtime_routine_date(now());
  v_row public.device_bedtime_daily%ROWTYPE;
  v_task TEXT := lower(btrim(p_task));
BEGIN
  PERFORM public._assert_device_owner(p_device_id);

  IF v_task NOT IN ('teeth', 'bathroom') THEN
    RAISE EXCEPTION 'INVALID_BEDTIME_TASK';
  END IF;

  SELECT * INTO v_row FROM public._bedtime_ensure_daily_row(p_device_id, v_date);

  UPDATE public.device_bedtime_daily d
  SET
    child_teeth_confirmed_at = CASE
      WHEN v_task = 'teeth' THEN COALESCE(d.child_teeth_confirmed_at, now())
      ELSE d.child_teeth_confirmed_at
    END,
    child_bathroom_confirmed_at = CASE
      WHEN v_task = 'bathroom' THEN COALESCE(d.child_bathroom_confirmed_at, now())
      ELSE d.child_bathroom_confirmed_at
    END
  WHERE d.id = v_row.id
  RETURNING * INTO v_row;

  IF v_row.child_teeth_confirmed_at IS NOT NULL
     AND v_row.child_bathroom_confirmed_at IS NOT NULL
     AND v_row.child_tasks_completed_at IS NULL THEN
    UPDATE public.device_bedtime_daily d
    SET child_tasks_completed_at = now()
    WHERE d.id = v_row.id
    RETURNING * INTO v_row;
  END IF;

  out_routine_date := v_date;
  out_teeth_confirmed := v_row.child_teeth_confirmed_at IS NOT NULL;
  out_bathroom_confirmed := v_row.child_bathroom_confirmed_at IS NOT NULL;
  out_tasks_completed := v_row.child_tasks_completed_at IS NOT NULL;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_spin_daily_wheel(p_device_id UUID)
RETURNS TABLE (
  out_routine_date DATE,
  out_week_start DATE,
  out_points_won INT,
  out_weekly_total_points INT,
  out_spins_today INT,
  out_already_spun BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_date DATE := public._bedtime_routine_date(now());
  v_week DATE := public._bedtime_week_start(now());
  v_daily public.device_bedtime_daily%ROWTYPE;
  v_weekly public.device_bedtime_weekly_points%ROWTYPE;
  v_points INT;
  v_settings public.device_bedtime_settings%ROWTYPE;
BEGIN
  PERFORM public._assert_device_owner(p_device_id);

  SELECT * INTO v_settings FROM public._bedtime_ensure_settings(p_device_id);

  IF NOT v_settings.enabled THEN
    RAISE EXCEPTION 'BEDTIME_ROUTINE_DISABLED';
  END IF;

  SELECT * INTO v_daily FROM public._bedtime_ensure_daily_row(p_device_id, v_date);

  IF v_daily.parent_approved_at IS NULL THEN
    RAISE EXCEPTION 'PARENT_APPROVAL_REQUIRED';
  END IF;

  IF v_daily.wheel_spun_at IS NOT NULL THEN
    SELECT * INTO v_weekly FROM public._bedtime_ensure_weekly_row(p_device_id, v_week);
    out_routine_date := v_date;
    out_week_start := v_week;
    out_points_won := v_daily.wheel_points;
    out_weekly_total_points := v_weekly.total_points;
    out_spins_today := 1;
    out_already_spun := true;
    RETURN NEXT;
    RETURN;
  END IF;

  v_points := public._bedtime_roll_wheel_points();

  UPDATE public.device_bedtime_daily d
  SET
    wheel_spun_at = now(),
    wheel_points = v_points
  WHERE d.id = v_daily.id
  RETURNING * INTO v_daily;

  INSERT INTO public.device_bedtime_weekly_points (device_id, week_start, total_points, spins_count)
  VALUES (p_device_id, v_week, v_points, 1)
  ON CONFLICT (device_id, week_start) DO UPDATE
  SET
    total_points = public.device_bedtime_weekly_points.total_points + EXCLUDED.total_points,
    spins_count = public.device_bedtime_weekly_points.spins_count + 1,
    updated_at = now()
  RETURNING * INTO v_weekly;

  out_routine_date := v_date;
  out_week_start := v_week;
  out_points_won := v_points;
  out_weekly_total_points := v_weekly.total_points;
  out_spins_today := 1;
  out_already_spun := false;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_claim_treasure_chest(p_device_id UUID)
RETURNS TABLE (
  out_week_start DATE,
  out_weekly_total_points INT,
  out_treasure_threshold INT,
  out_treasure_prize_title TEXT,
  out_treasure_prize_description TEXT,
  out_claimed_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := now();
  v_week DATE := public._bedtime_week_start(v_now);
  v_weekly public.device_bedtime_weekly_points%ROWTYPE;
  v_settings public.device_bedtime_settings%ROWTYPE;
BEGIN
  PERFORM public._assert_device_owner(p_device_id);

  SELECT * INTO v_settings FROM public._bedtime_ensure_settings(p_device_id);

  IF NOT v_settings.enabled THEN
    RAISE EXCEPTION 'BEDTIME_ROUTINE_DISABLED';
  END IF;

  IF NOT public._bedtime_is_treasure_window(v_now) THEN
    RAISE EXCEPTION 'TREASURE_WINDOW_CLOSED';
  END IF;

  SELECT * INTO v_weekly FROM public._bedtime_ensure_weekly_row(p_device_id, v_week);

  IF v_weekly.total_points < v_settings.treasure_points_threshold THEN
    RAISE EXCEPTION 'INSUFFICIENT_WEEKLY_POINTS';
  END IF;

  IF v_weekly.treasure_claimed_at IS NOT NULL THEN
    out_week_start := v_week;
    out_weekly_total_points := v_weekly.total_points;
    out_treasure_threshold := v_settings.treasure_points_threshold;
    out_treasure_prize_title := v_settings.treasure_prize_title;
    out_treasure_prize_description := v_settings.treasure_prize_description;
    out_claimed_at := v_weekly.treasure_claimed_at;
    RETURN NEXT;
    RETURN;
  END IF;

  UPDATE public.device_bedtime_weekly_points w
  SET
    treasure_opened_at = COALESCE(w.treasure_opened_at, v_now),
    treasure_claimed_at = v_now
  WHERE w.device_id = p_device_id
    AND w.week_start = v_week
  RETURNING * INTO v_weekly;

  out_week_start := v_week;
  out_weekly_total_points := v_weekly.total_points;
  out_treasure_threshold := v_settings.treasure_points_threshold;
  out_treasure_prize_title := v_settings.treasure_prize_title;
  out_treasure_prize_description := v_settings.treasure_prize_description;
  out_claimed_at := v_weekly.treasure_claimed_at;
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.owner_get_bedtime_state(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_confirm_bedtime_task(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_spin_daily_wheel(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_claim_treasure_chest(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
