-- =============================================================================
-- Local parent management (kid device token + PIN) — bypasses email auth for
-- whitelist edits on the paired device only. SECURITY DEFINER RPCs validate
-- child_access_token and parent_settings.pin_hash (or default 1234 when unset).
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public._local_parent_pin_ok(p_user_id uuid, p_pin text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  h text;
BEGIN
  IF p_pin IS NULL OR length(trim(p_pin)) < 4 THEN
    RETURN false;
  END IF;
  SELECT ps.pin_hash INTO h
  FROM public.parent_settings ps
  WHERE ps.user_id = p_user_id
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF h IS NULL OR length(trim(h)) = 0 THEN
    RETURN trim(p_pin) = '1234';
  END IF;
  RETURN extensions.crypt(trim(p_pin), h) = h;
END;
$$;

CREATE OR REPLACE FUNCTION public.local_parent_bootstrap(
  p_access_token uuid,
  p_pin text
)
RETURNS TABLE (
  device_id uuid,
  owner_user_id uuid,
  device_name text
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
  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF NOT public._local_parent_pin_ok(v_device.user_id, p_pin) THEN
    RETURN;
  END IF;
  device_id := v_device.id;
  owner_user_id := v_device.user_id;
  device_name := v_device.name;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.local_parent_device_summary(p_access_token uuid)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  name text,
  device_type text,
  pairing_code text,
  is_online boolean,
  is_blocked boolean,
  last_seen_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  channel_count bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    d.id,
    d.user_id,
    d.name,
    d.device_type,
    d.pairing_code,
    d.is_online,
    d.is_blocked,
    d.last_seen_at,
    d.created_at,
    d.updated_at,
    (SELECT count(*)::bigint FROM public.device_whitelist dw WHERE dw.device_id = d.id
    ) AS channel_count
  FROM public.devices d
  WHERE d.child_access_token = p_access_token
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.local_parent_whitelist_for_device(p_access_token uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', wc.id,
        'youtube_channel_id', wc.youtube_channel_id,
        'channel_name', wc.channel_name,
        'category', wc.category,
        'channel_thumbnail', wc.channel_thumbnail,
        'subscriber_count', wc.subscriber_count,
        'description', wc.description,
        'last_videos_refresh_at', wc.last_videos_refresh_at,
        'created_at', wc.created_at
      ) ORDER BY dw.added_at DESC
    ),
    '[]'::jsonb
  )
  FROM public.devices d
  JOIN public.device_whitelist dw ON dw.device_id = d.id
  JOIN public.whitelisted_channels wc ON wc.id = dw.channel_id
  WHERE d.child_access_token = p_access_token;
$$;

CREATE OR REPLACE FUNCTION public.local_parent_add_channel(
  p_access_token uuid,
  p_pin text,
  p_youtube_channel_id text,
  p_channel_name text,
  p_channel_thumbnail text,
  p_subscriber_count text,
  p_description text,
  p_category text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_device public.devices%ROWTYPE;
  v_channel_id uuid;
  v_cat text := nullif(trim(p_category), '');
BEGIN
  SELECT * INTO v_device FROM public.devices WHERE child_access_token = p_access_token LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_token');
  END IF;
  IF NOT public._local_parent_pin_ok(v_device.user_id, p_pin) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_pin');
  END IF;

  INSERT INTO public.whitelisted_channels (
    youtube_channel_id,
    channel_name,
    channel_thumbnail,
    subscriber_count,
    description,
    category
  )
  VALUES (
    trim(p_youtube_channel_id),
    trim(p_channel_name),
    nullif(trim(p_channel_thumbnail), ''),
    nullif(trim(p_subscriber_count), ''),
    nullif(trim(p_description), ''),
    v_cat
  )
  ON CONFLICT (youtube_channel_id) DO UPDATE SET
    channel_name = EXCLUDED.channel_name,
    channel_thumbnail = COALESCE(EXCLUDED.channel_thumbnail, whitelisted_channels.channel_thumbnail),
    subscriber_count = COALESCE(EXCLUDED.subscriber_count, whitelisted_channels.subscriber_count),
    description = COALESCE(EXCLUDED.description, whitelisted_channels.description),
    category = COALESCE(EXCLUDED.category, whitelisted_channels.category)
  RETURNING id INTO v_channel_id;

  INSERT INTO public.device_whitelist (device_id, channel_id, added_by)
  VALUES (v_device.id, v_channel_id, v_device.user_id)
  ON CONFLICT (device_id, channel_id) DO NOTHING;

  RETURN jsonb_build_object('ok', true, 'channel_id', v_channel_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.local_parent_remove_channel(
  p_access_token uuid,
  p_pin text,
  p_channel_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_device public.devices%ROWTYPE;
  v_deleted int;
BEGIN
  SELECT * INTO v_device FROM public.devices WHERE child_access_token = p_access_token LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_token');
  END IF;
  IF NOT public._local_parent_pin_ok(v_device.user_id, p_pin) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_pin');
  END IF;

  DELETE FROM public.device_whitelist dw
  WHERE dw.device_id = v_device.id
    AND dw.channel_id = p_channel_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  IF v_deleted = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_linked');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.local_parent_replace_channel_videos_cache(
  p_access_token uuid,
  p_pin text,
  p_channel_id uuid,
  p_videos jsonb
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

  DELETE FROM public.channel_videos_cache WHERE channel_id = p_channel_id;

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

GRANT EXECUTE ON FUNCTION public.local_parent_bootstrap(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.local_parent_device_summary(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.local_parent_whitelist_for_device(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.local_parent_add_channel(uuid, text, text, text, text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.local_parent_remove_channel(uuid, text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.local_parent_replace_channel_videos_cache(uuid, text, uuid, jsonb) TO anon, authenticated;
