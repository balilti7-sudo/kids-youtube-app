-- Restore whitelist red-line for child playlist adds.
-- A video may be added only if:
--   1) its channel is on device_whitelist, OR
--   2) it is explicitly on device_video_whitelist, OR
--   3) it already appears in channel_videos_cache for a whitelisted channel.
-- Parent ChannelManager search can still add videos when the channel is approved.

CREATE OR REPLACE FUNCTION public.child_playlist_add_video(
  p_access_token UUID,
  p_playlist_id UUID,
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
  v_user_id UUID;
  v_device_id UUID;
  v_video_id TEXT;
  v_channel_yt TEXT;
  v_next_order INT;
  v_allowed BOOLEAN := false;
BEGIN
  v_device_id := public.child_resolve_device_id(p_access_token);
  v_user_id := public.child_resolve_user_id(p_access_token);
  IF v_device_id IS NULL OR v_user_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_CHILD_TOKEN';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.playlists p
    WHERE p.id = p_playlist_id AND p.user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'PLAYLIST_NOT_FOUND';
  END IF;

  v_video_id := btrim(p_youtube_video_id);
  IF v_video_id = '' THEN RAISE EXCEPTION 'INVALID_VIDEO_ID'; END IF;
  v_channel_yt := NULLIF(btrim(COALESCE(p_youtube_channel_id, '')), '');

  -- Hidden videos are never addable.
  IF EXISTS (
    SELECT 1 FROM public.device_hidden_videos h
    WHERE h.device_id = v_device_id AND h.youtube_video_id = v_video_id
  ) THEN
    RAISE EXCEPTION 'VIDEO_HIDDEN';
  END IF;

  -- Explicit per-video whitelist.
  IF EXISTS (
    SELECT 1
    FROM public.device_video_whitelist dvw
    JOIN public.whitelisted_videos wv ON wv.id = dvw.video_id
    WHERE dvw.device_id = v_device_id AND wv.youtube_video_id = v_video_id
  ) THEN
    v_allowed := true;
  END IF;

  -- Channel on device whitelist.
  IF NOT v_allowed AND v_channel_yt IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM public.device_whitelist dw
      JOIN public.whitelisted_channels wc ON wc.id = dw.channel_id
      WHERE dw.device_id = v_device_id AND wc.youtube_channel_id = v_channel_yt
    ) THEN
      v_allowed := true;
    END IF;
  END IF;

  -- Cached under any whitelisted channel for this device.
  IF NOT v_allowed THEN
    IF EXISTS (
      SELECT 1
      FROM public.channel_videos_cache c
      JOIN public.whitelisted_channels wc ON wc.youtube_channel_id = c.youtube_channel_id
      JOIN public.device_whitelist dw ON dw.channel_id = wc.id
      WHERE dw.device_id = v_device_id AND c.youtube_video_id = v_video_id
    ) THEN
      v_allowed := true;
    END IF;
  END IF;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'VIDEO_NOT_APPROVED';
  END IF;

  SELECT COALESCE(MAX(pv.video_order), 0) + 1 INTO v_next_order
  FROM public.playlist_videos pv WHERE pv.playlist_id = p_playlist_id;

  INSERT INTO public.playlist_videos (
    playlist_id, youtube_video_id, title, thumbnail_url,
    youtube_channel_id, channel_name, video_order
  )
  VALUES (
    p_playlist_id, v_video_id,
    COALESCE(NULLIF(btrim(p_title), ''), v_video_id),
    NULLIF(btrim(p_thumbnail_url), ''),
    v_channel_yt,
    NULLIF(btrim(COALESCE(p_channel_name, '')), ''),
    v_next_order
  )
  ON CONFLICT (playlist_id, youtube_video_id) DO UPDATE
  SET
    title = EXCLUDED.title,
    thumbnail_url = COALESCE(EXCLUDED.thumbnail_url, playlist_videos.thumbnail_url),
    youtube_channel_id = COALESCE(EXCLUDED.youtube_channel_id, playlist_videos.youtube_channel_id),
    channel_name = COALESCE(EXCLUDED.channel_name, playlist_videos.channel_name);

  UPDATE public.playlists SET updated_at = now() WHERE id = p_playlist_id;

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.child_playlist_add_video(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
