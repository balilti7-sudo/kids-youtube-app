-- =============================================================================
-- Child mode support: pairing by code + secure access token + heartbeat RPCs
-- =============================================================================

ALTER TABLE public.devices
ADD COLUMN IF NOT EXISTS child_access_token UUID NOT NULL DEFAULT gen_random_uuid();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'devices_child_access_token_key'
  ) THEN
    ALTER TABLE public.devices
    ADD CONSTRAINT devices_child_access_token_key UNIQUE (child_access_token);
  END IF;
END $$;

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
BEGIN
  IF p_pairing_code IS NULL OR btrim(p_pairing_code) = '' THEN
    RETURN;
  END IF;

  SELECT *
  INTO v_device
  FROM public.devices
  WHERE pairing_code = btrim(p_pairing_code)
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
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

  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.child_get_device_state(p_access_token UUID)
RETURNS TABLE (
  device_id UUID,
  device_name TEXT,
  is_blocked BOOLEAN,
  is_online BOOLEAN,
  last_seen_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT d.id, d.name, d.is_blocked, d.is_online, d.last_seen_at
  FROM public.devices d
  WHERE d.child_access_token = p_access_token
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.child_get_allowed_videos(p_access_token UUID)
RETURNS TABLE (
  device_id UUID,
  is_blocked BOOLEAN,
  youtube_video_id TEXT,
  title TEXT,
  thumbnail_url TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    d.id AS device_id,
    d.is_blocked,
    wv.youtube_video_id,
    wv.title,
    wv.thumbnail_url
  FROM public.devices d
  JOIN public.device_video_whitelist dvw
    ON dvw.device_id = d.id
  JOIN public.whitelisted_videos wv
    ON wv.id = dvw.video_id
  WHERE d.child_access_token = p_access_token
  ORDER BY dvw.added_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.child_heartbeat(p_access_token UUID)
RETURNS TABLE (
  device_id UUID,
  is_blocked BOOLEAN,
  last_seen_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.devices d
  SET is_online = TRUE, last_seen_at = now()
  WHERE d.child_access_token = p_access_token
  RETURNING d.id, d.is_blocked, d.last_seen_at;
$$;

CREATE OR REPLACE FUNCTION public.child_mark_offline(p_access_token UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.devices
  SET is_online = FALSE
  WHERE child_access_token = p_access_token;
$$;

GRANT EXECUTE ON FUNCTION public.child_pair_device(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.child_get_device_state(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.child_get_allowed_videos(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.child_heartbeat(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.child_mark_offline(UUID) TO anon, authenticated;
