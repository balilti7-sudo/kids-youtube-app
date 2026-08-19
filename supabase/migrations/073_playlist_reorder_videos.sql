-- Reorder playlist videos (parent auth + child device token).

CREATE OR REPLACE FUNCTION public.parent_reorder_playlist_videos(
  p_playlist_id UUID,
  p_ordered_video_ids TEXT[]
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_idx INT := 0;
  v_vid TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.playlists p
    WHERE p.id = p_playlist_id AND p.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'PLAYLIST_NOT_FOUND';
  END IF;

  IF p_ordered_video_ids IS NULL OR array_length(p_ordered_video_ids, 1) IS NULL THEN
    RETURN TRUE;
  END IF;

  FOREACH v_vid IN ARRAY p_ordered_video_ids LOOP
    v_idx := v_idx + 1;
    UPDATE public.playlist_videos pv
    SET video_order = v_idx
    WHERE pv.playlist_id = p_playlist_id
      AND pv.youtube_video_id = btrim(v_vid);
  END LOOP;

  UPDATE public.playlists SET updated_at = now() WHERE id = p_playlist_id;
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.parent_reorder_playlist_videos(UUID, TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.parent_reorder_playlist_videos(UUID, TEXT[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.child_playlist_reorder_videos(
  p_access_token UUID,
  p_playlist_id UUID,
  p_ordered_video_ids TEXT[]
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_idx INT := 0;
  v_vid TEXT;
BEGIN
  v_user_id := public.child_resolve_user_id(p_access_token);
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'INVALID_CHILD_TOKEN'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.playlists p
    WHERE p.id = p_playlist_id AND p.user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'PLAYLIST_NOT_FOUND';
  END IF;

  IF p_ordered_video_ids IS NULL OR array_length(p_ordered_video_ids, 1) IS NULL THEN
    RETURN TRUE;
  END IF;

  FOREACH v_vid IN ARRAY p_ordered_video_ids LOOP
    v_idx := v_idx + 1;
    UPDATE public.playlist_videos pv
    SET video_order = v_idx
    WHERE pv.playlist_id = p_playlist_id
      AND pv.youtube_video_id = btrim(v_vid);
  END LOOP;

  UPDATE public.playlists SET updated_at = now() WHERE id = p_playlist_id;
  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.child_playlist_reorder_videos(UUID, UUID, TEXT[]) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
