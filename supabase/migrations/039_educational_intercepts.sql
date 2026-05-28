-- Educational Intercepts (הפסקות חינוכיות) — per-device parent configuration.

ALTER TABLE public.devices
  ADD COLUMN IF NOT EXISTS educational_intercepts_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS educational_intercept_frequency INTEGER NOT NULL DEFAULT 3;

ALTER TABLE public.devices
  DROP CONSTRAINT IF EXISTS devices_educational_intercept_frequency_check;

ALTER TABLE public.devices
  ADD CONSTRAINT devices_educational_intercept_frequency_check
  CHECK (educational_intercept_frequency IN (2, 3, 5));

DROP FUNCTION IF EXISTS public.child_get_device_state(UUID);

CREATE OR REPLACE FUNCTION public.child_get_device_state(p_access_token UUID)
RETURNS TABLE (
  device_id UUID,
  device_name TEXT,
  is_blocked BOOLEAN,
  is_online BOOLEAN,
  last_seen_at TIMESTAMPTZ,
  educational_intercepts_enabled BOOLEAN,
  educational_intercept_frequency INTEGER
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
    d.educational_intercepts_enabled,
    d.educational_intercept_frequency
  FROM public.devices d
  WHERE d.child_access_token = p_access_token
  LIMIT 1;
$$;

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
  educational_intercepts_enabled BOOLEAN,
  educational_intercept_frequency INTEGER
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
    (SELECT count(*)::bigint FROM public.device_whitelist dw WHERE dw.device_id = d.id) AS channel_count,
    d.educational_intercepts_enabled,
    d.educational_intercept_frequency
  FROM public.devices d
  WHERE d.child_access_token = p_access_token
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.child_get_device_state(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.local_parent_device_summary(UUID) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
