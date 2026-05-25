-- Recreate the RPCs used by the frontend restricted-parent flows.
--
-- Some production databases had stale function bodies that validated parent PINs
-- from the child profile/device row. The app schema stores the PIN on
-- `profiles.parent_pin`; these definitions route every PIN check through
-- `_auth_parent_pin_matches` / `_local_parent_pin_ok`, both fixed in 036.

DROP FUNCTION IF EXISTS public.local_parent_bootstrap(uuid, text);

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
  FROM public.devices
  WHERE child_access_token = p_access_token
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

GRANT EXECUTE ON FUNCTION public.local_parent_bootstrap(uuid, text) TO anon, authenticated;

DROP FUNCTION IF EXISTS public.parent_hidden_videos_list_details(uuid, text);

CREATE OR REPLACE FUNCTION public.parent_hidden_videos_list_details(
  p_device_id uuid,
  p_pin text
)
RETURNS TABLE (
  youtube_video_id text,
  title text,
  thumbnail_url text,
  youtube_channel_id text,
  channel_name text,
  hidden_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  IF NOT public._auth_parent_pin_matches(p_pin) THEN
    RAISE EXCEPTION 'INVALID_PARENT_PIN';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.devices
    WHERE id = p_device_id
      AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'DEVICE_NOT_FOUND';
  END IF;

  RETURN QUERY
  SELECT * FROM public._device_hidden_videos_rows(p_device_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.parent_hidden_videos_list_details(uuid, text) TO authenticated;

DROP FUNCTION IF EXISTS public.local_parent_hidden_videos_list_details(uuid, text);

CREATE OR REPLACE FUNCTION public.local_parent_hidden_videos_list_details(
  p_access_token uuid,
  p_pin text
)
RETURNS TABLE (
  youtube_video_id text,
  title text,
  thumbnail_url text,
  youtube_channel_id text,
  channel_name text,
  hidden_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_device public.devices%ROWTYPE;
BEGIN
  SELECT * INTO v_device
  FROM public.devices
  WHERE child_access_token = p_access_token
  LIMIT 1;

  IF v_device.id IS NULL THEN
    RAISE EXCEPTION 'INVALID_CHILD_TOKEN';
  END IF;

  IF NOT public._local_parent_pin_ok(v_device.user_id, p_pin) THEN
    RAISE EXCEPTION 'INVALID_PARENT_PIN';
  END IF;

  RETURN QUERY
  SELECT * FROM public._device_hidden_videos_rows(v_device.id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.local_parent_hidden_videos_list_details(uuid, text) TO anon, authenticated;

DROP FUNCTION IF EXISTS public.local_parent_hidden_videos_list(uuid, text);

CREATE OR REPLACE FUNCTION public.local_parent_hidden_videos_list(
  p_access_token uuid,
  p_pin text
)
RETURNS TABLE (youtube_video_id text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_device public.devices%ROWTYPE;
BEGIN
  SELECT * INTO v_device
  FROM public.devices
  WHERE child_access_token = p_access_token
  LIMIT 1;

  IF v_device.id IS NULL THEN
    RAISE EXCEPTION 'INVALID_CHILD_TOKEN';
  END IF;

  IF NOT public._local_parent_pin_ok(v_device.user_id, p_pin) THEN
    RAISE EXCEPTION 'INVALID_PARENT_PIN';
  END IF;

  RETURN QUERY
  SELECT dhv.youtube_video_id
  FROM public.device_hidden_videos dhv
  WHERE dhv.device_id = v_device.id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.local_parent_hidden_videos_list(uuid, text) TO anon, authenticated;

DROP FUNCTION IF EXISTS public.parent_clear_all_hidden_videos(uuid, text);

CREATE OR REPLACE FUNCTION public.parent_clear_all_hidden_videos(
  p_device_id uuid,
  p_pin text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  IF NOT public._auth_parent_pin_matches(p_pin) THEN
    RAISE EXCEPTION 'INVALID_PARENT_PIN';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.devices
    WHERE id = p_device_id
      AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'DEVICE_NOT_FOUND';
  END IF;

  DELETE FROM public.device_hidden_videos
  WHERE device_id = p_device_id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.parent_clear_all_hidden_videos(uuid, text) TO authenticated;

DROP FUNCTION IF EXISTS public.local_parent_clear_all_hidden_videos(uuid, text);

CREATE OR REPLACE FUNCTION public.local_parent_clear_all_hidden_videos(
  p_access_token uuid,
  p_pin text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_device public.devices%ROWTYPE;
  v_deleted integer;
BEGIN
  SELECT * INTO v_device
  FROM public.devices
  WHERE child_access_token = p_access_token
  LIMIT 1;

  IF v_device.id IS NULL THEN
    RAISE EXCEPTION 'INVALID_CHILD_TOKEN';
  END IF;

  IF NOT public._local_parent_pin_ok(v_device.user_id, p_pin) THEN
    RAISE EXCEPTION 'INVALID_PARENT_PIN';
  END IF;

  DELETE FROM public.device_hidden_videos
  WHERE device_id = v_device.id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.local_parent_clear_all_hidden_videos(uuid, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
