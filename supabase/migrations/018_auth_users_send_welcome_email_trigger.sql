-- After INSERT on auth.users → POST send-welcome-email (pg_net).
--
-- Same prerequisites as 016_profiles_send_welcome_email_trigger.sql:
--   alter database postgres set app.settings.supabase_url = 'https://<project-ref>.supabase.co';
--   alter database postgres set app.settings.supabase_anon_key = '<anon_key>';
--   alter database postgres set app.settings.welcome_email_webhook_secret = '<optional_secret>';
--
-- Edge Function secrets: RESEND_API_KEY, RESEND_FROM, WELCOME_EMAIL_WEBHOOK_SECRET (if used), etc.
--
-- IMPORTANT: If you already use public.profiles_send_welcome_email (migration 016), each signup may
-- send TWO welcome emails (auth insert + profile insert). Disable one trigger to avoid duplicates.

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.enqueue_send_welcome_email_on_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_supabase_url text;
  v_anon_key text;
  v_secret text;
  v_email text;
  v_full_name text;
BEGIN
  v_email := NULLIF(trim(COALESCE(NEW.email, '')), '');
  IF v_email IS NULL THEN
    RETURN NEW;
  END IF;

  v_supabase_url := NULLIF(current_setting('app.settings.supabase_url', true), '');
  v_anon_key := NULLIF(current_setting('app.settings.supabase_anon_key', true), '');
  v_secret := COALESCE(NULLIF(current_setting('app.settings.welcome_email_webhook_secret', true), ''), '');

  IF v_supabase_url IS NULL OR v_anon_key IS NULL THEN
    RAISE WARNING '[enqueue_send_welcome_email_on_auth_user] Missing app.settings.supabase_url or app.settings.supabase_anon_key';
    RETURN NEW;
  END IF;

  v_full_name := NULLIF(
    trim(COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', '')),
    ''
  );

  PERFORM extensions.net.http_post(
    url := v_supabase_url || '/functions/v1/send-welcome-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_anon_key,
      'x-welcome-email-secret', v_secret
    ),
    body := jsonb_build_object(
      'profile_id', NEW.id,
      'email', lower(v_email),
      'full_name', v_full_name,
      'parent_pin', NULL
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS auth_users_send_welcome_email ON auth.users;

CREATE TRIGGER auth_users_send_welcome_email
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.enqueue_send_welcome_email_on_auth_user();
