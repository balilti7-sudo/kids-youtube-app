-- Dual parental controls: document + ensure columns (aliases for product naming).
-- Canonical columns (already from 064):
--   block_youtube_app        ↔ product: block_youtube_app
--   browser_filter_enabled   ↔ product: block_browser_enabled
--   browser_whitelist        ↔ product: allowed_urls
-- Renaming is intentionally avoided to keep existing RPCs/clients working.

ALTER TABLE public.devices
  ADD COLUMN IF NOT EXISTS block_youtube_app BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.devices
  ADD COLUMN IF NOT EXISTS browser_filter_enabled BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.devices
  ADD COLUMN IF NOT EXISTS browser_whitelist TEXT[] NOT NULL DEFAULT '{}'::text[];

COMMENT ON COLUMN public.devices.block_youtube_app IS
  'Block YouTube app packages + youtube.com / m.youtube.com in browsers (Accessibility).';
COMMENT ON COLUMN public.devices.browser_filter_enabled IS
  'Strict whitelist-only browser mode (product alias: block_browser_enabled).';
COMMENT ON COLUMN public.devices.browser_whitelist IS
  'Allowed domains for browser whitelist mode (product alias: allowed_urls), e.g. {kiddos.co.il,wikikids.org.il}.';

-- Normalize whitelist entries: trim, lowercase, drop empties on write via helper.
CREATE OR REPLACE FUNCTION public._normalize_allowed_hosts(p_hosts TEXT[])
RETURNS TEXT[]
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_out TEXT[] := '{}'::text[];
  v_h TEXT;
  v_n TEXT;
BEGIN
  IF p_hosts IS NULL THEN
    RETURN v_out;
  END IF;
  FOREACH v_h IN ARRAY p_hosts LOOP
    v_n := lower(btrim(COALESCE(v_h, '')));
    v_n := regexp_replace(v_n, '^https?://', '');
    v_n := split_part(v_n, '/', 1);
    v_n := split_part(v_n, '?', 1);
    IF v_n LIKE 'www.%' THEN
      v_n := substring(v_n FROM 5);
    END IF;
    IF v_n <> '' AND NOT (v_n = ANY (v_out)) THEN
      v_out := array_append(v_out, v_n);
    END IF;
  END LOOP;
  RETURN v_out;
END;
$$;

-- Patch parent_update_device_settings to normalize whitelist hosts on write.
CREATE OR REPLACE FUNCTION public.parent_update_device_settings(
  p_device_id UUID,
  p_allow_shorts BOOLEAN DEFAULT NULL,
  p_block_youtube_app BOOLEAN DEFAULT NULL,
  p_browser_filter_enabled BOOLEAN DEFAULT NULL,
  p_browser_whitelist TEXT[] DEFAULT NULL,
  p_daily_time_limit_minutes INT DEFAULT NULL
)
RETURNS public.devices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.devices%ROWTYPE;
  v_limit INT;
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

  IF p_daily_time_limit_minutes IS NOT NULL THEN
    v_limit := p_daily_time_limit_minutes;
    IF v_limit <> 0 AND (v_limit < 1 OR v_limit > 1440) THEN
      RAISE EXCEPTION 'INVALID_DAILY_TIME_LIMIT';
    END IF;
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
      ELSE public._normalize_allowed_hosts(p_browser_whitelist)
    END,
    daily_time_limit_minutes = CASE
      WHEN p_daily_time_limit_minutes IS NULL THEN d.daily_time_limit_minutes
      ELSE p_daily_time_limit_minutes
    END
  WHERE d.id = p_device_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.local_parent_update_device_settings(
  p_access_token UUID,
  p_allow_shorts BOOLEAN DEFAULT NULL,
  p_block_youtube_app BOOLEAN DEFAULT NULL,
  p_browser_filter_enabled BOOLEAN DEFAULT NULL,
  p_browser_whitelist TEXT[] DEFAULT NULL,
  p_daily_time_limit_minutes INT DEFAULT NULL
)
RETURNS public.devices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_device_id UUID;
  v_row public.devices%ROWTYPE;
  v_limit INT;
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

  IF p_daily_time_limit_minutes IS NOT NULL THEN
    v_limit := p_daily_time_limit_minutes;
    IF v_limit <> 0 AND (v_limit < 1 OR v_limit > 1440) THEN
      RAISE EXCEPTION 'INVALID_DAILY_TIME_LIMIT';
    END IF;
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
      ELSE public._normalize_allowed_hosts(p_browser_whitelist)
    END,
    daily_time_limit_minutes = CASE
      WHEN p_daily_time_limit_minutes IS NULL THEN d.daily_time_limit_minutes
      ELSE p_daily_time_limit_minutes
    END
  WHERE d.id = v_device_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.parent_update_device_settings(UUID, BOOLEAN, BOOLEAN, BOOLEAN, TEXT[], INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.local_parent_update_device_settings(UUID, BOOLEAN, BOOLEAN, BOOLEAN, TEXT[], INT) TO anon, authenticated;
