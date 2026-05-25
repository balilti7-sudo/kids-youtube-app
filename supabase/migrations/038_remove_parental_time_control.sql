-- Remove parental time controls and watch-time tracking.

DROP FUNCTION IF EXISTS public.child_report_watch_seconds(UUID, INT);
DROP FUNCTION IF EXISTS public.child_get_device_state(UUID);
DROP FUNCTION IF EXISTS public.child_heartbeat(UUID);
DROP FUNCTION IF EXISTS public.local_parent_device_summary(UUID);

CREATE OR REPLACE FUNCTION public.child_get_device_state(p_access_token UUID)
RETURNS TABLE (
  device_id UUID,
  device_name TEXT,
  is_blocked BOOLEAN,
  is_online BOOLEAN,
  last_seen_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT d.id, d.name, d.is_blocked, d.is_online, d.last_seen_at
  FROM public.devices d
  WHERE d.child_access_token = p_access_token
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.child_heartbeat(p_access_token UUID)
RETURNS TABLE (
  device_id UUID,
  is_blocked BOOLEAN,
  last_seen_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.devices d
  SET is_online = TRUE, last_seen_at = now()
  WHERE d.child_access_token = p_access_token
  RETURNING d.id, d.is_blocked, d.last_seen_at;
$$;

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
  channel_count BIGINT
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
    (SELECT count(*)::bigint FROM public.device_whitelist dw WHERE dw.device_id = d.id) AS channel_count
  FROM public.devices d
  WHERE d.child_access_token = p_access_token
  LIMIT 1;
$$;

DROP TABLE IF EXISTS public.device_daily_watch;
DROP FUNCTION IF EXISTS public._device_watch_seconds_today(UUID);
DROP FUNCTION IF EXISTS public._device_watch_date_today();

ALTER TABLE public.devices
  DROP COLUMN IF EXISTS time_limit_minutes,
  DROP COLUMN IF EXISTS sleep_time_start,
  DROP COLUMN IF EXISTS is_remote_paused;

GRANT EXECUTE ON FUNCTION public.child_get_device_state(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.child_heartbeat(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.local_parent_device_summary(UUID) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
