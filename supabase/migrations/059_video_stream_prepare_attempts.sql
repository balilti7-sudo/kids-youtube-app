-- Track ingest attempts so the worker can requeue suspected session blocks
-- (yt-dlp "Error code: 152") up to N times before marking the video failed.

ALTER TABLE public.video_stream_prepare
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0;
