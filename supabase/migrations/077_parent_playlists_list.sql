-- Fast parent playlist list (one query — avoids slow PostgREST nested count).
CREATE OR REPLACE FUNCTION public.parent_playlists_list()
RETURNS TABLE (
  id UUID,
  name TEXT,
  video_count BIGINT,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.name,
    COUNT(pv.id)::BIGINT AS video_count,
    p.updated_at
  FROM public.playlists p
  LEFT JOIN public.playlist_videos pv ON pv.playlist_id = p.id
  WHERE p.user_id = auth.uid()
  GROUP BY p.id, p.name, p.updated_at
  ORDER BY p.updated_at DESC, p.name ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.parent_playlists_list() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.parent_playlists_list() TO authenticated;
