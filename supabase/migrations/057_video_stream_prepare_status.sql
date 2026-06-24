-- Track Media Bridge yt-dlp → Bunny prepare status (server writes via service role).

CREATE TABLE IF NOT EXISTS public.video_stream_prepare (
  youtube_video_id TEXT NOT NULL,
  quality TEXT NOT NULL DEFAULT '360p',
  status TEXT NOT NULL CHECK (status IN ('processing', 'ready', 'failed')),
  error_code TEXT,
  error_detail TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (youtube_video_id, quality)
);

CREATE INDEX IF NOT EXISTS idx_video_stream_prepare_status_updated
  ON public.video_stream_prepare (status, updated_at DESC);

ALTER TABLE public.video_stream_prepare ENABLE ROW LEVEL SECURITY;

-- Read-only for authenticated clients (optional UI polling); writes use service role.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'video_stream_prepare'
      AND policyname = 'video_stream_prepare_select_authenticated'
  ) THEN
    CREATE POLICY video_stream_prepare_select_authenticated
      ON public.video_stream_prepare FOR SELECT
      TO authenticated
      USING (true);
  END IF;
END $$;
