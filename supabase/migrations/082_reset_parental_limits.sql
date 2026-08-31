-- One-shot reset: parental limits removed app-wide.
-- Run in Supabase SQL editor if toggles in parent dashboard did not reach the server.

-- Shorts always allowed
UPDATE public.devices
SET allow_shorts = true
WHERE allow_shorts IS DISTINCT FROM true;

ALTER TABLE public.devices
  ALTER COLUMN allow_shorts SET DEFAULT true;

-- Daily watch budget off (0 = unlimited)
UPDATE public.devices
SET daily_time_limit_minutes = 0
WHERE daily_time_limit_minutes IS DISTINCT FROM 0;

ALTER TABLE public.devices
  ALTER COLUMN daily_time_limit_minutes SET DEFAULT 0;

-- Clear today's watch counters so a stale total cannot re-lock playback
UPDATE public.device_daily_watch
SET watch_seconds = 0,
    updated_at = now()
WHERE watch_date = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date
  AND watch_seconds <> 0;

-- End any active screen-time session / lock left on the device row
UPDATE public.devices
SET screen_time_phase = 'idle',
    screen_time_session_started_at = NULL,
    screen_time_challenge_task = NULL
WHERE screen_time_phase IS DISTINCT FROM 'idle'
   OR screen_time_session_started_at IS NOT NULL
   OR screen_time_challenge_task IS NOT NULL;

COMMENT ON COLUMN public.devices.allow_shorts IS
  'Shorts allowed (app ignores false while SHORTS_BLOCKING_ENABLED is off).';

COMMENT ON COLUMN public.devices.daily_time_limit_minutes IS
  'Daily watch minutes (0 = unlimited; app ignores positive limits while disabled).';
