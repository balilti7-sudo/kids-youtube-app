-- Hidden videos: store metadata, PIN-protected hide/unhide for authenticated parents.

ALTER TABLE public.device_hidden_videos
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS thumbnail_url TEXT,
  ADD COLUMN IF NOT EXISTS channel_name TEXT;

CREATE OR REPLACE FUNCTION public._auth_parent_pin_matches(p_pin TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID;
  v_stored TEXT;
  v_clean TEXT;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RETURN FALSE; END IF;

  v_clean := regexp_replace(COALESCE(btrim(p_pin), ''), '\D', '', 'g');
  IF length(v_clean) < 4 OR length(v_clean) > 6 THEN RETURN FALSE; END IF;

  SELECT public._profile_resolved_parent_pin(p.parent_pin) INTO v_stored
  FROM public.profiles p WHERE p.id = v_uid;

  IF length(COALESCE(v_stored, '')) < 4 THEN RETURN FALSE; END IF;
  RETURN v_clean = v_stored;
END;
$$;

REVOKE ALL ON FUNCTION public._auth_parent_pin_matches(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._auth_parent_pin_matches(TEXT) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.parent_set_video_hidden(
  p_device_id UUID,
  p_pin TEXT,
  p_youtube_video_id TEXT,
  p_hidden BOOLEAN DEFAULT TRUE,
  p_title TEXT DEFAULT NULL,
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
  v_video_id TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT public._auth_parent_pin_matches(p_pin) THEN
    RAISE EXCEPTION 'INVALID_PARENT_PIN';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.devices d
    WHERE d.id = p_device_id AND d.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'DEVICE_NOT_FOUND';
  END IF;

  v_video_id := btrim(p_youtube_video_id);
  IF v_video_id = '' THEN RAISE EXCEPTION 'INVALID_VIDEO_ID'; END IF;

  IF COALESCE(p_hidden, TRUE) THEN
    INSERT INTO public.device_hidden_videos (
      device_id, youtube_video_id, youtube_channel_id,
      title, thumbnail_url, channel_name
    )
    VALUES (
      p_device_id, v_video_id,
      NULLIF(btrim(p_youtube_channel_id), ''),
      NULLIF(btrim(p_title), ''),
      NULLIF(btrim(p_thumbnail_url), ''),
      NULLIF(btrim(p_channel_name), '')
    )
    ON CONFLICT (device_id, youtube_video_id) DO UPDATE SET
      youtube_channel_id = COALESCE(EXCLUDED.youtube_channel_id, device_hidden_videos.youtube_channel_id),
      title = COALESCE(EXCLUDED.title, device_hidden_videos.title),
      thumbnail_url = COALESCE(EXCLUDED.thumbnail_url, device_hidden_videos.thumbnail_url),
      channel_name = COALESCE(EXCLUDED.channel_name, device_hidden_videos.channel_name);
    RETURN TRUE;
  END IF;

  DELETE FROM public.device_hidden_videos dhv
  WHERE dhv.device_id = p_device_id AND dhv.youtube_video_id = v_video_id;

  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION public.parent_set_video_hidden(UUID, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.local_parent_set_video_hidden(
  p_access_token UUID,
  p_pin TEXT,
  p_youtube_video_id TEXT,
  p_hidden BOOLEAN DEFAULT TRUE,
  p_youtube_channel_id TEXT DEFAULT NULL,
  p_title TEXT DEFAULT NULL,
  p_thumbnail_url TEXT DEFAULT NULL,
  p_channel_name TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_device public.devices%ROWTYPE;
  v_video_id TEXT;
BEGIN
  SELECT * INTO v_device
  FROM public.devices d
  WHERE d.child_access_token = p_access_token
  LIMIT 1;

  IF v_device.id IS NULL THEN RAISE EXCEPTION 'INVALID_CHILD_TOKEN'; END IF;
  IF NOT public._local_parent_pin_ok(v_device.user_id, p_pin) THEN
    RAISE EXCEPTION 'INVALID_PARENT_PIN';
  END IF;

  v_video_id := btrim(p_youtube_video_id);
  IF v_video_id = '' THEN RAISE EXCEPTION 'INVALID_VIDEO_ID'; END IF;

  IF COALESCE(p_hidden, TRUE) THEN
    INSERT INTO public.device_hidden_videos (
      device_id, youtube_video_id, youtube_channel_id,
      title, thumbnail_url, channel_name
    )
    VALUES (
      v_device.id, v_video_id,
      NULLIF(btrim(p_youtube_channel_id), ''),
      NULLIF(btrim(p_title), ''),
      NULLIF(btrim(p_thumbnail_url), ''),
      NULLIF(btrim(p_channel_name), '')
    )
    ON CONFLICT (device_id, youtube_video_id) DO UPDATE SET
      youtube_channel_id = COALESCE(EXCLUDED.youtube_channel_id, device_hidden_videos.youtube_channel_id),
      title = COALESCE(EXCLUDED.title, device_hidden_videos.title),
      thumbnail_url = COALESCE(EXCLUDED.thumbnail_url, device_hidden_videos.thumbnail_url),
      channel_name = COALESCE(EXCLUDED.channel_name, device_hidden_videos.channel_name);
    RETURN TRUE;
  END IF;

  DELETE FROM public.device_hidden_videos dhv
  WHERE dhv.device_id = v_device.id AND dhv.youtube_video_id = v_video_id;

  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION public.local_parent_set_video_hidden(UUID, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public._device_hidden_videos_rows(p_device_id UUID)
RETURNS TABLE (
  youtube_video_id TEXT,
  title TEXT,
  thumbnail_url TEXT,
  youtube_channel_id TEXT,
  channel_name TEXT,
  hidden_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    dhv.youtube_video_id,
    COALESCE(
      NULLIF(btrim(dhv.title), ''),
      (
        SELECT cvc.title
        FROM public.channel_videos_cache cvc
        JOIN public.device_whitelist dw ON dw.channel_id = cvc.channel_id
        WHERE dw.device_id = dhv.device_id
          AND cvc.youtube_video_id = dhv.youtube_video_id
        LIMIT 1
      ),
      dhv.youtube_video_id
    ) AS title,
    COALESCE(
      dhv.thumbnail_url,
      (
        SELECT cvc.thumbnail_url
        FROM public.channel_videos_cache cvc
        JOIN public.device_whitelist dw ON dw.channel_id = cvc.channel_id
        WHERE dw.device_id = dhv.device_id
          AND cvc.youtube_video_id = dhv.youtube_video_id
        LIMIT 1
      )
    ) AS thumbnail_url,
    COALESCE(
      NULLIF(btrim(dhv.youtube_channel_id), ''),
      (
        SELECT wc.youtube_channel_id
        FROM public.channel_videos_cache cvc
        JOIN public.device_whitelist dw ON dw.channel_id = cvc.channel_id
        JOIN public.whitelisted_channels wc ON wc.id = dw.channel_id
        WHERE dw.device_id = dhv.device_id
          AND cvc.youtube_video_id = dhv.youtube_video_id
        LIMIT 1
      )
    ) AS youtube_channel_id,
    COALESCE(
      NULLIF(btrim(dhv.channel_name), ''),
      (
        SELECT wc.channel_name
        FROM public.channel_videos_cache cvc
        JOIN public.device_whitelist dw ON dw.channel_id = cvc.channel_id
        JOIN public.whitelisted_channels wc ON wc.id = dw.channel_id
        WHERE dw.device_id = dhv.device_id
          AND cvc.youtube_video_id = dhv.youtube_video_id
        LIMIT 1
      )
    ) AS channel_name,
    dhv.created_at AS hidden_at
  FROM public.device_hidden_videos dhv
  WHERE dhv.device_id = p_device_id
  ORDER BY dhv.created_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.device_hidden_videos_list_details(p_device_id UUID)
RETURNS TABLE (
  youtube_video_id TEXT,
  title TEXT,
  thumbnail_url TEXT,
  youtube_channel_id TEXT,
  channel_name TEXT,
  hidden_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.*
  FROM public._device_hidden_videos_rows(p_device_id) r
  JOIN public.devices d ON d.id = p_device_id
  WHERE d.user_id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.device_hidden_videos_list_details(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.local_parent_hidden_videos_list_details(
  p_access_token UUID,
  p_pin TEXT
)
RETURNS TABLE (
  youtube_video_id TEXT,
  title TEXT,
  thumbnail_url TEXT,
  youtube_channel_id TEXT,
  channel_name TEXT,
  hidden_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_device public.devices%ROWTYPE;
BEGIN
  SELECT * INTO v_device
  FROM public.devices d
  WHERE d.child_access_token = p_access_token
  LIMIT 1;

  IF v_device.id IS NULL THEN RAISE EXCEPTION 'INVALID_CHILD_TOKEN'; END IF;
  IF NOT public._local_parent_pin_ok(v_device.user_id, p_pin) THEN
    RAISE EXCEPTION 'INVALID_PARENT_PIN';
  END IF;

  RETURN QUERY
  SELECT * FROM public._device_hidden_videos_rows(v_device.id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.local_parent_hidden_videos_list_details(UUID, TEXT) TO anon, authenticated;
