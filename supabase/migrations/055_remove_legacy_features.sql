-- Remove legacy features: parent voice messages, device link codes, bedtime routine, educational intercept.
-- Run in Supabase SQL Editor after deploying the matching frontend cleanup.
--
-- Fixes PostgreSQL 42P13 ("cannot change return type"): drop ALL overloads before CREATE.

-- ---------------------------------------------------------------------------
-- Drop every overload of legacy / replaced functions
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
  fn TEXT;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'child_get_bedtime_state',
    'child_confirm_bedtime_task',
    'child_spin_daily_wheel',
    'child_claim_treasure_chest',
    'parent_approve_bedtime',
    'parent_get_bedtime_state',
    'parent_start_bedtime_grace',
    'owner_get_bedtime_state',
    'owner_confirm_bedtime_task',
    'owner_spin_daily_wheel',
    'owner_claim_treasure_chest',
    'parent_update_bedtime_settings',
    'child_try_begin_playback',
    'child_complete_intercept',
    'child_mark_intercept_item_fixed',
    'child_add_intercept_watch_seconds',
    'child_report_video_playback_started',
    'child_get_latest_parent_message',
    'child_generate_device_link_code',
    'parent_link_device_by_code',
    '_normalize_break_interval_minutes',
    '_normalize_intercept_frequency',
    '_normalize_bedtime_grace_minutes',
    '_bedtime_routine_date',
    '_bedtime_week_start',
    '_bedtime_is_treasure_window',
    '_bedtime_ensure_settings',
    '_bedtime_ensure_daily_row',
    '_bedtime_ensure_weekly_row',
    '_bedtime_roll_wheel_points',
    '_purge_expired_pairing_codes',
    '_generate_six_digit_link_code',
    '_device_playback_blocked',
    '_child_runtime_row',
    'child_tick_screen_time',
    'child_get_device_state',
    'local_parent_device_summary',
    'parent_update_device_settings'
  ]
  LOOP
    FOR r IN
      SELECT pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = fn
    LOOP
      EXECUTE format('DROP FUNCTION IF EXISTS public.%I(%s)', fn, r.args);
    END LOOP;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Drop tables (legacy features)
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS public.device_bedtime_daily CASCADE;
DROP TABLE IF EXISTS public.device_bedtime_weekly_points CASCADE;
DROP TABLE IF EXISTS public.device_bedtime_settings CASCADE;
DROP TABLE IF EXISTS public.pairing_codes CASCADE;

-- ---------------------------------------------------------------------------
-- Fix invalid break_interval values, then drop intercept / bedtime device columns
-- Allowed values (migration 048): 5, 10, 15, 30, 45, 60 — default 30.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'devices'
      AND column_name = 'break_interval_minutes'
  ) THEN
    ALTER TABLE public.devices
      DROP CONSTRAINT IF EXISTS devices_break_interval_minutes_check;

    UPDATE public.devices d
    SET break_interval_minutes = 30
    WHERE d.break_interval_minutes IS NULL
       OR d.break_interval_minutes NOT IN (5, 10, 15, 30, 45, 60);

    ALTER TABLE public.devices
      ALTER COLUMN break_interval_minutes SET DEFAULT 30;

    ALTER TABLE public.devices
      ADD CONSTRAINT devices_break_interval_minutes_check
      CHECK (break_interval_minutes IN (5, 10, 15, 30, 45, 60));
  END IF;
END $$;

ALTER TABLE public.devices
  DROP COLUMN IF EXISTS educational_intercept_enabled,
  DROP COLUMN IF EXISTS educational_intercept_frequency,
  DROP COLUMN IF EXISTS break_interval_minutes,
  DROP COLUMN IF EXISTS intercept_watch_seconds,
  DROP COLUMN IF EXISTS intercept_active,
  DROP COLUMN IF EXISTS intercept_video_count,
  DROP COLUMN IF EXISTS intercept_pending_video,
  DROP COLUMN IF EXISTS intercept_scene_progress;

-- ---------------------------------------------------------------------------
-- Parent voice message columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.parent_settings
  DROP COLUMN IF EXISTS latest_parent_message,
  DROP COLUMN IF EXISTS latest_parent_message_at;

-- ---------------------------------------------------------------------------
-- Simplified playback blocking (no intercept)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._device_playback_blocked(d public.devices)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    d.is_blocked
    OR d.screen_time_phase IN ('challenge', 'locked');
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
  lion_level INT,
  lion_xp INT,
  lion_active_outfit TEXT
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
    d.lion_level,
    d.lion_xp,
    d.lion_active_outfit;
$$;

-- child_tick_screen_time must match _child_runtime_row output
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
  lion_level INT,
  lion_xp INT,
  lion_active_outfit TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_device public.devices%ROWTYPE;
  v_now TIMESTAMPTZ := now();
BEGIN
  SELECT * INTO v_device
  FROM public.devices d
  WHERE d.child_access_token = p_access_token
  LIMIT 1;

  IF v_device.id IS NULL THEN
    RETURN;
  END IF;

  IF v_device.screen_time_phase = 'active'
    AND v_device.screen_time_session_started_at IS NOT NULL
    AND v_now >= v_device.screen_time_session_started_at
         + (v_device.screen_time_limit_minutes || ' minutes')::interval
  THEN
    UPDATE public.devices d
    SET
      screen_time_phase = 'challenge',
      screen_time_challenge_task = public._random_screen_time_challenge_task()
    WHERE d.id = v_device.id
    RETURNING * INTO v_device;
  END IF;

  UPDATE public.devices d
  SET last_seen_at = v_now, is_online = true
  WHERE d.id = v_device.id;

  RETURN QUERY
  SELECT * FROM public._child_runtime_row(v_device, v_now);
END;
$$;

-- ---------------------------------------------------------------------------
-- Device settings RPC (allow_shorts only)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.parent_update_device_settings(UUID, BOOLEAN);

CREATE OR REPLACE FUNCTION public.parent_update_device_settings(
  p_device_id UUID,
  p_allow_shorts BOOLEAN DEFAULT NULL
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
    END
  WHERE d.id = p_device_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.parent_update_device_settings(UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.parent_update_device_settings(UUID, BOOLEAN) TO authenticated;

-- ---------------------------------------------------------------------------
-- child_get_device_state (allow_shorts only)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.child_get_device_state(UUID);

CREATE OR REPLACE FUNCTION public.child_get_device_state(p_access_token UUID)
RETURNS TABLE (
  device_id UUID,
  device_name TEXT,
  is_blocked BOOLEAN,
  is_online BOOLEAN,
  last_seen_at TIMESTAMPTZ,
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
    d.allow_shorts
  FROM public.devices d
  WHERE d.child_access_token = p_access_token
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.child_get_device_state(UUID) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- local_parent_device_summary (no intercept columns)
-- ---------------------------------------------------------------------------
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
  allow_shorts BOOLEAN
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
    d.allow_shorts
  FROM public.devices d
  JOIN public.local_parent_sessions s ON s.device_id = d.id
  WHERE s.access_token = p_access_token
    AND s.expires_at > now()
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.local_parent_device_summary(UUID) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
