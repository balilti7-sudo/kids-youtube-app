-- =============================================================================
-- Named playlists per parent account (user_id). Videos in playlist_videos.
-- Kid device uses child_* RPCs (same lists, no PIN). Replaces flat device_playlist
-- for new clients; device_playlist_videos left in place for backward compatibility.
-- Note: column video_order (not "position" — reserved in PL/pgSQL RETURNS TABLE).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.playlists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT playlists_user_name_key UNIQUE (user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_playlists_user ON public.playlists (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.playlist_videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  playlist_id UUID NOT NULL REFERENCES public.playlists (id) ON DELETE CASCADE,
  youtube_video_id TEXT NOT NULL,
  title TEXT NOT NULL,
  thumbnail_url TEXT,
  youtube_channel_id TEXT,
  channel_name TEXT,
  video_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT playlist_videos_playlist_video_key UNIQUE (playlist_id, youtube_video_id)
);

CREATE INDEX IF NOT EXISTS idx_playlist_videos_playlist_order
  ON public.playlist_videos (playlist_id, video_order ASC, created_at ASC);

ALTER TABLE public.playlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.playlist_videos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS playlists_select_own ON public.playlists;
CREATE POLICY playlists_select_own ON public.playlists
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS playlists_insert_own ON public.playlists;
CREATE POLICY playlists_insert_own ON public.playlists
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS playlists_update_own ON public.playlists;
CREATE POLICY playlists_update_own ON public.playlists
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS playlists_delete_own ON public.playlists;
CREATE POLICY playlists_delete_own ON public.playlists
  FOR DELETE TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS playlist_videos_select_own ON public.playlist_videos;
CREATE POLICY playlist_videos_select_own ON public.playlist_videos
  FOR SELECT TO authenticated
  USING (
    playlist_id IN (SELECT p.id FROM public.playlists p WHERE p.user_id = auth.uid())
  );

DROP POLICY IF EXISTS playlist_videos_insert_own ON public.playlist_videos;
CREATE POLICY playlist_videos_insert_own ON public.playlist_videos
  FOR INSERT TO authenticated
  WITH CHECK (
    playlist_id IN (SELECT p.id FROM public.playlists p WHERE p.user_id = auth.uid())
  );

DROP POLICY IF EXISTS playlist_videos_delete_own ON public.playlist_videos;
CREATE POLICY playlist_videos_delete_own ON public.playlist_videos
  FOR DELETE TO authenticated
  USING (
    playlist_id IN (SELECT p.id FROM public.playlists p WHERE p.user_id = auth.uid())
  );

DROP TRIGGER IF EXISTS playlists_updated_at ON public.playlists;
CREATE TRIGGER playlists_updated_at
  BEFORE UPDATE ON public.playlists
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Resolve parent user_id from child access token (device owner)
CREATE OR REPLACE FUNCTION public.child_resolve_user_id(p_access_token UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT d.user_id
  FROM public.devices d
  WHERE d.child_access_token = p_access_token
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.child_resolve_user_id(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.child_resolve_user_id(UUID) TO anon, authenticated, service_role;

-- List playlists for device owner
CREATE OR REPLACE FUNCTION public.child_playlists_list(p_access_token UUID)
RETURNS TABLE (
  id UUID,
  name TEXT,
  video_count BIGINT,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  v_user_id := public.child_resolve_user_id(p_access_token);
  IF v_user_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.name,
    COUNT(pv.id)::BIGINT AS video_count,
    p.updated_at
  FROM public.playlists p
  LEFT JOIN public.playlist_videos pv ON pv.playlist_id = p.id
  WHERE p.user_id = v_user_id
  GROUP BY p.id, p.name, p.updated_at
  ORDER BY p.updated_at DESC, p.name ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.child_playlists_list(UUID) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.child_playlist_create(p_access_token UUID, p_name TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_name TEXT;
  v_id UUID;
BEGIN
  v_user_id := public.child_resolve_user_id(p_access_token);
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'INVALID_CHILD_TOKEN'; END IF;

  v_name := btrim(p_name);
  IF v_name = '' THEN RAISE EXCEPTION 'INVALID_PLAYLIST_NAME'; END IF;
  IF char_length(v_name) > 80 THEN RAISE EXCEPTION 'PLAYLIST_NAME_TOO_LONG'; END IF;

  INSERT INTO public.playlists (user_id, name)
  VALUES (v_user_id, v_name)
  ON CONFLICT (user_id, name) DO UPDATE SET updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.child_playlist_create(UUID, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.child_playlist_videos_list(
  p_access_token UUID,
  p_playlist_id UUID
)
RETURNS TABLE (
  youtube_video_id TEXT,
  title TEXT,
  thumbnail_url TEXT,
  youtube_channel_id TEXT,
  channel_name TEXT,
  video_order INT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  v_user_id := public.child_resolve_user_id(p_access_token);
  IF v_user_id IS NULL THEN RETURN; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.playlists p
    WHERE p.id = p_playlist_id AND p.user_id = v_user_id
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    pv.youtube_video_id,
    pv.title,
    pv.thumbnail_url,
    pv.youtube_channel_id,
    pv.channel_name,
    pv.video_order,
    pv.created_at
  FROM public.playlist_videos pv
  WHERE pv.playlist_id = p_playlist_id
  ORDER BY pv.video_order ASC, pv.created_at ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.child_playlist_videos_list(UUID, UUID) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.child_playlist_add_video(
  p_access_token UUID,
  p_playlist_id UUID,
  p_youtube_video_id TEXT,
  p_title TEXT,
  p_thumbnail_url TEXT DEFAULT NULL,
  p_youtube_channel_id TEXT DEFAULT NULL,
  p_channel_name TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_device_id UUID;
  v_video_id TEXT;
  v_next_order INT;
  v_allowed BOOLEAN;
BEGIN
  v_device_id := public.child_resolve_device_id(p_access_token);
  v_user_id := public.child_resolve_user_id(p_access_token);
  IF v_device_id IS NULL OR v_user_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_CHILD_TOKEN';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.playlists p
    WHERE p.id = p_playlist_id AND p.user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'PLAYLIST_NOT_FOUND';
  END IF;

  v_video_id := btrim(p_youtube_video_id);
  IF v_video_id = '' THEN RAISE EXCEPTION 'INVALID_VIDEO_ID'; END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.devices d
    JOIN public.device_whitelist dw ON dw.device_id = d.id
    JOIN public.whitelisted_channels wc ON wc.id = dw.channel_id
    JOIN public.channel_videos_cache cvc ON cvc.channel_id = wc.id
    WHERE d.id = v_device_id AND cvc.youtube_video_id = v_video_id
  ) INTO v_allowed;

  IF NOT v_allowed THEN RAISE EXCEPTION 'VIDEO_NOT_ON_APPROVED_CHANNEL'; END IF;

  SELECT COALESCE(MAX(pv.video_order), 0) + 1 INTO v_next_order
  FROM public.playlist_videos pv WHERE pv.playlist_id = p_playlist_id;

  INSERT INTO public.playlist_videos (
    playlist_id, youtube_video_id, title, thumbnail_url,
    youtube_channel_id, channel_name, video_order
  )
  VALUES (
    p_playlist_id, v_video_id,
    COALESCE(NULLIF(btrim(p_title), ''), v_video_id),
    NULLIF(btrim(p_thumbnail_url), ''),
    NULLIF(btrim(p_youtube_channel_id), ''),
    NULLIF(btrim(p_channel_name), ''),
    v_next_order
  )
  ON CONFLICT (playlist_id, youtube_video_id) DO UPDATE
  SET
    title = EXCLUDED.title,
    thumbnail_url = COALESCE(EXCLUDED.thumbnail_url, playlist_videos.thumbnail_url),
    youtube_channel_id = COALESCE(EXCLUDED.youtube_channel_id, playlist_videos.youtube_channel_id),
    channel_name = COALESCE(EXCLUDED.channel_name, playlist_videos.channel_name);

  UPDATE public.playlists SET updated_at = now() WHERE id = p_playlist_id;

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.child_playlist_add_video(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.child_playlist_remove_video(
  p_access_token UUID,
  p_playlist_id UUID,
  p_youtube_video_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_video_id TEXT;
BEGIN
  v_user_id := public.child_resolve_user_id(p_access_token);
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'INVALID_CHILD_TOKEN'; END IF;

  v_video_id := btrim(p_youtube_video_id);
  IF v_video_id = '' THEN RAISE EXCEPTION 'INVALID_VIDEO_ID'; END IF;

  DELETE FROM public.playlist_videos pv
  USING public.playlists p
  WHERE pv.playlist_id = p.id
    AND p.id = p_playlist_id
    AND p.user_id = v_user_id
    AND pv.youtube_video_id = v_video_id;

  IF FOUND THEN
    UPDATE public.playlists SET updated_at = now() WHERE id = p_playlist_id;
  END IF;

  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION public.child_playlist_remove_video(UUID, UUID, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.child_playlist_ids_for_video(
  p_access_token UUID,
  p_youtube_video_id TEXT
)
RETURNS TABLE (playlist_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_video_id TEXT;
BEGIN
  v_user_id := public.child_resolve_user_id(p_access_token);
  IF v_user_id IS NULL THEN RETURN; END IF;
  v_video_id := btrim(p_youtube_video_id);
  IF v_video_id = '' THEN RETURN; END IF;

  RETURN QUERY
  SELECT pv.playlist_id
  FROM public.playlist_videos pv
  JOIN public.playlists p ON p.id = pv.playlist_id
  WHERE p.user_id = v_user_id AND pv.youtube_video_id = v_video_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.child_playlist_ids_for_video(UUID, TEXT) TO anon, authenticated;
