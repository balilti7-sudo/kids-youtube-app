-- =============================================================================
-- Kid device playlist / favorites (one list per paired child device)
-- Child adds only videos from approved channels (channel_videos_cache).
-- =============================================================================

CREATE TABLE public.device_playlist_videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES public.devices (id) ON DELETE CASCADE,
  youtube_video_id TEXT NOT NULL,
  title TEXT NOT NULL,
  thumbnail_url TEXT,
  youtube_channel_id TEXT,
  channel_name TEXT,
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT device_playlist_videos_device_video_key UNIQUE (device_id, youtube_video_id)
);

CREATE INDEX idx_device_playlist_videos_device_pos
  ON public.device_playlist_videos (device_id, position ASC, created_at ASC);

CREATE INDEX idx_device_playlist_videos_device
  ON public.device_playlist_videos (device_id);

ALTER TABLE public.device_playlist_videos ENABLE ROW LEVEL SECURITY;

-- Parents: read playlist for their devices (management / support)
CREATE POLICY device_playlist_select_own_devices
  ON public.device_playlist_videos
  FOR SELECT
  TO authenticated
  USING (
    device_id IN (SELECT d.id FROM public.devices d WHERE d.user_id = auth.uid())
  );

CREATE POLICY device_playlist_delete_own_devices
  ON public.device_playlist_videos
  FOR DELETE
  TO authenticated
  USING (
    device_id IN (SELECT d.id FROM public.devices d WHERE d.user_id = auth.uid())
  );

-- Resolve device from child token (shared helper pattern)
CREATE OR REPLACE FUNCTION public.child_resolve_device_id(p_access_token UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT d.id
  FROM public.devices d
  WHERE d.child_access_token = p_access_token
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.child_resolve_device_id(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.child_resolve_device_id(UUID) TO service_role;

-- List playlist for kid device
CREATE OR REPLACE FUNCTION public.child_playlist_list(p_access_token UUID)
RETURNS TABLE (
  youtube_video_id TEXT,
  title TEXT,
  thumbnail_url TEXT,
  youtube_channel_id TEXT,
  channel_name TEXT,
  position INT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_device_id UUID;
BEGIN
  v_device_id := public.child_resolve_device_id(p_access_token);
  IF v_device_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    dpv.youtube_video_id,
    dpv.title,
    dpv.thumbnail_url,
    dpv.youtube_channel_id,
    dpv.channel_name,
    dpv.position,
    dpv.created_at
  FROM public.device_playlist_videos dpv
  WHERE dpv.device_id = v_device_id
  ORDER BY dpv.position ASC, dpv.created_at ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.child_playlist_list(UUID) TO anon, authenticated;

-- Add video (must exist on an approved channel cache for this device)
CREATE OR REPLACE FUNCTION public.child_playlist_add(
  p_access_token UUID,
  p_youtube_video_id TEXT,
  p_title TEXT,
  p_thumbnail_url TEXT DEFAULT NULL,
  p_youtube_channel_id TEXT DEFAULT NULL,
  p_channel_name TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_device_id UUID;
  v_video_id TEXT;
  v_next_pos INT;
  v_allowed BOOLEAN;
BEGIN
  v_device_id := public.child_resolve_device_id(p_access_token);
  IF v_device_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_CHILD_TOKEN';
  END IF;

  v_video_id := btrim(p_youtube_video_id);
  IF v_video_id = '' THEN
    RAISE EXCEPTION 'INVALID_VIDEO_ID';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.devices d
    JOIN public.device_whitelist dw ON dw.device_id = d.id
    JOIN public.whitelisted_channels wc ON wc.id = dw.channel_id
    JOIN public.channel_videos_cache cvc ON cvc.channel_id = wc.id
    WHERE d.id = v_device_id
      AND cvc.youtube_video_id = v_video_id
  )
  INTO v_allowed;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'VIDEO_NOT_ON_APPROVED_CHANNEL';
  END IF;

  SELECT COALESCE(MAX(dpv.position), 0) + 1
  INTO v_next_pos
  FROM public.device_playlist_videos dpv
  WHERE dpv.device_id = v_device_id;

  INSERT INTO public.device_playlist_videos (
    device_id,
    youtube_video_id,
    title,
    thumbnail_url,
    youtube_channel_id,
    channel_name,
    position
  )
  VALUES (
    v_device_id,
    v_video_id,
    COALESCE(NULLIF(btrim(p_title), ''), v_video_id),
    NULLIF(btrim(p_thumbnail_url), ''),
    NULLIF(btrim(p_youtube_channel_id), ''),
    NULLIF(btrim(p_channel_name), ''),
    v_next_pos
  )
  ON CONFLICT (device_id, youtube_video_id) DO UPDATE
  SET
    title = EXCLUDED.title,
    thumbnail_url = COALESCE(EXCLUDED.thumbnail_url, device_playlist_videos.thumbnail_url),
    youtube_channel_id = COALESCE(EXCLUDED.youtube_channel_id, device_playlist_videos.youtube_channel_id),
    channel_name = COALESCE(EXCLUDED.channel_name, device_playlist_videos.channel_name);

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.child_playlist_add(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;

-- Remove video from playlist
CREATE OR REPLACE FUNCTION public.child_playlist_remove(
  p_access_token UUID,
  p_youtube_video_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_device_id UUID;
  v_video_id TEXT;
BEGIN
  v_device_id := public.child_resolve_device_id(p_access_token);
  IF v_device_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_CHILD_TOKEN';
  END IF;

  v_video_id := btrim(p_youtube_video_id);
  IF v_video_id = '' THEN
    RAISE EXCEPTION 'INVALID_VIDEO_ID';
  END IF;

  DELETE FROM public.device_playlist_videos dpv
  WHERE dpv.device_id = v_device_id
    AND dpv.youtube_video_id = v_video_id;

  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION public.child_playlist_remove(UUID, TEXT) TO anon, authenticated;
