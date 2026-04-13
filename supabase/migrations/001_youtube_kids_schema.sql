-- =============================================================================
-- SafeTube / YouTube Kids — סכמת PostgreSQL ל-Supabase
-- הרצה: SQL Editor ב-Supabase או: supabase db push (אם משתמשים ב-CLI)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) פרופיל משתמש (הרחבה ל-auth.users)
-- ---------------------------------------------------------------------------
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  avatar_url TEXT,
  onboarding_done BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2) הגדרות הורים (למכשיר / מדיניות צפייה) — לפני טריגר הרשמה
-- ---------------------------------------------------------------------------
CREATE TABLE public.parent_settings (
  user_id UUID PRIMARY KEY REFERENCES public.profiles (id) ON DELETE CASCADE,
  daily_screen_limit_minutes INT CHECK (
    daily_screen_limit_minutes IS NULL
    OR daily_screen_limit_minutes BETWEEN 0 AND 1440
  ),
  block_shorts BOOLEAN NOT NULL DEFAULT TRUE,
  block_live_streams BOOLEAN NOT NULL DEFAULT FALSE,
  notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  pin_hash TEXT,
  extras JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER parent_settings_updated_at
  BEFORE UPDATE ON public.parent_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3) מנוי
-- ---------------------------------------------------------------------------
CREATE TABLE public.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES public.profiles (id) ON DELETE CASCADE,
  plan TEXT NOT NULL DEFAULT 'trial'
    CHECK (plan IN ('trial', 'monthly', 'yearly')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'expired', 'cancelled', 'payment_failed')),
  trial_ends_at TIMESTAMPTZ,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  max_devices INT NOT NULL DEFAULT 3,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_subscriptions_user ON public.subscriptions (user_id);
CREATE INDEX idx_subscriptions_stripe_customer ON public.subscriptions (stripe_customer_id);

CREATE TRIGGER subscriptions_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- טריגר הרשמה: פרופיל + מנוי ניסיון + שורת הגדרות הורים
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    NEW.raw_user_meta_data ->> 'full_name',
    NEW.raw_user_meta_data ->> 'avatar_url'
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

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 4) מכשירי ילדים
-- ---------------------------------------------------------------------------
CREATE TABLE public.devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  device_type TEXT NOT NULL DEFAULT 'phone'
    CHECK (device_type IN ('phone', 'tablet')),
  pairing_code TEXT UNIQUE,
  is_online BOOLEAN NOT NULL DEFAULT FALSE,
  is_blocked BOOLEAN NOT NULL DEFAULT TRUE,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_devices_user_id ON public.devices (user_id);
CREATE INDEX idx_devices_pairing_code ON public.devices (pairing_code);

CREATE TRIGGER devices_updated_at
  BEFORE UPDATE ON public.devices
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 5) ערוצי YouTube מאושרים (קטלוג משותף)
-- ---------------------------------------------------------------------------
CREATE TABLE public.whitelisted_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  youtube_channel_id TEXT NOT NULL UNIQUE,
  channel_name TEXT NOT NULL,
  channel_thumbnail TEXT,
  subscriber_count TEXT,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_whitelisted_channels_yt_id ON public.whitelisted_channels (youtube_channel_id);

-- ---------------------------------------------------------------------------
-- 6) סרטוני YouTube מאושרים (רמת סרטון — מעבר לערוץ)
-- ---------------------------------------------------------------------------
CREATE TABLE public.whitelisted_videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  youtube_video_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  thumbnail_url TEXT,
  youtube_channel_id TEXT,
  duration_seconds INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_whitelisted_videos_yt_id ON public.whitelisted_videos (youtube_video_id);

-- ---------------------------------------------------------------------------
-- 7) קישור מכשיר ↔ ערוץ מאושר
-- ---------------------------------------------------------------------------
CREATE TABLE public.device_whitelist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES public.devices (id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES public.whitelisted_channels (id) ON DELETE CASCADE,
  added_by UUID NOT NULL REFERENCES public.profiles (id),
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (device_id, channel_id)
);

CREATE INDEX idx_device_whitelist_device ON public.device_whitelist (device_id);
CREATE INDEX idx_device_whitelist_channel ON public.device_whitelist (channel_id);

-- ---------------------------------------------------------------------------
-- 8) קישור מכשיר ↔ סרטון מאושר
-- ---------------------------------------------------------------------------
CREATE TABLE public.device_video_whitelist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES public.devices (id) ON DELETE CASCADE,
  video_id UUID NOT NULL REFERENCES public.whitelisted_videos (id) ON DELETE CASCADE,
  added_by UUID NOT NULL REFERENCES public.profiles (id),
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (device_id, video_id)
);

CREATE INDEX idx_device_video_whitelist_device ON public.device_video_whitelist (device_id);
CREATE INDEX idx_device_video_whitelist_video ON public.device_video_whitelist (video_id);

