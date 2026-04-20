-- Allow replacing channel video cache in chunks (large channels) without deleting on each chunk.
-- p_clear_existing: when true, delete existing rows for this channel before inserting this batch.

CREATE OR REPLACE FUNCTION public.local_parent_replace_channel_videos_cache(
  p_access_token uuid,
  p_pin text,
  p_channel_id uuid,
  p_videos jsonb,
  p_clear_existing boolean DEFAULT true
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
      position
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
      COALESCE((v_rec->>'position')::int, i)
    );
    i := i + 1;
  END LOOP;

  UPDATE public.whitelisted_channels
  SET last_videos_refresh_at = now()
  WHERE id = p_channel_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.local_parent_replace_channel_videos_cache(uuid, text, uuid, jsonb, boolean) TO anon, authenticated;
