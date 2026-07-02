-- Let the ingest worker publish its egress diagnostics (proxy IP, yt-dlp version)
-- so the web bridge /api/diagnostics can surface the WORKER's state — Render
-- background workers can't serve HTTP, so this table is the bridge between them.

CREATE TABLE IF NOT EXISTS public.worker_diagnostics (
  id TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.worker_diagnostics ENABLE ROW LEVEL SECURITY;
-- Writes use the service role (bypasses RLS); no anon policy needed.
