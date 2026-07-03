-- Rotating pool of YouTube cookies for yt-dlp. The ingest worker claims an
-- 'active' cookie per job and marks it 'burned' when it triggers Error code 152.

CREATE TABLE IF NOT EXISTS public.youtube_cookies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label TEXT,
  cookie_content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'burned')),
  burned_at TIMESTAMPTZ,
  burn_reason TEXT,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Oldest-used active cookie first (round-robin-ish); nulls (never used) first.
CREATE INDEX IF NOT EXISTS idx_youtube_cookies_active_lru
  ON public.youtube_cookies (last_used_at ASC NULLS FIRST)
  WHERE status = 'active';

ALTER TABLE public.youtube_cookies ENABLE ROW LEVEL SECURITY;
-- Writes/reads use the service role (bypasses RLS); no anon policy — cookies are secret.
