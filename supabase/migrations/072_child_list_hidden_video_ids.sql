-- Child-facing red line: list hidden video IDs for the device bound to the access token.
-- Used when live YouTube uploads fallback bypasses channel_videos_cache filtering.

CREATE OR REPLACE FUNCTION public.child_list_hidden_video_ids(p_access_token UUID)
RETURNS TABLE (youtube_video_id TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT dhv.youtube_video_id
  FROM public.devices d
  JOIN public.device_hidden_videos dhv ON dhv.device_id = d.id
  WHERE d.child_access_token = p_access_token
    AND d.is_blocked = false;
$$;

GRANT EXECUTE ON FUNCTION public.child_list_hidden_video_ids(UUID) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
