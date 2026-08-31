-- =============================================================================
-- 075: Kid browse — expose parent taste weights to child token (read-only)
-- Additive RPC only; does not change playback or whitelist RPCs.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.child_get_content_tag_preferences(p_access_token UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_device_id UUID;
  v_owner UUID;
  v_prefs JSONB;
BEGIN
  SELECT d.id, d.user_id INTO v_device_id, v_owner
  FROM public.devices d
  WHERE d.child_access_token = p_access_token
  LIMIT 1;

  IF v_device_id IS NULL OR v_owner IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  v_prefs := public._get_device_content_prefs_impl(v_device_id, v_owner)->'tag_preferences';
  RETURN COALESCE(v_prefs, '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.child_get_content_tag_preferences(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.child_get_content_tag_preferences(UUID) TO anon, authenticated;
