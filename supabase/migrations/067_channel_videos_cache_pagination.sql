-- Cursor fields for paginated channel video cache (lazy load older uploads).
ALTER TABLE public.whitelisted_channels
  ADD COLUMN IF NOT EXISTS videos_cache_next_page_token TEXT,
  ADD COLUMN IF NOT EXISTS videos_cache_uploads_playlist_id TEXT,
  ADD COLUMN IF NOT EXISTS videos_cache_has_more BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.whitelisted_channels.videos_cache_next_page_token IS
  'YouTube playlistItems nextPageToken for appending older uploads to channel_videos_cache';
COMMENT ON COLUMN public.whitelisted_channels.videos_cache_uploads_playlist_id IS
  'Cached uploads playlist id (UU…) to resume paging without re-resolving';
COMMENT ON COLUMN public.whitelisted_channels.videos_cache_has_more IS
  'True when more older uploads can be fetched via next page token';

-- Extend local-parent cache replace to persist cursor + upsert (append-safe).
DROP FUNCTION IF EXISTS public.local_parent_replace_channel_videos_cache(uuid, text, uuid, jsonb, boolean);

CREATE OR REPLACE FUNCTION public.local_parent_replace_channel_videos_cache(
  p_access_token uuid,
  p_pin text,
  p_channel_id uuid,
  p_videos jsonb,
  p_clear_existing boolean DEFAULT true,
  p_next_page_token text DEFAULT NULL,
  p_uploads_playlist_id text DEFAULT NULL,
  p_has_more boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_device public.devices%ROWTYPE;
  v_rec jsonb;
  i int := 0;
BEGIN
  SELECT * INTO v_device FROM public.devices WHERE child_access_token = p_access_token LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_token');
  END IF;
  IF NOT public._local_parent_pin_ok(v_device.user_id, p_pin) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_pin');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.device_whitelist dw
    WHERE dw.device_id = v_device.id AND dw.channel_id = p_channel_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'channel_not_on_device');
  END IF;

  IF p_clear_existing THEN
    DELETE FROM public.channel_videos_cache WHERE channel_id = p_channel_id;
  END IF;

  FOR v_rec IN SELECT value FROM jsonb_array_elements(COALESCE(p_videos, '[]'::jsonb)) AS t(value)
  LOOP
    INSERT INTO public.channel_videos_cache (
      channel_id,
      youtube_video_id,
      title,
      thumbnail_url,
      published_at,
      position,
      duration_seconds
    )
    VALUES (
      p_channel_id,
      trim(v_rec->>'youtube_video_id'),
      trim(v_rec->>'title'),
      nullif(v_rec->>'thumbnail_url', ''),
      CASE
        WHEN v_rec->>'published_at' IS NULL OR trim(v_rec->>'published_at') = '' THEN NULL
        ELSE trim(v_rec->>'published_at')::timestamptz
      END,
      COALESCE((v_rec->>'position')::int, i),
      CASE
        WHEN v_rec->>'duration_seconds' IS NULL OR trim(v_rec->>'duration_seconds') = '' THEN NULL
        ELSE (v_rec->>'duration_seconds')::int
      END
    )
    ON CONFLICT (channel_id, youtube_video_id) DO UPDATE SET
      title = EXCLUDED.title,
      thumbnail_url = COALESCE(EXCLUDED.thumbnail_url, channel_videos_cache.thumbnail_url),
      published_at = COALESCE(EXCLUDED.published_at, channel_videos_cache.published_at),
      position = EXCLUDED.position,
      duration_seconds = COALESCE(EXCLUDED.duration_seconds, channel_videos_cache.duration_seconds),
      updated_at = now();
    i := i + 1;
  END LOOP;

  UPDATE public.whitelisted_channels
  SET
    last_videos_refresh_at = now(),
    videos_cache_next_page_token = CASE
      WHEN p_has_more IS NULL AND p_next_page_token IS NULL AND p_uploads_playlist_id IS NULL
        THEN videos_cache_next_page_token
      ELSE NULLIF(trim(p_next_page_token), '')
    END,
    videos_cache_uploads_playlist_id = CASE
      WHEN p_has_more IS NULL AND p_next_page_token IS NULL AND p_uploads_playlist_id IS NULL
        THEN videos_cache_uploads_playlist_id
      ELSE NULLIF(trim(p_uploads_playlist_id), '')
    END,
    videos_cache_has_more = CASE
      WHEN p_has_more IS NULL THEN videos_cache_has_more
      ELSE p_has_more
    END
  WHERE id = p_channel_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.local_parent_replace_channel_videos_cache(uuid, text, uuid, jsonb, boolean, text, text, boolean) TO anon, authenticated;

-- Expose cache paging metadata to kid clients for lazy YouTube continuation.
DROP FUNCTION IF EXISTS public.child_get_allowed_channels(UUID);

CREATE OR REPLACE FUNCTION public.child_get_allowed_channels(p_access_token UUID)
RETURNS TABLE (
  channel_id UUID,
  youtube_channel_id TEXT,
  channel_name TEXT,
  category TEXT,
  channel_thumbnail TEXT,
  subscriber_count TEXT,
  videos_cache_has_more BOOLEAN,
  videos_cache_next_page_token TEXT,
  videos_cache_uploads_playlist_id TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_device_id UUID;
BEGIN
  SELECT d.id INTO v_device_id
  FROM public.devices d
  WHERE d.child_access_token = p_access_token
  LIMIT 1;

  IF v_device_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    wc.id,
    wc.youtube_channel_id,
    wc.channel_name,
    wc.category,
    wc.channel_thumbnail,
    wc.subscriber_count,
    COALESCE(wc.videos_cache_has_more, false),
    wc.videos_cache_next_page_token,
    wc.videos_cache_uploads_playlist_id
  FROM public.device_whitelist dw
  JOIN public.whitelisted_channels wc ON wc.id = dw.channel_id
  WHERE dw.device_id = v_device_id
  ORDER BY dw.added_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.child_get_allowed_channels(UUID) TO anon, authenticated;
