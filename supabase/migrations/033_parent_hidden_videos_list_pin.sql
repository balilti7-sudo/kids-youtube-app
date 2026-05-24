-- PIN-protected list for authenticated parents (blocked videos management page).

CREATE OR REPLACE FUNCTION public.parent_hidden_videos_list_details(
  p_device_id UUID,
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
    SELECT 1 FROM public.devices d
    WHERE d.id = p_device_id AND d.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'DEVICE_NOT_FOUND';
  END IF;

  RETURN QUERY
  SELECT * FROM public._device_hidden_videos_rows(p_device_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.parent_hidden_videos_list_details(UUID, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
