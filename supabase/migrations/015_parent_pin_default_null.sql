-- parent_pin should not default to 0000.
-- New users without explicit metadata must be redirected to SetParentPinPage.

ALTER TABLE public.profiles
  ALTER COLUMN parent_pin DROP DEFAULT;

UPDATE public.profiles
SET parent_pin = NULL
WHERE trim(COALESCE(parent_pin, '')) = '0000';

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parent_pin text;
BEGIN
  v_parent_pin := NULLIF(trim(COALESCE(NEW.raw_user_meta_data ->> 'parent_pin', '')), '');
  IF v_parent_pin = '0000' THEN
    v_parent_pin := NULL;
  END IF;

  INSERT INTO public.profiles (id, email, full_name, avatar_url, parent_pin)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    NEW.raw_user_meta_data ->> 'full_name',
    NEW.raw_user_meta_data ->> 'avatar_url',
    v_parent_pin
  );

  INSERT INTO public.subscriptions (
    user_id,
    plan,
    status,
    trial_ends_at,
    max_devices
  )
  VALUES (
    NEW.id,
    'trial',
    'active',
    now() + interval '14 days',
    3
  );

  INSERT INTO public.parent_settings (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;
