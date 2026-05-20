-- Fix PIN change when profiles.access_code was never added (migration 020 not applied on production).
-- Canonical column: profiles.parent_pin. RPC change_parent_pin uses parent_pin only.

DROP TRIGGER IF EXISTS profiles_guard_parent_pin ON public.profiles;
DROP FUNCTION IF EXISTS public.profiles_guard_parent_pin_update();
DROP FUNCTION IF EXISTS public._profile_resolved_parent_pin(text, text);
DROP FUNCTION IF EXISTS public.change_parent_pin(text, text);

CREATE OR REPLACE FUNCTION public._profile_resolved_parent_pin(p_parent_pin text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  pp text;
BEGIN
  pp := trim(COALESCE(p_parent_pin, ''));
  IF length(pp) >= 4 AND pp <> '0000' THEN
    RETURN pp;
  END IF;
  RETURN '';
END;
$$;

CREATE OR REPLACE FUNCTION public.change_parent_pin(p_current_pin text, p_new_pin text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_row public.profiles%ROWTYPE;
  v_stored text;
  v_clean_current text;
  v_clean_new text;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  v_clean_current := regexp_replace(COALESCE(trim(p_current_pin), ''), '\D', '', 'g');
  v_clean_new := regexp_replace(COALESCE(trim(p_new_pin), ''), '\D', '', 'g');

  IF length(v_clean_new) < 4 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'pin_too_short');
  END IF;
  IF length(v_clean_new) > 6 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'pin_too_long');
  END IF;
  IF v_clean_new !~ '^[0-9]+$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'pin_not_numeric');
  END IF;

  SELECT * INTO v_row FROM public.profiles WHERE id = v_uid;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'profile_not_found');
  END IF;

  v_stored := public._profile_resolved_parent_pin(v_row.parent_pin);

  IF length(v_stored) >= 4 THEN
    IF length(v_clean_current) < 4 OR length(v_clean_current) > 6 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'current_pin_required');
    END IF;
    IF v_clean_current <> v_stored THEN
      RETURN jsonb_build_object('ok', false, 'error', 'wrong_current_pin');
    END IF;
  END IF;

  PERFORM set_config('safetube.allow_parent_pin_write', '1', true);
  UPDATE public.profiles SET parent_pin = v_clean_new WHERE id = v_uid;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.change_parent_pin(text, text) TO authenticated;