-- ---------------------------------------------------------------------------
-- 9) לוג פעילות
-- ---------------------------------------------------------------------------
CREATE TABLE public.activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  device_id UUID REFERENCES public.devices (id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (
    action IN (
      'block_enabled',
      'block_disabled',
      'channel_added',
      'channel_removed',
      'video_added',
      'video_removed',
      'device_linked',
      'device_removed',
      'settings_updated'
    )
  ),
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_activity_log_user ON public.activity_log (user_id);
CREATE INDEX idx_activity_log_device ON public.activity_log (device_id);
CREATE INDEX idx_activity_log_created ON public.activity_log (created_at DESC);

-- =============================================================================
-- Row Level Security (RLS)
-- =============================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parent_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whitelisted_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whitelisted_videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_whitelist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_video_whitelist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;

-- profiles
CREATE POLICY "profiles_select_own"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "profiles_update_own"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- parent_settings
CREATE POLICY "parent_settings_select_own"
  ON public.parent_settings FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "parent_settings_insert_own"
  ON public.parent_settings FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "parent_settings_update_own"
  ON public.parent_settings FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- subscriptions (עדכון מ-webhook בדרך כלל דרך service role; כאן רק צפייה/עדכון ע"י בעלים)
CREATE POLICY "subscriptions_select_own"
  ON public.subscriptions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "subscriptions_update_own"
  ON public.subscriptions FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- devices
CREATE POLICY "devices_all_own"
  ON public.devices FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- קטלוג ערוצים משותף — קריאה והוספה למשתמשים מחוברים
CREATE POLICY "whitelisted_channels_select_authenticated"
  ON public.whitelisted_channels FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "whitelisted_channels_insert_authenticated"
  ON public.whitelisted_channels FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- קטלוג סרטונים — אותה לוגיקה
CREATE POLICY "whitelisted_videos_select_authenticated"
  ON public.whitelisted_videos FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "whitelisted_videos_insert_authenticated"
  ON public.whitelisted_videos FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- device_whitelist — רק מכשירים של המשתמש; added_by חייב להיות המשתמש
CREATE POLICY "device_whitelist_select_own_devices"
  ON public.device_whitelist FOR SELECT
  TO authenticated
  USING (
    device_id IN (SELECT d.id FROM public.devices d WHERE d.user_id = auth.uid())
  );

CREATE POLICY "device_whitelist_insert_own_devices"
  ON public.device_whitelist FOR INSERT
  TO authenticated
  WITH CHECK (
    added_by = auth.uid()
    AND device_id IN (SELECT d.id FROM public.devices d WHERE d.user_id = auth.uid())
  );

CREATE POLICY "device_whitelist_delete_own_devices"
  ON public.device_whitelist FOR DELETE
  TO authenticated
  USING (
    device_id IN (SELECT d.id FROM public.devices d WHERE d.user_id = auth.uid())
  );

CREATE POLICY "device_whitelist_update_own_devices"
  ON public.device_whitelist FOR UPDATE
  TO authenticated
  USING (
    device_id IN (SELECT d.id FROM public.devices d WHERE d.user_id = auth.uid())
  )
  WITH CHECK (
    added_by = auth.uid()
    AND device_id IN (SELECT d.id FROM public.devices d WHERE d.user_id = auth.uid())
  );

-- device_video_whitelist
CREATE POLICY "device_video_whitelist_select_own_devices"
  ON public.device_video_whitelist FOR SELECT
  TO authenticated
  USING (
    device_id IN (SELECT d.id FROM public.devices d WHERE d.user_id = auth.uid())
  );

CREATE POLICY "device_video_whitelist_insert_own_devices"
  ON public.device_video_whitelist FOR INSERT
  TO authenticated
  WITH CHECK (
    added_by = auth.uid()
    AND device_id IN (SELECT d.id FROM public.devices d WHERE d.user_id = auth.uid())
  );

CREATE POLICY "device_video_whitelist_delete_own_devices"
  ON public.device_video_whitelist FOR DELETE
  TO authenticated
  USING (
    device_id IN (SELECT d.id FROM public.devices d WHERE d.user_id = auth.uid())
  );

CREATE POLICY "device_video_whitelist_update_own_devices"
  ON public.device_video_whitelist FOR UPDATE
  TO authenticated
  USING (
    device_id IN (SELECT d.id FROM public.devices d WHERE d.user_id = auth.uid())
  )
  WITH CHECK (
    added_by = auth.uid()
    AND device_id IN (SELECT d.id FROM public.devices d WHERE d.user_id = auth.uid())
  );

-- activity_log
CREATE POLICY "activity_log_select_own"
  ON public.activity_log FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "activity_log_insert_own"
  ON public.activity_log FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- =============================================================================
-- Realtime (אופציונלי — להפעיל אם רוצים עדכונים חיים בלקוח)
-- =============================================================================
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.devices;
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.device_whitelist;
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.device_video_whitelist;
