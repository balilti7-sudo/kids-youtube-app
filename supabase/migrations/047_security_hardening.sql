-- Security hardening: pairing backdoor removal, video catalog validation, parent device RPC.

-- ---------------------------------------------------------------------------
-- 1) Remove emergency master pairing code (migration 019) — restore strict match only
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.child_pair_device(p_pairing_code TEXT)
RETURNS TABLE (
  device_id UUID,
  device_name TEXT,
  access_token UUID,
  is_blocked BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_device public.devices%ROWTYPE;
  v_trim TEXT;
BEGIN
  IF p_pairing_code IS NULL OR btrim(p_pairing_code) = '' THEN
    RETURN;
  END IF;

  v_trim := btrim(p_pairing_code);

  IF length(v_trim) > 32 OR length(v_trim) < 4 THEN
    RETURN;
  END IF;

  SELECT *
  INTO v_device
  FROM public.devices
  WHERE pairing_code = v_trim
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM public.pairing_code_consumed c WHERE c.code = v_trim) THEN
      RAISE EXCEPTION 'PAIRING_CODE_ALREADY_USED';
    END IF;
    RETURN;
  END IF;

  UPDATE public.devices
  SET
    pairing_code = NULL,
    is_online = TRUE,
    last_seen_at = now()
  WHERE id = v_device.id
  RETURNING id, name, child_access_token, is_blocked
  INTO device_id, device_name, access_token, is_blocked;

  INSERT INTO public.pairing_code_consumed (code, device_id)
  VALUES (v_trim, device_id)
  ON CONFLICT (code) DO NOTHING;

  RETURN NEXT;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2) Validate rows inserted into global video catalog (prevent junk / oversized payloads)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "whitelisted_videos_insert_authenticated" ON public.whitelisted_videos;

CREATE POLICY "whitelisted_videos_insert_validated"
  ON public.whitelisted_videos
  FOR INSERT
  TO authenticated
  WITH CHECK (
    youtube_video_id ~ '^[a-zA-Z0-9_-]{11}$'
    AND char_length(btrim(title)) BETWEEN 1 AND 500
    AND (
      thumbnail_url IS NULL
      OR (char_length(thumbnail_url) <= 2048 AND thumbnail_url ~ '^https?://')
    )
    AND (
      youtube_channel_id IS NULL
      OR (char_length(youtube_channel_id) <= 64 AND youtube_channel_id ~ '^[a-zA-Z0-9_-]+$')
    )
  );

-- ---------------------------------------------------------------------------
-- 3) Single RPC for parent video approve (ownership + validated catalog insert)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.parent_approve_video_for_device(
  p_device_id UUID,
  p_youtube_video_id TEXT,
  p_title TEXT,
  p_thumbnail_url TEXT DEFAULT NULL,
  p_youtube_channel_id TEXT DEFAULT NULL
)
RETURNS public.whitelisted_videos
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_video_id UUID;
  v_row public.whitelisted_videos%ROWTYPE;
  v_yt_id TEXT := btrim(COALESCE(p_youtube_video_id, ''));
  v_title TEXT := btrim(COALESCE(p_title, ''));
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.devices d
    WHERE d.id = p_device_id AND d.user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'DEVICE_NOT_FOUND';
  END IF;

  IF v_yt_id !~ '^[a-zA-Z0-9_-]{11}$' THEN
    RAISE EXCEPTION 'INVALID_VIDEO_ID';
  END IF;

  IF char_length(v_title) < 1 OR char_length(v_title) > 500 THEN
    RAISE EXCEPTION 'INVALID_TITLE';
  END IF;

  SELECT wv.id INTO v_video_id
  FROM public.whitelisted_videos wv
  WHERE wv.youtube_video_id = v_yt_id
  LIMIT 1;

  IF v_video_id IS NULL THEN
    INSERT INTO public.whitelisted_videos (
      youtube_video_id,
      title,
      thumbnail_url,
      youtube_channel_id
    )
    VALUES (
      v_yt_id,
      v_title,
      CASE
        WHEN p_thumbnail_url IS NULL OR btrim(p_thumbnail_url) = '' THEN NULL
        WHEN char_length(p_thumbnail_url) > 2048 OR btrim(p_thumbnail_url) !~ '^https?://' THEN NULL
        ELSE btrim(p_thumbnail_url)
      END,
      CASE
        WHEN p_youtube_channel_id IS NULL OR btrim(p_youtube_channel_id) = '' THEN NULL
        WHEN btrim(p_youtube_channel_id) !~ '^[a-zA-Z0-9_-]+$' OR char_length(p_youtube_channel_id) > 64 THEN NULL
        ELSE btrim(p_youtube_channel_id)
      END
    )
    RETURNING id INTO v_video_id;
  END IF;

  INSERT INTO public.device_video_whitelist (device_id, video_id, added_by)
  VALUES (p_device_id, v_video_id, v_uid)
  ON CONFLICT (device_id, video_id) DO NOTHING;

  SELECT * INTO v_row FROM public.whitelisted_videos WHERE id = v_video_id;
  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.parent_approve_video_for_device(UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4) Harden parent_update_device_settings (explicit COALESCE for allow_shorts)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.parent_update_device_settings(
  p_device_id UUID,
  p_allow_shorts BOOLEAN DEFAULT NULL,
  p_break_interval_minutes INT DEFAULT NULL,
  p_educational_intercept_enabled BOOLEAN DEFAULT NULL
)
RETURNS public.devices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.devices%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.devices d
    WHERE d.id = p_device_id AND d.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'DEVICE_NOT_FOUND';
  END IF;

  UPDATE public.devices d
  SET
    allow_shorts = CASE
      WHEN p_allow_shorts IS NULL THEN d.allow_shorts
      ELSE p_allow_shorts
    END,
    break_interval_minutes = CASE
      WHEN p_break_interval_minutes IS NULL THEN d.break_interval_minutes
      ELSE public._normalize_break_interval_minutes(p_break_interval_minutes)
    END,
    educational_intercept_enabled = CASE
      WHEN p_educational_intercept_enabled IS NULL THEN d.educational_intercept_enabled
      ELSE p_educational_intercept_enabled
    END
  WHERE d.id = p_device_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

NOTIFY pgrst, 'reload schema';
