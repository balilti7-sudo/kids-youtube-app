-- Fix parent PIN verification for local/child-device management flows.
--
-- Production had an older RPC body that attempted to read the parent PIN from
-- the devices table. The schema stores the parent management PIN on `profiles.parent_pin`
-- (with `parent_settings.pin_hash` only as a legacy fallback), so all local
-- parent RPCs should validate by owner user id, not by a devices column.

CREATE OR REPLACE FUNCTION public._profile_resolved_parent_pin(p_parent_pin text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  pp text;
BEGIN
  pp := trim(COALESCE(p_parent_pin, ''));
  IF length(pp) BETWEEN 4 AND 6 AND pp ~ '^[0-9]+$' AND pp <> '0000' THEN
    RETURN pp;
  END IF;
  RETURN '';
END;
$$;

CREATE OR REPLACE FUNCTION public._local_parent_pin_ok(p_user_id uuid, p_pin text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  clean_pin text;
  stored_profile_pin text;
  legacy_settings_pin text;
BEGIN
  clean_pin := regexp_replace(COALESCE(trim(p_pin), ''), '\D', '', 'g');

  IF length(clean_pin) < 4 OR length(clean_pin) > 6 THEN
    RETURN false;
  END IF;

  SELECT public._profile_resolved_parent_pin(p.parent_pin)
  INTO stored_profile_pin
  FROM public.profiles p
  WHERE p.id = p_user_id
  LIMIT 1;

  IF length(COALESCE(stored_profile_pin, '')) >= 4 THEN
    RETURN clean_pin = stored_profile_pin;
  END IF;

  -- Legacy fallback for databases that still have old local PIN data there.
  SELECT regexp_replace(COALESCE(trim(ps.pin_hash), ''), '\D', '', 'g')
  INTO legacy_settings_pin
  FROM public.parent_settings ps
  WHERE ps.user_id = p_user_id
  LIMIT 1;

  IF length(COALESCE(legacy_settings_pin, '')) BETWEEN 4 AND 6 THEN
    RETURN clean_pin = legacy_settings_pin;
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public._local_parent_pin_ok(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._local_parent_pin_ok(uuid, text) TO anon, authenticated, service_role;

-- Keep authenticated parent verification explicit as well: it also validates
-- against `profiles.parent_pin`, never against `devices`.
CREATE OR REPLACE FUNCTION public._auth_parent_pin_matches(p_pin text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  clean_pin text;
  stored_pin text;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN false;
  END IF;

  clean_pin := regexp_replace(COALESCE(trim(p_pin), ''), '\D', '', 'g');
  IF length(clean_pin) < 4 OR length(clean_pin) > 6 THEN
    RETURN false;
  END IF;

  SELECT public._profile_resolved_parent_pin(p.parent_pin)
  INTO stored_pin
  FROM public.profiles p
  WHERE p.id = v_uid
  LIMIT 1;

  RETURN length(COALESCE(stored_pin, '')) >= 4 AND clean_pin = stored_pin;
END;
$$;

REVOKE ALL ON FUNCTION public._auth_parent_pin_matches(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._auth_parent_pin_matches(text) TO authenticated, service_role;
