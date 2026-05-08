-- Fix pg_net call path: function lives in `net` schema, not `extensions.net`.

CREATE OR REPLACE FUNCTION public.enqueue_send_welcome_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_supabase_url constant text := 'https://ioylyyqlluenkkltguhf.supabase.co';
  v_anon_key constant text := 'YOUR_ANON_KEY_HERE';
  v_secret constant text := '';
BEGIN
  IF NEW.email IS NULL OR length(trim(NEW.email)) = 0 THEN
    RETURN NEW;
  END IF;

  BEGIN
    PERFORM net.http_post(
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
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[enqueue_send_welcome_email] http_post failed: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_send_welcome_email_on_pin_set()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_supabase_url constant text := 'https://ioylyyqlluenkkltguhf.supabase.co';
  v_anon_key constant text := 'YOUR_ANON_KEY_HERE';
  v_secret constant text := '';
  v_new_pin text;
BEGIN
  IF NEW.email IS NULL OR length(trim(NEW.email)) = 0 THEN
    RETURN NEW;
  END IF;

  v_new_pin := trim(COALESCE(NEW.parent_pin, ''));
  IF v_new_pin = '' OR v_new_pin = '0000' THEN
    RETURN NEW;
  END IF;

  IF trim(COALESCE(OLD.parent_pin, '')) <> '' AND trim(COALESCE(OLD.parent_pin, '')) <> '0000' THEN
    RETURN NEW;
  END IF;

  BEGIN
    PERFORM net.http_post(
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
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[enqueue_send_welcome_email_on_pin_set] http_post failed: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;
