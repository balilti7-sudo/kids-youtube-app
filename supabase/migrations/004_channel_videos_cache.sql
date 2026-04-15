-- =============================================================================
-- Channel videos cache for child playback (Supabase-first)
-- =============================================================================

ALTER TABLE public.whitelisted_channels
ADD COLUMN IF NOT EXISTS last_videos_refresh_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.channel_videos_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL REFERENCES public.whitelisted_channels (id) ON DELETE CASCADE,
  youtube_video_id TEXT NOT NULL,
  title TEXT NOT NULL,
  thumbnail_url TEXT,
  published_at TIMESTAMPTZ,
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (channel_id, youtube_video_id)
);

CREATE INDEX IF NOT EXISTS idx_channel_videos_cache_channel_id
  ON public.channel_videos_cache (channel_id);
CREATE INDEX IF NOT EXISTS idx_channel_videos_cache_published_at
  ON public.channel_videos_cache (published_at DESC);

DROP TRIGGER IF EXISTS channel_videos_cache_updated_at ON public.channel_videos_cache;
CREATE TRIGGER channel_videos_cache_updated_at
  BEFORE UPDATE ON public.channel_videos_cache
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.channel_videos_cache ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'channel_videos_cache'
      AND policyname = 'channel_videos_cache_select_authenticated'
  ) THEN
    CREATE POLICY channel_videos_cache_select_authenticated
      ON public.channel_videos_cache FOR SELECT
      TO authenticated
      USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'channel_videos_cache'
      AND policyname = 'channel_videos_cache_insert_authenticated'
  ) THEN
    CREATE POLICY channel_videos_cache_insert_authenticated
      ON public.channel_videos_cache FOR INSERT
      TO authenticated
      WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'channel_videos_cache'
      AND policyname = 'channel_videos_cache_update_authenticated'
  ) THEN
    CREATE POLICY channel_videos_cache_update_authenticated
      ON public.channel_videos_cache FOR UPDATE
      TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'channel_videos_cache'
      AND policyname = 'channel_videos_cache_delete_authenticated'
  ) THEN
    CREATE POLICY channel_videos_cache_delete_authenticated
      ON public.channel_videos_cache FOR DELETE
      TO authenticated
      USING (true);
  END IF;
END $$;

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
    AND wc.youtube_channel_id = p_youtube_channel_id
  ORDER BY cvc.position ASC, cvc.published_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.child_get_cached_channel_videos(UUID, TEXT) TO anon, authenticated;
