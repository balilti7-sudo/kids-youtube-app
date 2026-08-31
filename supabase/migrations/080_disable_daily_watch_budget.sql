-- Disable daily watch budget for all profiles (0 = unlimited).
-- App also ignores daily limits client-side (DAILY_WATCH_BUDGET_ENABLED = false).

UPDATE public.devices
SET daily_time_limit_minutes = 0
WHERE daily_time_limit_minutes IS DISTINCT FROM 0;

ALTER TABLE public.devices
  ALTER COLUMN daily_time_limit_minutes SET DEFAULT 0;

COMMENT ON COLUMN public.devices.daily_time_limit_minutes IS
  'Per-profile daily watch budget in minutes (0 = unlimited). Feature currently disabled app-wide.';

-- Legacy parent_settings column if still present.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'parent_settings'
      AND column_name = 'daily_time_limit_minutes'
  ) THEN
    EXECUTE 'UPDATE public.parent_settings SET daily_time_limit_minutes = 0 WHERE daily_time_limit_minutes IS DISTINCT FROM 0';
    EXECUTE 'ALTER TABLE public.parent_settings ALTER COLUMN daily_time_limit_minutes SET DEFAULT 0';
  END IF;
END $$;
