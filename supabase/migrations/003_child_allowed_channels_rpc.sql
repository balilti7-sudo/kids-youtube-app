-- =============================================================================
-- Child mode: fetch allowed channels per paired device
-- =============================================================================

ALTER TABLE public.devices
ADD COLUMN IF NOT EXISTS child_access_token UUID DEFAULT gen_random_uuid();

UPDATE public.devices
SET child_access_token = gen_random_uuid()
WHERE child_access_token IS NULL;

ALTER TABLE public.devices
ALTER COLUMN child_access_token SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'devices_child_access_token_key'
  ) THEN
    ALTER TABLE public.devices
    ADD CONSTRAINT devices_child_access_token_key UNIQUE (child_access_token);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.child_get_allowed_channels(p_access_token UUID)
RETURNS TABLE (
  channel_id UUID,
  youtube_channel_id TEXT,
  channel_name TEXT,
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
