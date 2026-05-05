-- Trigger welcome email edge function on new profile rows.
-- Requires DB settings (set once in SQL editor):
--   alter database postgres set app.settings.supabase_url = 'https://<project-ref>.supabase.co';
--   alter database postgres set app.settings.supabase_anon_key = '<your_anon_key>';
--   alter database postgres set app.settings.welcome_email_webhook_secret = '<same_secret_as_edge_function>';
--
-- And set Edge Function secrets:
--   RESEND_API_KEY
--   RESEND_FROM
--   RESEND_REPLY_TO (optional)
--   WELCOME_EMAIL_WEBHOOK_SECRET (optional but recommended)

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.enqueue_send_welcome_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_supabase_url text;
  v_anon_key text;
  v_secret text;
  v_payload jsonb;
BEGIN
  IF NEW.email IS NULL OR length(trim(NEW.email)) = 0 THEN
    RETURN NEW;
  END IF;

  v_supabase_url := NULLIF(current_setting('app.settings.supabase_url', true), '');
  v_anon_key := NULLIF(current_setting('app.settings.supabase_anon_key', true), '');
  v_secret := COALESCE(NULLIF(current_setting('app.settings.welcome_email_webhook_secret', true), ''), '');

  IF v_supabase_url IS NULL OR v_anon_key IS NULL THEN
    RAISE WARNING '[enqueue_send_welcome_email] Missing app.settings.supabase_url or app.settings.supabase_anon_key';
    RETURN NEW;
  END IF;

  v_payload := jsonb_build_object(
    'profile_id', NEW.id,
    'email', NEW.email,
    'full_name', NEW.full_name,
    'parent_pin', NEW.parent_pin
  );

  PERFORM extensions.net.http_post(
    url := v_supabase_url || '/functions/v1/send-welcome-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_anon_key,
      'x-welcome-email-secret', v_secret
    ),
    body := v_payload
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_send_welcome_email ON public.profiles;

CREATE TRIGGER profiles_send_welcome_email
AFTER INSERT ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.enqueue_send_welcome_email();
