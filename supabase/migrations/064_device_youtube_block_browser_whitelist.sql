-- Parental OS controls: block YouTube app + browser whitelist mode (enforced on-device via Accessibility).

ALTER TABLE public.devices
  ADD COLUMN IF NOT EXISTS block_youtube_app BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.devices
  ADD COLUMN IF NOT EXISTS browser_filter_enabled BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.devices
  ADD COLUMN IF NOT EXISTS browser_whitelist TEXT[] NOT NULL DEFAULT '{}'::text[];

COMMENT ON COLUMN public.devices.block_youtube_app IS
  'When true, the child device blocks the YouTube app (Accessibility service).';
COMMENT ON COLUMN public.devices.browser_filter_enabled IS
  'When true, browsers only allow hosts listed in browser_whitelist.';
COMMENT ON COLUMN public.devices.browser_whitelist IS
  'Allowed hostnames for browser filter mode (e.g. wikipedia.org).';

-- Drop every parent_update_device_settings overload, then recreate a single signature.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'parent_update_device_settings'
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS public.parent_update_device_settings(%s)', r.args);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.parent_update_device_settings(
  p_device_id UUID,
  p_allow_shorts BOOLEAN DEFAULT NULL,
  p_block_youtube_app BOOLEAN DEFAULT NULL,
  p_browser_filter_enabled BOOLEAN DEFAULT NULL,
  p_browser_whitelist TEXT[] DEFAULT NULL
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
    block_youtube_app = CASE
      WHEN p_block_youtube_app IS NULL THEN d.block_youtube_app
      ELSE p_block_youtube_app
    END,
    browser_filter_enabled = CASE
      WHEN p_browser_filter_enabled IS NULL THEN d.browser_filter_enabled
      ELSE p_browser_filter_enabled
    END,
    browser_whitelist = CASE
      WHEN p_browser_whitelist IS NULL THEN d.browser_whitelist
      ELSE p_browser_whitelist
    END
  WHERE d.id = p_device_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.parent_update_device_settings(UUID, BOOLEAN, BOOLEAN, BOOLEAN, TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.parent_update_device_settings(UUID, BOOLEAN, BOOLEAN, BOOLEAN, TEXT[]) TO authenticated;

-- Local parent (PIN session on the child device) can update the same settings.
-- The app's local-parent session reuses devices.child_access_token.
CREATE OR REPLACE FUNCTION public.local_parent_update_device_settings(
  p_access_token UUID,
  p_allow_shorts BOOLEAN DEFAULT NULL,
  p_block_youtube_app BOOLEAN DEFAULT NULL,
  p_browser_filter_enabled BOOLEAN DEFAULT NULL,
  p_browser_whitelist TEXT[] DEFAULT NULL
)
RETURNS public.devices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_device_id UUID;
  v_row public.devices%ROWTYPE;
BEGIN
  IF p_access_token IS NULL THEN
    RAISE EXCEPTION 'INVALID_LOCAL_PARENT_TOKEN';
  END IF;

  SELECT d.id INTO v_device_id
  FROM public.devices d
  WHERE d.child_access_token = p_access_token
  LIMIT 1;

  IF v_device_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_LOCAL_PARENT_TOKEN';
  END IF;

  UPDATE public.devices d
  SET
    allow_shorts = CASE
      WHEN p_allow_shorts IS NULL THEN d.allow_shorts
      ELSE p_allow_shorts
    END,
    block_youtube_app = CASE
      WHEN p_block_youtube_app IS NULL THEN d.block_youtube_app
      ELSE p_block_youtube_app
    END,
    browser_filter_enabled = CASE
      WHEN p_browser_filter_enabled IS NULL THEN d.browser_filter_enabled
      ELSE p_browser_filter_enabled
    END,
    browser_whitelist = CASE
      WHEN p_browser_whitelist IS NULL THEN d.browser_whitelist
      ELSE p_browser_whitelist
    END
  WHERE d.id = v_device_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.local_parent_update_device_settings(UUID, BOOLEAN, BOOLEAN, BOOLEAN, TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.local_parent_update_device_settings(UUID, BOOLEAN, BOOLEAN, BOOLEAN, TEXT[]) TO anon, authenticated;

DROP FUNCTION IF EXISTS public.child_get_device_state(UUID);

CREATE OR REPLACE FUNCTION public.child_get_device_state(p_access_token UUID)
RETURNS TABLE (
  device_id UUID,
  device_name TEXT,
  is_blocked BOOLEAN,
  is_online BOOLEAN,
  last_seen_at TIMESTAMPTZ,
  allow_shorts BOOLEAN,
  block_youtube_app BOOLEAN,
  browser_filter_enabled BOOLEAN,
  browser_whitelist TEXT[]
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    d.id,
    d.name,
    d.is_blocked,
    d.is_online,
    d.last_seen_at,
    d.allow_shorts,
    d.block_youtube_app,
    d.browser_filter_enabled,
    d.browser_whitelist
  FROM public.devices d
  WHERE d.child_access_token = p_access_token
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.child_get_device_state(UUID) TO anon, authenticated;

DROP FUNCTION IF EXISTS public.local_parent_device_summary(UUID);

CREATE OR REPLACE FUNCTION public.local_parent_device_summary(p_access_token UUID)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  name TEXT,
  device_type TEXT,
  pairing_code TEXT,
  is_online BOOLEAN,
  is_blocked BOOLEAN,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  channel_count BIGINT,
  allow_shorts BOOLEAN,
  block_youtube_app BOOLEAN,
  browser_filter_enabled BOOLEAN,
  browser_whitelist TEXT[]
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
    (SELECT COUNT(*) FROM public.device_whitelist w WHERE w.device_id = d.id),
    d.allow_shorts,
    d.block_youtube_app,
    d.browser_filter_enabled,
    d.browser_whitelist
  FROM public.devices d
  WHERE d.child_access_token = p_access_token
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.local_parent_device_summary(UUID) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
