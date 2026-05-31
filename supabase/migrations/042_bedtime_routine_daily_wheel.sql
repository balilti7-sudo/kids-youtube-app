-- Bedtime routine + daily wheel + weekly points (migration 042)

CREATE TABLE IF NOT EXISTS public.device_bedtime_settings (
  device_id UUID PRIMARY KEY REFERENCES public.devices (id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT true,
  treasure_points_threshold INT NOT NULL DEFAULT 100
    CHECK (treasure_points_threshold BETWEEN 10 AND 10000),
  treasure_prize_title TEXT NOT NULL DEFAULT 'Weekly treasure prize!',
  treasure_prize_description TEXT NOT NULL DEFAULT 'Great job with bedtime routine!',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS device_bedtime_settings_updated_at ON public.device_bedtime_settings;
CREATE TRIGGER device_bedtime_settings_updated_at
  BEFORE UPDATE ON public.device_bedtime_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.device_bedtime_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES public.devices (id) ON DELETE CASCADE,
  routine_date DATE NOT NULL,
  child_teeth_confirmed_at TIMESTAMPTZ,
  child_bathroom_confirmed_at TIMESTAMPTZ,
  child_tasks_completed_at TIMESTAMPTZ,
  parent_approved_at TIMESTAMPTZ,
  parent_approved_by UUID REFERENCES auth.users (id) ON DELETE SET NULL,
  wheel_spun_at TIMESTAMPTZ,
  wheel_points INT CHECK (wheel_points IS NULL OR wheel_points > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT device_bedtime_daily_device_date_key UNIQUE (device_id, routine_date),
  CONSTRAINT device_bedtime_daily_wheel_consistency CHECK (
    (wheel_spun_at IS NULL AND wheel_points IS NULL)
    OR (wheel_spun_at IS NOT NULL AND wheel_points IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_device_bedtime_daily_device_date
  ON public.device_bedtime_daily (device_id, routine_date DESC);

DROP TRIGGER IF EXISTS device_bedtime_daily_updated_at ON public.device_bedtime_daily;
CREATE TRIGGER device_bedtime_daily_updated_at
  BEFORE UPDATE ON public.device_bedtime_daily
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.device_bedtime_weekly_points (
  device_id UUID NOT NULL REFERENCES public.devices (id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  total_points INT NOT NULL DEFAULT 0 CHECK (total_points >= 0),
  spins_count INT NOT NULL DEFAULT 0 CHECK (spins_count >= 0),
  treasure_opened_at TIMESTAMPTZ,
  treasure_claimed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_device_bedtime_weekly_points_week
  ON public.device_bedtime_weekly_points (week_start DESC);

DROP TRIGGER IF EXISTS device_bedtime_weekly_points_updated_at ON public.device_bedtime_weekly_points;
CREATE TRIGGER device_bedtime_weekly_points_updated_at
  BEFORE UPDATE ON public.device_bedtime_weekly_points
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.device_bedtime_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_bedtime_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_bedtime_weekly_points ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS device_bedtime_settings_select_own ON public.device_bedtime_settings;
CREATE POLICY device_bedtime_settings_select_own
  ON public.device_bedtime_settings FOR SELECT TO authenticated
  USING (device_id IN (SELECT d.id FROM public.devices d WHERE d.user_id = auth.uid()));

DROP POLICY IF EXISTS device_bedtime_settings_all_own ON public.device_bedtime_settings;
CREATE POLICY device_bedtime_settings_all_own
  ON public.device_bedtime_settings FOR ALL TO authenticated
  USING (device_id IN (SELECT d.id FROM public.devices d WHERE d.user_id = auth.uid()))
  WITH CHECK (device_id IN (SELECT d.id FROM public.devices d WHERE d.user_id = auth.uid()));

DROP POLICY IF EXISTS device_bedtime_daily_select_own ON public.device_bedtime_daily;
CREATE POLICY device_bedtime_daily_select_own
  ON public.device_bedtime_daily FOR SELECT TO authenticated
  USING (device_id IN (SELECT d.id FROM public.devices d WHERE d.user_id = auth.uid()));

DROP POLICY IF EXISTS device_bedtime_weekly_points_select_own ON public.device_bedtime_weekly_points;
CREATE POLICY device_bedtime_weekly_points_select_own
  ON public.device_bedtime_weekly_points FOR SELECT TO authenticated
  USING (device_id IN (SELECT d.id FROM public.devices d WHERE d.user_id = auth.uid()));

CREATE OR REPLACE FUNCTION public._bedtime_routine_date(p_at TIMESTAMPTZ DEFAULT now())
RETURNS DATE
LANGUAGE sql
STABLE
AS $$
  SELECT (p_at AT TIME ZONE 'UTC')::date;
$$;

CREATE OR REPLACE FUNCTION public._bedtime_week_start(p_at TIMESTAMPTZ DEFAULT now())
RETURNS DATE
LANGUAGE sql
STABLE
AS $$
  SELECT date_trunc('week', p_at AT TIME ZONE 'UTC')::date;
$$;

CREATE OR REPLACE FUNCTION public._bedtime_is_treasure_window(p_at TIMESTAMPTZ DEFAULT now())
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT
    EXTRACT(ISODOW FROM p_at AT TIME ZONE 'UTC')::int = 4
    AND EXTRACT(HOUR FROM p_at AT TIME ZONE 'UTC')::int >= 18;
$$;

CREATE OR REPLACE FUNCTION public._bedtime_roll_wheel_points()
RETURNS INT
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  v_roll DOUBLE PRECISION := random();
BEGIN
  IF v_roll < 0.50 THEN
    RETURN 10;
  ELSIF v_roll < 0.85 THEN
    RETURN 20;
  ELSE
    RETURN 50;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public._bedtime_ensure_settings(p_device_id UUID)
RETURNS public.device_bedtime_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.device_bedtime_settings%ROWTYPE;
BEGIN
  INSERT INTO public.device_bedtime_settings (device_id)
  VALUES (p_device_id)
  ON CONFLICT (device_id) DO NOTHING;

  SELECT s.* INTO v_row
  FROM public.device_bedtime_settings s
  WHERE s.device_id = p_device_id;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public._bedtime_ensure_daily_row(
  p_device_id UUID,
  p_routine_date DATE
)
RETURNS public.device_bedtime_daily
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.device_bedtime_daily%ROWTYPE;
BEGIN
  INSERT INTO public.device_bedtime_daily (device_id, routine_date)
  VALUES (p_device_id, p_routine_date)
  ON CONFLICT (device_id, routine_date) DO NOTHING;

  SELECT d.* INTO v_row
  FROM public.device_bedtime_daily d
  WHERE d.device_id = p_device_id
    AND d.routine_date = p_routine_date;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public._bedtime_ensure_weekly_row(
  p_device_id UUID,
  p_week_start DATE
)
RETURNS public.device_bedtime_weekly_points
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.device_bedtime_weekly_points%ROWTYPE;
BEGIN
  INSERT INTO public.device_bedtime_weekly_points (device_id, week_start)
  VALUES (p_device_id, p_week_start)
  ON CONFLICT (device_id, week_start) DO NOTHING;

  SELECT w.* INTO v_row
  FROM public.device_bedtime_weekly_points w
  WHERE w.device_id = p_device_id
    AND w.week_start = p_week_start;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.parent_approve_bedtime(
  p_device_id UUID,
  p_routine_date DATE DEFAULT NULL
)
RETURNS TABLE (
  out_device_id UUID,
  out_routine_date DATE,
  out_parent_approved_at TIMESTAMPTZ,
  out_can_spin_wheel BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_date DATE := COALESCE(p_routine_date, public._bedtime_routine_date(now()));
  v_row public.device_bedtime_daily%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.devices d
    WHERE d.id = p_device_id AND d.user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'DEVICE_NOT_FOUND';
  END IF;

  PERFORM public._bedtime_ensure_settings(p_device_id);
  SELECT * INTO v_row FROM public._bedtime_ensure_daily_row(p_device_id, v_date);

  IF v_row.parent_approved_at IS NULL THEN
    UPDATE public.device_bedtime_daily d
    SET
      parent_approved_at = now(),
      parent_approved_by = v_uid
    WHERE d.id = v_row.id
    RETURNING * INTO v_row;
  END IF;

  out_device_id := p_device_id;
  out_routine_date := v_date;
  out_parent_approved_at := v_row.parent_approved_at;
  out_can_spin_wheel := v_row.parent_approved_at IS NOT NULL AND v_row.wheel_spun_at IS NULL;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.child_confirm_bedtime_task(
  p_access_token UUID,
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
  v_device_id UUID;
  v_date DATE := public._bedtime_routine_date(now());
  v_row public.device_bedtime_daily%ROWTYPE;
  v_task TEXT := lower(btrim(p_task));
BEGIN
  SELECT d.id INTO v_device_id
  FROM public.devices d
  WHERE d.child_access_token = p_access_token
  LIMIT 1;

  IF v_device_id IS NULL THEN
    RETURN;
  END IF;

  IF v_task NOT IN ('teeth', 'bathroom') THEN
    RAISE EXCEPTION 'INVALID_BEDTIME_TASK';
  END IF;

  SELECT * INTO v_row FROM public._bedtime_ensure_daily_row(v_device_id, v_date);

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

CREATE OR REPLACE FUNCTION public.child_spin_daily_wheel(p_access_token UUID)
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
  v_device_id UUID;
  v_date DATE := public._bedtime_routine_date(now());
  v_week DATE := public._bedtime_week_start(now());
  v_daily public.device_bedtime_daily%ROWTYPE;
  v_weekly public.device_bedtime_weekly_points%ROWTYPE;
  v_points INT;
  v_settings public.device_bedtime_settings%ROWTYPE;
BEGIN
  SELECT d.id INTO v_device_id
  FROM public.devices d
  WHERE d.child_access_token = p_access_token
  LIMIT 1;

  IF v_device_id IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO v_settings FROM public._bedtime_ensure_settings(v_device_id);

  IF NOT v_settings.enabled THEN
    RAISE EXCEPTION 'BEDTIME_ROUTINE_DISABLED';
  END IF;

  SELECT * INTO v_daily FROM public._bedtime_ensure_daily_row(v_device_id, v_date);

  IF v_daily.parent_approved_at IS NULL THEN
    RAISE EXCEPTION 'PARENT_APPROVAL_REQUIRED';
  END IF;

  IF v_daily.wheel_spun_at IS NOT NULL THEN
    SELECT * INTO v_weekly FROM public._bedtime_ensure_weekly_row(v_device_id, v_week);
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
  VALUES (v_device_id, v_week, v_points, 1)
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

CREATE OR REPLACE FUNCTION public.child_get_bedtime_state(p_access_token UUID)
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

CREATE OR REPLACE FUNCTION public.child_claim_treasure_chest(p_access_token UUID)
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
  v_device_id UUID;
  v_now TIMESTAMPTZ := now();
  v_week DATE := public._bedtime_week_start(v_now);
  v_weekly public.device_bedtime_weekly_points%ROWTYPE;
  v_settings public.device_bedtime_settings%ROWTYPE;
BEGIN
  SELECT d.id INTO v_device_id
  FROM public.devices d
  WHERE d.child_access_token = p_access_token
  LIMIT 1;

  IF v_device_id IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO v_settings FROM public._bedtime_ensure_settings(v_device_id);

  IF NOT v_settings.enabled THEN
    RAISE EXCEPTION 'BEDTIME_ROUTINE_DISABLED';
  END IF;

  IF NOT public._bedtime_is_treasure_window(v_now) THEN
    RAISE EXCEPTION 'TREASURE_WINDOW_CLOSED';
  END IF;

  SELECT * INTO v_weekly FROM public._bedtime_ensure_weekly_row(v_device_id, v_week);

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
  WHERE w.device_id = v_device_id
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

CREATE OR REPLACE FUNCTION public.parent_get_bedtime_state(
  p_device_id UUID,
  p_routine_date DATE DEFAULT NULL
)
RETURNS TABLE (
  routine_date DATE,
  week_start DATE,
  enabled BOOLEAN,
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

CREATE OR REPLACE FUNCTION public.parent_update_bedtime_settings(
  p_device_id UUID,
  p_enabled BOOLEAN DEFAULT NULL,
  p_treasure_points_threshold INT DEFAULT NULL,
  p_treasure_prize_title TEXT DEFAULT NULL,
  p_treasure_prize_description TEXT DEFAULT NULL
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
    treasure_prize_description = COALESCE(NULLIF(btrim(p_treasure_prize_description), ''), s.treasure_prize_description)
  WHERE s.device_id = p_device_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

GRANT SELECT ON public.device_bedtime_settings TO authenticated;
GRANT SELECT ON public.device_bedtime_daily TO authenticated;
GRANT SELECT ON public.device_bedtime_weekly_points TO authenticated;

GRANT EXECUTE ON FUNCTION public.parent_approve_bedtime(UUID, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.parent_get_bedtime_state(UUID, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.parent_update_bedtime_settings(UUID, BOOLEAN, INT, TEXT, TEXT) TO authenticated;

GRANT EXECUTE ON FUNCTION public.child_confirm_bedtime_task(UUID, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.child_spin_daily_wheel(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.child_get_bedtime_state(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.child_claim_treasure_chest(UUID) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
