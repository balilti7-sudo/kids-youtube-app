-- Direct-streaming transition: track which resolver produced playback_url.
-- 'direct' = yt-dlp googlevideo URL (current flow), 'bunny' = legacy Bunny HLS.

ALTER TABLE public.video_stream_prepare
  ADD COLUMN IF NOT EXISTS source TEXT;

-- Legacy rows (Bunny era) are stale for the direct flow — requeue them so the
-- worker resolves fresh direct URLs on next request.
UPDATE public.video_stream_prepare
SET source = 'bunny'
WHERE source IS NULL AND bunny_guid IS NOT NULL;
