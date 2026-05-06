-- Also send the welcome/reminder email when parent_pin is first set later
-- (e.g. OAuth user redirected to SetParentPinPage).

CREATE OR REPLACE FUNCTION public.enqueue_send_welcome_email_on_pin_set()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_supabase_url text;
  v_anon_key text;
  v_secret text;
  v_new_pin text;
BEGIN
  IF NEW.email IS NULL OR length(trim(NEW.email)) = 0 THEN
    RETURN NEW;
  END IF;

  v_new_pin := trim(COALESCE(NEW.parent_pin, ''));
  IF v_new_pin = '' OR v_new_pin = '0000' THEN
    RETURN NEW;
  END IF;

  -- Only when pin was missing/placeholder before this update.
  IF trim(COALESCE(OLD.parent_pin, '')) <> '' AND trim(COALESCE(OLD.parent_pin, '')) <> '0000' THEN
    RETURN NEW;
  END IF;

  v_supabase_url := NULLIF(current_setting('app.settings.supabase_url', true), '');
  v_anon_key := NULLIF(current_setting('app.settings.supabase_anon_key', true), '');
  v_secret := COALESCE(NULLIF(current_setting('app.settings.welcome_email_webhook_secret', true), ''), '');

  IF v_supabase_url IS NULL OR v_anon_key IS NULL THEN
    RAISE WARNING '[enqueue_send_welcome_email_on_pin_set] Missing app.settings.supabase_url or app.settings.supabase_anon_key';
    RETURN NEW;
  END IF;

  PERFORM extensions.net.http_post(
    url := v_supabase_url || '/functions/v1/send-welcome-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_anon_key,
      'x-welcome-email-secret', v_secret
    ),
    body := jsonb_build_object(
      'profile_id', NEW.id,
      'email', NEW.email,
      'full_name', NEW.full_name,
      'parent_pin', NEW.parent_pin
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_send_welcome_email_on_pin_set ON public.profiles;

CREATE TRIGGER profiles_send_welcome_email_on_pin_set
AFTER UPDATE OF parent_pin ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.enqueue_send_welcome_email_on_pin_set();
