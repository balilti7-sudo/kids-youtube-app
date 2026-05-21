-- =============================================================================
-- Per-device hidden videos: parent hides specific cached videos from kid UI.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.device_hidden_videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES public.devices (id) ON DELETE CASCADE,
  youtube_video_id TEXT NOT NULL,
  youtube_channel_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT device_hidden_videos_device_video_key UNIQUE (device_id, youtube_video_id)
);

CREATE INDEX IF NOT EXISTS idx_device_hidden_videos_device
  ON public.device_hidden_videos (device_id, youtube_video_id);

ALTER TABLE public.device_hidden_videos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS device_hidden_videos_select_own ON public.device_hidden_videos;
CREATE POLICY device_hidden_videos_select_own ON public.device_hidden_videos
  FOR SELECT TO authenticated
  USING (
    device_id IN (SELECT d.id FROM public.devices d WHERE d.user_id = auth.uid())
  );

DROP POLICY IF EXISTS device_hidden_videos_insert_own ON public.device_hidden_videos;
CREATE POLICY device_hidden_videos_insert_own ON public.device_hidden_videos
  FOR INSERT TO authenticated
  WITH CHECK (
    device_id IN (SELECT d.id FROM public.devices d WHERE d.user_id = auth.uid())
  );

DROP POLICY IF EXISTS device_hidden_videos_delete_own ON public.device_hidden_videos;
CREATE POLICY device_hidden_videos_delete_own ON public.device_hidden_videos
  FOR DELETE TO authenticated
  USING (
    device_id IN (SELECT d.id FROM public.devices d WHERE d.user_id = auth.uid())
  );

-- List hidden video IDs for a device (parent UI)
CREATE OR REPLACE FUNCTION public.device_hidden_videos_list(p_device_id UUID)
RETURNS TABLE (youtube_video_id TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT dhv.youtube_video_id
  FROM public.device_hidden_videos dhv
  JOIN public.devices d ON d.id = dhv.device_id
  WHERE dhv.device_id = p_device_id
    AND d.user_id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.device_hidden_videos_list(UUID) TO authenticated;

-- Local parent on kid device: hide / unhide with PIN
CREATE OR REPLACE FUNCTION public.local_parent_set_video_hidden(
  p_access_token UUID,
  p_pin TEXT,
  p_youtube_video_id TEXT,
  p_hidden BOOLEAN DEFAULT TRUE,
  p_youtube_channel_id TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_device public.devices%ROWTYPE;
  v_video_id TEXT;
BEGIN
  SELECT * INTO v_device
  FROM public.devices d
  WHERE d.child_access_token = p_access_token
  LIMIT 1;

  IF v_device.id IS NULL THEN RAISE EXCEPTION 'INVALID_CHILD_TOKEN'; END IF;
  IF NOT public._local_parent_pin_ok(v_device.user_id, p_pin) THEN
    RAISE EXCEPTION 'INVALID_PARENT_PIN';
  END IF;

  v_video_id := btrim(p_youtube_video_id);
  IF v_video_id = '' THEN RAISE EXCEPTION 'INVALID_VIDEO_ID'; END IF;

  IF COALESCE(p_hidden, TRUE) THEN
    INSERT INTO public.device_hidden_videos (device_id, youtube_video_id, youtube_channel_id)
    VALUES (v_device.id, v_video_id, NULLIF(btrim(p_youtube_channel_id), ''))
    ON CONFLICT (device_id, youtube_video_id) DO NOTHING;
    RETURN TRUE;
  END IF;

  DELETE FROM public.device_hidden_videos dhv
  WHERE dhv.device_id = v_device.id AND dhv.youtube_video_id = v_video_id;

  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION public.local_parent_set_video_hidden(UUID, TEXT, TEXT, BOOLEAN, TEXT) TO anon, authenticated;

-- Kid channel list: exclude hidden videos for this device
CREATE OR REPLACE FUNCTION public.child_get_cached_channel_videos(
  p_access_token UUID,
  p_youtube_channel_id TEXT
)
RETURNS TABLE (
  youtube_video_id TEXT,
  title TEXT,
  thumbnail_url TEXT,
  published_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    cvc.youtube_video_id,
    cvc.title,
    cvc.thumbnail_url,
    cvc.published_at
  FROM public.devices d
  JOIN public.device_whitelist dw ON dw.device_id = d.id
  JOIN public.whitelisted_channels wc ON wc.id = dw.channel_id
  JOIN public.channel_videos_cache cvc ON cvc.channel_id = wc.id
  WHERE d.child_access_token = p_access_token
    AND btrim(wc.youtube_channel_id) = btrim(p_youtube_channel_id)
    AND NOT EXISTS (
      SELECT 1
      FROM public.device_hidden_videos dhv
      WHERE dhv.device_id = d.id
        AND dhv.youtube_video_id = cvc.youtube_video_id
    )
  ORDER BY cvc.position ASC, cvc.published_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.child_get_cached_channel_videos(UUID, TEXT) TO anon, authenticated;

-- Local parent: list ALL cached videos (including hidden) for management UI
CREATE OR REPLACE FUNCTION public.local_parent_list_channel_videos(
  p_access_token UUID,
  p_pin TEXT,
  p_youtube_channel_id TEXT
)
RETURNS TABLE (
  youtube_video_id TEXT,
  title TEXT,
  thumbnail_url TEXT,
  published_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_device public.devices%ROWTYPE;
BEGIN
  SELECT * INTO v_device
  FROM public.devices d
  WHERE d.child_access_token = p_access_token
  LIMIT 1;

  IF v_device.id IS NULL THEN RAISE EXCEPTION 'INVALID_CHILD_TOKEN'; END IF;
  IF NOT public._local_parent_pin_ok(v_device.user_id, p_pin) THEN
    RAISE EXCEPTION 'INVALID_PARENT_PIN';
  END IF;

  RETURN QUERY
  SELECT
    cvc.youtube_video_id,
    cvc.title,
    cvc.thumbnail_url,
    cvc.published_at
  FROM public.device_whitelist dw
  JOIN public.whitelisted_channels wc ON wc.id = dw.channel_id
  JOIN public.channel_videos_cache cvc ON cvc.channel_id = wc.id
  WHERE dw.device_id = v_device.id
    AND btrim(wc.youtube_channel_id) = btrim(p_youtube_channel_id)
  ORDER BY cvc.position ASC, cvc.published_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.local_parent_list_channel_videos(UUID, TEXT, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.local_parent_hidden_videos_list(
  p_access_token UUID,
  p_pin TEXT
)
RETURNS TABLE (youtube_video_id TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_device public.devices%ROWTYPE;
BEGIN
  SELECT * INTO v_device
  FROM public.devices d
  WHERE d.child_access_token = p_access_token
  LIMIT 1;

  IF v_device.id IS NULL THEN RAISE EXCEPTION 'INVALID_CHILD_TOKEN'; END IF;
  IF NOT public._local_parent_pin_ok(v_device.user_id, p_pin) THEN
    RAISE EXCEPTION 'INVALID_PARENT_PIN';
  END IF;

  RETURN QUERY
  SELECT dhv.youtube_video_id
  FROM public.device_hidden_videos dhv
  WHERE dhv.device_id = v_device.id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.local_parent_hidden_videos_list(UUID, TEXT) TO anon, authenticated;
