-- One-shot parent channel add (replaces 3 client round-trips + verify_parent_pin on mutations).
CREATE OR REPLACE FUNCTION public.parent_add_channel_to_device(
  p_device_id uuid,
  p_youtube_channel_id text,
  p_channel_name text,
  p_channel_thumbnail text DEFAULT NULL,
  p_subscriber_count text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_category text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_channel_id uuid;
  v_cat text := nullif(trim(p_category), '');
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.devices d
    WHERE d.id = p_device_id AND d.user_id = v_uid
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'device_not_found');
  END IF;

  IF length(trim(COALESCE(p_youtube_channel_id, ''))) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_channel_id');
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
    nullif(trim(COALESCE(p_channel_thumbnail, '')), ''),
    nullif(trim(COALESCE(p_subscriber_count, '')), ''),
    nullif(trim(COALESCE(p_description, '')), ''),
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
  VALUES (p_device_id, v_channel_id, v_uid)
  ON CONFLICT (device_id, channel_id) DO NOTHING;

  RETURN jsonb_build_object('ok', true, 'channel_id', v_channel_id);
END;
$$;

REVOKE ALL ON FUNCTION public.parent_add_channel_to_device(uuid, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.parent_add_channel_to_device(uuid, text, text, text, text, text, text) TO authenticated;
