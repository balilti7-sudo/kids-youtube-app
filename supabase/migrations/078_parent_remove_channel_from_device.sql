-- One-shot parent channel remove (mirrors parent_add_channel_to_device).
CREATE OR REPLACE FUNCTION public.parent_remove_channel_from_device(
  p_device_id uuid,
  p_channel_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_deleted int;
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

  DELETE FROM public.device_whitelist dw
  WHERE dw.device_id = p_device_id
    AND dw.channel_id = p_channel_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  IF v_deleted = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_linked');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.parent_remove_channel_from_device(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.parent_remove_channel_from_device(uuid, uuid) TO authenticated;
