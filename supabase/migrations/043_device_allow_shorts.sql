-- Per-device Shorts policy (parent toggles allow_shorts on devices table).

ALTER TABLE public.devices
  ADD COLUMN IF NOT EXISTS allow_shorts BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.devices.allow_shorts IS
  'When false, child video RPCs and UI should hide YouTube Shorts (≤90s, #shorts titles, etc.).';

-- Classify cached rows as Shorts for server-side filtering (matches client SHORT_MAX_DURATION_SECONDS = 60).
CREATE OR REPLACE FUNCTION public._video_is_youtube_short(
  p_title TEXT,
  p_duration_seconds INT
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    CASE
      WHEN p_duration_seconds IS NOT NULL
        AND p_duration_seconds > 0
        AND p_duration_seconds <= 60 THEN true
      WHEN p_title IS NOT NULL AND (
        p_title ~* '#shorts'
        OR p_title ~* 'shorts[[:space:]]*$'
        OR p_title ~* 'שורטס'
      ) THEN true
      ELSE false
    END;
$$;

DROP FUNCTION IF EXISTS public.child_get_device_state(UUID);

CREATE OR REPLACE FUNCTION public.child_get_device_state(p_access_token UUID)
RETURNS TABLE (
  device_id UUID,
  device_name TEXT,
  is_blocked BOOLEAN,
  is_online BOOLEAN,
  last_seen_at TIMESTAMPTZ,
  educational_intercept_enabled BOOLEAN,
  educational_intercept_frequency TEXT,
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
    d.educational_intercept_enabled,
    d.educational_intercept_frequency,
    d.allow_shorts
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
  educational_intercept_enabled BOOLEAN,
  educational_intercept_frequency TEXT,
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
    (SELECT count(*)::bigint FROM public.device_whitelist dw WHERE dw.device_id = d.id) AS channel_count,
    d.educational_intercept_enabled,
    d.educational_intercept_frequency,
    d.allow_shorts
  FROM public.devices d
  WHERE d.child_access_token = p_access_token
  LIMIT 1;
$$;

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
  SET allow_shorts = COALESCE(p_allow_shorts, d.allow_shorts)
  WHERE d.id = p_device_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

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
    AND (
      d.allow_shorts = true
      OR NOT public._video_is_youtube_short(cvc.title, cvc.duration_seconds)
    )
  ORDER BY cvc.position ASC, cvc.published_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.child_get_device_state(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.local_parent_device_summary(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.parent_update_device_settings(UUID, BOOLEAN) TO authenticated;

NOTIFY pgrst, 'reload schema';
