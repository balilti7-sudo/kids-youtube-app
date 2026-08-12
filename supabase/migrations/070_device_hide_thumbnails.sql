-- Hide video thumbnails / black-screen playback while audio continues.
-- hide_thumbnails: when true, kid UI shows black instead of posters; player keeps playing with a black frame.

ALTER TABLE public.devices
  ADD COLUMN IF NOT EXISTS hide_thumbnails BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.devices.hide_thumbnails IS
  'When true, kid mode hides list/player visual frames (black screen) while playback/audio continues.';

-- Recreate settings RPCs with p_hide_thumbnails (drop prior 6-arg signatures from 066/069).
DROP FUNCTION IF EXISTS public.parent_update_device_settings(UUID, BOOLEAN, BOOLEAN, BOOLEAN, TEXT[], INT);
DROP FUNCTION IF EXISTS public.local_parent_update_device_settings(UUID, BOOLEAN, BOOLEAN, BOOLEAN, TEXT[], INT);

CREATE OR REPLACE FUNCTION public.parent_update_device_settings(
  p_device_id UUID,
  p_allow_shorts BOOLEAN DEFAULT NULL,
  p_block_youtube_app BOOLEAN DEFAULT NULL,
  p_browser_filter_enabled BOOLEAN DEFAULT NULL,
  p_browser_whitelist TEXT[] DEFAULT NULL,
  p_daily_time_limit_minutes INT DEFAULT NULL,
  p_hide_thumbnails BOOLEAN DEFAULT NULL
)
RETURNS public.devices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.devices%ROWTYPE;
  v_limit INT;
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

  IF p_daily_time_limit_minutes IS NOT NULL THEN
    v_limit := p_daily_time_limit_minutes;
    IF v_limit <> 0 AND (v_limit < 1 OR v_limit > 1440) THEN
      RAISE EXCEPTION 'INVALID_DAILY_TIME_LIMIT';
    END IF;
  END IF;

  UPDATE public.devices d
  SET
    allow_shorts = CASE
      WHEN p_allow_shorts IS NULL THEN d.allow_shorts
      ELSE p_allow_shorts
    END,
    block_youtube_app = CASE
      WHEN p_block_youtube_app IS NULL THEN d.block_youtube_app
      ELSE p_block_youtube_app
    END,
    browser_filter_enabled = CASE
      WHEN p_browser_filter_enabled IS NULL THEN d.browser_filter_enabled
      ELSE p_browser_filter_enabled
    END,
    browser_whitelist = CASE
      WHEN p_browser_whitelist IS NULL THEN d.browser_whitelist
      ELSE public._normalize_allowed_hosts(p_browser_whitelist)
    END,
    daily_time_limit_minutes = CASE
      WHEN p_daily_time_limit_minutes IS NULL THEN d.daily_time_limit_minutes
      ELSE p_daily_time_limit_minutes
    END,
    hide_thumbnails = CASE
      WHEN p_hide_thumbnails IS NULL THEN d.hide_thumbnails
      ELSE p_hide_thumbnails
    END
  WHERE d.id = p_device_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.local_parent_update_device_settings(
  p_access_token UUID,
  p_allow_shorts BOOLEAN DEFAULT NULL,
  p_block_youtube_app BOOLEAN DEFAULT NULL,
  p_browser_filter_enabled BOOLEAN DEFAULT NULL,
  p_browser_whitelist TEXT[] DEFAULT NULL,
  p_daily_time_limit_minutes INT DEFAULT NULL,
  p_hide_thumbnails BOOLEAN DEFAULT NULL
)
RETURNS public.devices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_device_id UUID;
  v_row public.devices%ROWTYPE;
  v_limit INT;
BEGIN
  IF p_access_token IS NULL THEN
    RAISE EXCEPTION 'INVALID_LOCAL_PARENT_TOKEN';
  END IF;

  SELECT d.id INTO v_device_id
  FROM public.devices d
  WHERE d.child_access_token = p_access_token
  LIMIT 1;

  IF v_device_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_LOCAL_PARENT_TOKEN';
  END IF;

  IF p_daily_time_limit_minutes IS NOT NULL THEN
    v_limit := p_daily_time_limit_minutes;
    IF v_limit <> 0 AND (v_limit < 1 OR v_limit > 1440) THEN
      RAISE EXCEPTION 'INVALID_DAILY_TIME_LIMIT';
    END IF;
  END IF;

  UPDATE public.devices d
  SET
    allow_shorts = CASE
      WHEN p_allow_shorts IS NULL THEN d.allow_shorts
      ELSE p_allow_shorts
    END,
    block_youtube_app = CASE
      WHEN p_block_youtube_app IS NULL THEN d.block_youtube_app
      ELSE p_block_youtube_app
    END,
    browser_filter_enabled = CASE
      WHEN p_browser_filter_enabled IS NULL THEN d.browser_filter_enabled
      ELSE p_browser_filter_enabled
    END,
    browser_whitelist = CASE
      WHEN p_browser_whitelist IS NULL THEN d.browser_whitelist
      ELSE public._normalize_allowed_hosts(p_browser_whitelist)
    END,
    daily_time_limit_minutes = CASE
      WHEN p_daily_time_limit_minutes IS NULL THEN d.daily_time_limit_minutes
      ELSE p_daily_time_limit_minutes
    END,
    hide_thumbnails = CASE
      WHEN p_hide_thumbnails IS NULL THEN d.hide_thumbnails
      ELSE p_hide_thumbnails
    END
  WHERE d.id = v_device_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.parent_update_device_settings(UUID, BOOLEAN, BOOLEAN, BOOLEAN, TEXT[], INT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.parent_update_device_settings(UUID, BOOLEAN, BOOLEAN, BOOLEAN, TEXT[], INT, BOOLEAN) TO authenticated;

REVOKE ALL ON FUNCTION public.local_parent_update_device_settings(UUID, BOOLEAN, BOOLEAN, BOOLEAN, TEXT[], INT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.local_parent_update_device_settings(UUID, BOOLEAN, BOOLEAN, BOOLEAN, TEXT[], INT, BOOLEAN) TO anon, authenticated;

DROP FUNCTION IF EXISTS public.child_get_device_state(UUID);

CREATE OR REPLACE FUNCTION public.child_get_device_state(p_access_token UUID)
RETURNS TABLE (
  device_id UUID,
  device_name TEXT,
  is_blocked BOOLEAN,
  is_online BOOLEAN,
  last_seen_at TIMESTAMPTZ,
  allow_shorts BOOLEAN,
  block_youtube_app BOOLEAN,
  browser_filter_enabled BOOLEAN,
  browser_whitelist TEXT[],
  daily_time_limit_minutes INT,
  hide_thumbnails BOOLEAN
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
    d.allow_shorts,
    d.block_youtube_app,
    d.browser_filter_enabled,
    d.browser_whitelist,
    d.daily_time_limit_minutes,
    d.hide_thumbnails
  FROM public.devices d
  WHERE d.child_access_token = p_access_token
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.child_get_device_state(UUID) TO anon, authenticated;

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
  allow_shorts BOOLEAN,
  block_youtube_app BOOLEAN,
  browser_filter_enabled BOOLEAN,
  browser_whitelist TEXT[],
  daily_time_limit_minutes INT,
  hide_thumbnails BOOLEAN
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
    d.allow_shorts,
    d.block_youtube_app,
    d.browser_filter_enabled,
    d.browser_whitelist,
    d.daily_time_limit_minutes,
    d.hide_thumbnails
  FROM public.devices d
  WHERE d.child_access_token = p_access_token
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.local_parent_device_summary(UUID) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
