-- Bulk unblock: clear all hidden videos for a device (parent PIN required).

CREATE OR REPLACE FUNCTION public.parent_clear_all_hidden_videos(
  p_device_id UUID,
  p_pin TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted INTEGER;
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

  DELETE FROM public.device_hidden_videos dhv
  WHERE dhv.device_id = p_device_id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.parent_clear_all_hidden_videos(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.local_parent_clear_all_hidden_videos(
  p_access_token UUID,
  p_pin TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_device public.devices%ROWTYPE;
  v_deleted INTEGER;
BEGIN
  SELECT * INTO v_device
  FROM public.devices d
  WHERE d.child_access_token = p_access_token
  LIMIT 1;

  IF v_device.id IS NULL THEN RAISE EXCEPTION 'INVALID_CHILD_TOKEN'; END IF;
  IF NOT public._local_parent_pin_ok(v_device.user_id, p_pin) THEN
    RAISE EXCEPTION 'INVALID_PARENT_PIN';
  END IF;

  DELETE FROM public.device_hidden_videos dhv
  WHERE dhv.device_id = v_device.id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.local_parent_clear_all_hidden_videos(UUID, TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
