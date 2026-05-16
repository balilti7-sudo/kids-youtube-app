-- Require current PIN to change profiles.parent_pin when a PIN is already set.
-- First-time set (NULL / empty / 0000) may still use direct UPDATE (SetParentPinPage).

CREATE OR REPLACE FUNCTION public._profile_resolved_parent_pin(p_parent_pin text, p_access_code text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  pp text;
  ac text;
BEGIN
  pp := trim(COALESCE(p_parent_pin, ''));
  ac := trim(COALESCE(p_access_code, ''));
  IF length(pp) >= 4 AND pp <> '0000' THEN
    RETURN pp;
  END IF;
  IF length(ac) >= 4 AND ac <> '0000' THEN
    RETURN ac;
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

  v_stored := public._profile_resolved_parent_pin(v_row.parent_pin, v_row.access_code);

  IF length(v_stored) >= 4 THEN
    IF length(v_clean_current) < 4 OR length(v_clean_current) > 6 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'current_pin_required');
    END IF;
    IF v_clean_current <> v_stored THEN
      RETURN jsonb_build_object('ok', false, 'error', 'wrong_current_pin');
    END IF;
  END IF;

  PERFORM set_config('safetube.allow_parent_pin_write', '1', true);

  UPDATE public.profiles
  SET parent_pin = v_clean_new
  WHERE id = v_uid;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.change_parent_pin(text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.profiles_guard_parent_pin_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_old text;
  v_has_usable_old boolean;
BEGIN
  IF NEW.parent_pin IS NOT DISTINCT FROM OLD.parent_pin THEN
    RETURN NEW;
  END IF;

  v_old := trim(COALESCE(OLD.parent_pin, ''));
  v_has_usable_old := length(v_old) >= 4 AND v_old <> '0000';

  IF NOT v_has_usable_old THEN
    RETURN NEW;
  END IF;

  IF COALESCE(current_setting('safetube.allow_parent_pin_write', true), '') <> '1' THEN
    RAISE EXCEPTION 'parent_pin_update_not_allowed'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_guard_parent_pin ON public.profiles;

CREATE TRIGGER profiles_guard_parent_pin
  BEFORE UPDATE OF parent_pin ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.profiles_guard_parent_pin_update();
