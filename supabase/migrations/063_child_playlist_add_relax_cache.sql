-- Align child/local-parent playlist adds with parent_add_video_to_playlist:
-- allow curated playlist entries without requiring channel_videos_cache hits.
-- ChannelManager "חיפוש סרטונים" is parent-gated; kid browse only surfaces
-- approved-channel videos already visible in the UI.

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
  v_next_order INT;
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
    NULLIF(btrim(COALESCE(p_youtube_channel_id, '')), ''),
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
