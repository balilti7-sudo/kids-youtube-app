-- Security hardening: hashed parent PINs, restore write guard, server-side verify RPC.
-- Apply in Supabase SQL editor / CLI after reviewing.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- 1) Hash column (plaintext parent_pin kept only for migration / legacy RPCs)
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS parent_pin_hash text;

COMMENT ON COLUMN public.profiles.parent_pin_hash IS
  'bcrypt hash of parent management PIN (pgcrypto crypt). Prefer this over parent_pin.';

-- ---------------------------------------------------------------------------
-- 2) Constant-time-ish match helper (hash preferred, plaintext legacy upgrade)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.parent_pin_matches(p_row public.profiles, p_pin text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_clean text;
  v_plain text;
BEGIN
  v_clean := regexp_replace(COALESCE(trim(p_pin), ''), '\D', '', 'g');
  IF length(v_clean) < 4 OR length(v_clean) > 6 THEN
    RETURN false;
  END IF;

  IF p_row.parent_pin_hash IS NOT NULL AND length(p_row.parent_pin_hash) > 0 THEN
    RETURN crypt(v_clean, p_row.parent_pin_hash) = p_row.parent_pin_hash;
  END IF;

  v_plain := trim(COALESCE(p_row.parent_pin, ''));
  IF length(v_plain) >= 4 AND v_plain <> '0000' AND v_clean = v_plain THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.parent_pin_is_configured(p_row public.profiles)
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_plain text;
BEGIN
  IF p_row.parent_pin_hash IS NOT NULL AND length(p_row.parent_pin_hash) > 0 THEN
    RETURN true;
  END IF;
  v_plain := trim(COALESCE(p_row.parent_pin, ''));
  RETURN length(v_plain) >= 4 AND v_plain <> '0000';
END;
$$;

-- ---------------------------------------------------------------------------
-- 3) verify_parent_pin — client must NOT SELECT plaintext parent_pin
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.verify_parent_pin(p_pin text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.profiles%ROWTYPE;
  v_clean text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  v_clean := regexp_replace(COALESCE(trim(p_pin), ''), '\D', '', 'g');
  IF length(v_clean) <> 6 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_pin_format');
  END IF;

  SELECT * INTO v_row FROM public.profiles WHERE id = v_uid;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'profile_not_found');
  END IF;

  IF NOT public.parent_pin_is_configured(v_row) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'pin_not_configured');
  END IF;

  IF NOT public.parent_pin_matches(v_row, v_clean) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'wrong_pin');
  END IF;

  -- Upgrade legacy plaintext → hash and clear plaintext when possible
  IF (v_row.parent_pin_hash IS NULL OR length(v_row.parent_pin_hash) = 0)
     AND length(trim(COALESCE(v_row.parent_pin, ''))) >= 4 THEN
    PERFORM set_config('safetube.allow_parent_pin_write', '1', true);
    UPDATE public.profiles
    SET
      parent_pin_hash = crypt(v_clean, gen_salt('bf')),
      parent_pin = NULL
    WHERE id = v_uid;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_parent_pin(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4) change_parent_pin — store bcrypt hash, clear plaintext
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.change_parent_pin(p_current_pin text, p_new_pin text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid uuid;
  v_row public.profiles%ROWTYPE;
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

  IF public.parent_pin_is_configured(v_row) THEN
    IF length(v_clean_current) < 4 OR length(v_clean_current) > 6 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'current_pin_required');
    END IF;
    IF NOT public.parent_pin_matches(v_row, v_clean_current) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'wrong_current_pin');
    END IF;
  END IF;

  PERFORM set_config('safetube.allow_parent_pin_write', '1', true);
  UPDATE public.profiles
  SET
    parent_pin_hash = crypt(v_clean_new, gen_salt('bf')),
    parent_pin = NULL
  WHERE id = v_uid;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.change_parent_pin(text, text) TO authenticated;

-- First-time set (no current PIN) via SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.set_parent_pin(p_new_pin text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.profiles%ROWTYPE;
  v_clean_new text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  v_clean_new := regexp_replace(COALESCE(trim(p_new_pin), ''), '\D', '', 'g');
  IF length(v_clean_new) <> 6 OR v_clean_new !~ '^[0-9]+$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_pin_format');
  END IF;

  SELECT * INTO v_row FROM public.profiles WHERE id = v_uid;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'profile_not_found');
  END IF;

  IF public.parent_pin_is_configured(v_row) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'pin_already_set');
  END IF;

  PERFORM set_config('safetube.allow_parent_pin_write', '1', true);
  UPDATE public.profiles
  SET
    parent_pin_hash = crypt(v_clean_new, gen_salt('bf')),
    parent_pin = NULL
  WHERE id = v_uid;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_parent_pin(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5) One-time backfill BEFORE write guard (keeps plaintext until first verify clears it)
-- ---------------------------------------------------------------------------
UPDATE public.profiles
SET parent_pin_hash = crypt(trim(parent_pin), gen_salt('bf'))
WHERE parent_pin_hash IS NULL
  AND parent_pin IS NOT NULL
  AND length(trim(parent_pin)) >= 4
  AND trim(parent_pin) <> '0000'
  AND trim(parent_pin) ~ '^[0-9]{4,6}$';

-- ---------------------------------------------------------------------------
-- 6) Restore write guard — block direct UPDATE of parent_pin / parent_pin_hash
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.profiles_guard_parent_pin_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.parent_pin IS NOT DISTINCT FROM OLD.parent_pin
     AND NEW.parent_pin_hash IS NOT DISTINCT FROM OLD.parent_pin_hash THEN
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
  BEFORE UPDATE OF parent_pin, parent_pin_hash ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.profiles_guard_parent_pin_update();
