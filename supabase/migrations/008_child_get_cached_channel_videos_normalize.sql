-- =============================================================================
-- Normalize youtube_channel_id comparison for child_get_cached_channel_videos
-- (leading/trailing whitespace should not break cache lookup)
-- =============================================================================

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
  JOIN public.device_whitelist dw
    ON dw.device_id = d.id
  JOIN public.whitelisted_channels wc
    ON wc.id = dw.channel_id
  JOIN public.channel_videos_cache cvc
    ON cvc.channel_id = wc.id
  WHERE d.child_access_token = p_access_token
    AND btrim(wc.youtube_channel_id) = btrim(p_youtube_channel_id)
  ORDER BY cvc.position ASC, cvc.published_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.child_get_cached_channel_videos(UUID, TEXT) TO anon, authenticated;
