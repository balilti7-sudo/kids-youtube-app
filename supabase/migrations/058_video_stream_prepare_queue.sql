-- Phase 1: queue-based ingest (API enqueues, worker processes).

ALTER TABLE public.video_stream_prepare
  DROP CONSTRAINT IF EXISTS video_stream_prepare_status_check;

ALTER TABLE public.video_stream_prepare
  ADD CONSTRAINT video_stream_prepare_status_check
  CHECK (status IN ('queued', 'processing', 'ready', 'failed'));

ALTER TABLE public.video_stream_prepare
  ADD COLUMN IF NOT EXISTS playback_url TEXT,
  ADD COLUMN IF NOT EXISTS bunny_guid TEXT,
  ADD COLUMN IF NOT EXISTS locked_by TEXT,
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_video_stream_prepare_queued_updated
  ON public.video_stream_prepare (updated_at ASC)
  WHERE status = 'queued';
