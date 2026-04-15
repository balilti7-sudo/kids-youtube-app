-- =============================================================================
-- Channel categories + child allowed channels RPC update
-- =============================================================================

ALTER TABLE public.whitelisted_channels
ADD COLUMN IF NOT EXISTS category TEXT;

CREATE OR REPLACE FUNCTION public.child_get_allowed_channels(p_access_token UUID)
RETURNS TABLE (
  channel_id UUID,
  youtube_channel_id TEXT,
  channel_name TEXT,
  category TEXT,
  channel_thumbnail TEXT,
  subscriber_count TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    wc.id AS channel_id,
    wc.youtube_channel_id,
    wc.channel_name,
    wc.category,
    wc.channel_thumbnail,
    wc.subscriber_count
  FROM public.devices d
  JOIN public.device_whitelist dw
    ON dw.device_id = d.id
  JOIN public.whitelisted_channels wc
    ON wc.id = dw.channel_id
  WHERE d.child_access_token = p_access_token
  ORDER BY dw.added_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.child_get_allowed_channels(UUID) TO anon, authenticated;
