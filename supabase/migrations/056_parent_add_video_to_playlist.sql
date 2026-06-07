-- Parent: securely add a video to an owned playlist (playlist_videos).
-- Validates auth + playlist ownership; idempotent on (playlist_id, youtube_video_id).

CREATE OR REPLACE FUNCTION public.parent_add_video_to_playlist(
  p_playlist_id UUID,
  p_youtube_video_id TEXT,
  p_title TEXT,
  p_thumbnail_url TEXT DEFAULT NULL,
  p_youtube_channel_id TEXT DEFAULT NULL,
  p_channel_name TEXT DEFAULT NULL
)
RETURNS public.playlist_videos
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_video_id TEXT;
  v_next_order INT;
  v_row public.playlist_videos%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.playlists p
    WHERE p.id = p_playlist_id AND p.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'PLAYLIST_NOT_FOUND';
  END IF;

  v_video_id := btrim(p_youtube_video_id);
  IF v_video_id = '' THEN
    RAISE EXCEPTION 'INVALID_VIDEO_ID';
  END IF;

  SELECT COALESCE(MAX(pv.video_order), 0) + 1 INTO v_next_order
  FROM public.playlist_videos pv
  WHERE pv.playlist_id = p_playlist_id;

  INSERT INTO public.playlist_videos (
    playlist_id,
    youtube_video_id,
    title,
    thumbnail_url,
    youtube_channel_id,
    channel_name,
    video_order
  )
  VALUES (
    p_playlist_id,
    v_video_id,
    COALESCE(NULLIF(btrim(p_title), ''), v_video_id),
    NULLIF(btrim(p_thumbnail_url), ''),
    NULLIF(btrim(p_youtube_channel_id), ''),
    NULLIF(btrim(p_channel_name), ''),
    v_next_order
  )
  ON CONFLICT (playlist_id, youtube_video_id) DO UPDATE
  SET
    title = EXCLUDED.title,
    thumbnail_url = COALESCE(EXCLUDED.thumbnail_url, playlist_videos.thumbnail_url),
    youtube_channel_id = COALESCE(EXCLUDED.youtube_channel_id, playlist_videos.youtube_channel_id),
    channel_name = COALESCE(EXCLUDED.channel_name, playlist_videos.channel_name)
  RETURNING * INTO v_row;

  UPDATE public.playlists SET updated_at = now() WHERE id = p_playlist_id;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.parent_add_video_to_playlist(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.parent_add_video_to_playlist(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
