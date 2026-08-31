-- App release policy: WhatsApp-style soft grace → hard lock after N days.
-- Single active row per platform; clients read via anon (public) SELECT / RPC.

CREATE TABLE IF NOT EXISTS public.app_release_policy (
  platform TEXT PRIMARY KEY CHECK (platform IN ('android', 'web', 'ios')),
  -- Newest published build the client should run.
  latest_version TEXT NOT NULL,
  -- Emergency floor: anything below this is hard-locked immediately (no grace).
  min_required_version TEXT NOT NULL,
  -- When latest_version was published (grace countdown starts here).
  released_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  grace_period_days INTEGER NOT NULL DEFAULT 14 CHECK (grace_period_days >= 0 AND grace_period_days <= 365),
  -- Play Store / APK / download page.
  store_url TEXT NOT NULL,
  title_he TEXT NOT NULL DEFAULT 'יש עדכון חדש ל-SafeTube',
  message_he TEXT NOT NULL DEFAULT 'גרסה חדשה זמינה. מומלץ לעדכן כדי להמשיך ליהנות מהאפליקציה בבטחה.',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

COMMENT ON TABLE public.app_release_policy IS
  'Remote force-update policy. Soft dialog while within grace_period_days of released_at; hard lock after.';

CREATE OR REPLACE FUNCTION public.touch_app_release_policy_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := timezone('utc', now());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_app_release_policy_updated_at ON public.app_release_policy;
CREATE TRIGGER trg_app_release_policy_updated_at
  BEFORE UPDATE ON public.app_release_policy
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_app_release_policy_updated_at();

ALTER TABLE public.app_release_policy ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_release_policy_public_read ON public.app_release_policy;
CREATE POLICY app_release_policy_public_read
  ON public.app_release_policy
  FOR SELECT
  TO anon, authenticated
  USING (is_active = TRUE);

-- No INSERT/UPDATE/DELETE for anon/authenticated — manage via Dashboard / service role.

CREATE OR REPLACE FUNCTION public.get_app_release_policy(p_platform TEXT DEFAULT 'android')
RETURNS TABLE (
  platform TEXT,
  latest_version TEXT,
  min_required_version TEXT,
  released_at TIMESTAMPTZ,
  grace_period_days INTEGER,
  store_url TEXT,
  title_he TEXT,
  message_he TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.platform,
    p.latest_version,
    p.min_required_version,
    p.released_at,
    p.grace_period_days,
    p.store_url,
    p.title_he,
    p.message_he
  FROM public.app_release_policy p
  WHERE p.platform = lower(btrim(p_platform))
    AND p.is_active = TRUE
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_app_release_policy(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_app_release_policy(TEXT) TO anon, authenticated;

-- Seed: match current shipped Android build so deploy does not soft-prompt everyone.
-- To roll out an update: set latest_version + released_at = now(), keep min_required conservative.
INSERT INTO public.app_release_policy (
  platform,
  latest_version,
  min_required_version,
  released_at,
  grace_period_days,
  store_url,
  title_he,
  message_he,
  is_active
)
VALUES (
  'android',
  '1.1.39',
  '1.0.0',
  timezone('utc', now()),
  14,
  'https://play.google.com/store/apps/details?id=app.safetube.kids',
  'יש עדכון חדש ל-SafeTube',
  'גרסה חדשה זמינה. עדכנו את האפליקציה כדי להמשיך לצפות בבטחה. אחרי 14 ימים מהפרסום העדכון יהפוך לחובה.',
  TRUE
)
ON CONFLICT (platform) DO NOTHING;

INSERT INTO public.app_release_policy (
  platform,
  latest_version,
  min_required_version,
  released_at,
  grace_period_days,
  store_url,
  title_he,
  message_he,
  is_active
)
VALUES (
  'web',
  '1.1.39',
  '1.0.0',
  timezone('utc', now()),
  14,
  'https://safetube.app',
  'יש עדכון חדש ל-SafeTube',
  'גרסה חדשה זמינה בדפדפן. רעננו או התקינו מחדש כדי להמשיך.',
  TRUE
)
ON CONFLICT (platform) DO NOTHING;
