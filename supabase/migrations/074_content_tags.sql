-- =============================================================================
-- 074: Neutral content tag catalog + per-device taste & channel tagging
-- Additive only — does not alter whitelist or playback RPC behavior except
-- extending child_get_allowed_channels with an optional tags JSON array.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.content_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL,
  label TEXT,
  icon_key TEXT NOT NULL DEFAULT 'tag',
  color_token TEXT NOT NULL DEFAULT 'tag-sky',
  scope TEXT NOT NULL DEFAULT 'system'
    CHECK (scope IN ('system', 'family')),
  owner_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  sort_order INT NOT NULL DEFAULT 100,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT content_tags_slug_unique UNIQUE (slug),
  CONSTRAINT content_tags_family_owner_chk CHECK (
    (scope = 'system' AND owner_user_id IS NULL AND label IS NULL)
    OR (scope = 'family' AND owner_user_id IS NOT NULL AND label IS NOT NULL AND btrim(label) <> '')
  )
);

CREATE INDEX IF NOT EXISTS idx_content_tags_scope_active
  ON public.content_tags (scope, is_active, sort_order);

CREATE INDEX IF NOT EXISTS idx_content_tags_owner
  ON public.content_tags (owner_user_id)
  WHERE scope = 'family';

CREATE TABLE IF NOT EXISTS public.device_tag_preferences (
  device_id UUID NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES public.content_tags(id) ON DELETE CASCADE,
  weight SMALLINT NOT NULL DEFAULT 0
    CHECK (weight BETWEEN -2 AND 2),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_device_tag_preferences_device
  ON public.device_tag_preferences (device_id);

CREATE TABLE IF NOT EXISTS public.device_channel_tags (
  device_id UUID NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES public.whitelisted_channels(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES public.content_tags(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'parent'
    CHECK (source IN ('parent', 'suggested', 'imported')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, channel_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_device_channel_tags_device_channel
  ON public.device_channel_tags (device_id, channel_id);

CREATE INDEX IF NOT EXISTS idx_device_channel_tags_device_tag
  ON public.device_channel_tags (device_id, tag_id);

-- ---------------------------------------------------------------------------
-- 2) Seed system tags (neutral subject matter — no ideology baked in)
-- ---------------------------------------------------------------------------

INSERT INTO public.content_tags (slug, icon_key, color_token, scope, sort_order, is_active)
VALUES
  ('science',       'microscope', 'tag-sky',     'system', 10,  TRUE),
  ('nature',        'leaf',       'tag-sage',    'system', 20,  TRUE),
  ('art',           'palette',    'tag-violet',  'system', 30,  TRUE),
  ('history',       'landmark',   'tag-amber',     'system', 40,  TRUE),
  ('stories',       'book-open',  'tag-rose',    'system', 50,  TRUE),
  ('music',         'music',      'tag-indigo',  'system', 60,  TRUE),
  ('math',          'calculator', 'tag-teal',    'system', 70,  TRUE),
  ('sports',        'trophy',     'tag-orange',  'system', 80,  TRUE),
  ('crafts',        'scissors',   'tag-pink',    'system', 90,  TRUE),
  ('languages',     'languages',  'tag-cyan',    'system', 100, TRUE),
  ('documentaries', 'film',       'tag-stone',   'system', 110, TRUE),
  ('humor',         'smile',      'tag-lime',    'system', 120, TRUE)
ON CONFLICT (slug) DO UPDATE SET
  icon_key = EXCLUDED.icon_key,
  color_token = EXCLUDED.color_token,
  sort_order = EXCLUDED.sort_order,
  is_active = TRUE,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- 3) RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.content_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_tag_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_channel_tags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS content_tags_select ON public.content_tags;
CREATE POLICY content_tags_select ON public.content_tags
  FOR SELECT TO authenticated
  USING (
    is_active = TRUE
    AND (scope = 'system' OR owner_user_id = auth.uid())
  );

DROP POLICY IF EXISTS content_tags_family_mutate ON public.content_tags;
CREATE POLICY content_tags_family_mutate ON public.content_tags
  FOR ALL TO authenticated
  USING (scope = 'family' AND owner_user_id = auth.uid())
  WITH CHECK (scope = 'family' AND owner_user_id = auth.uid());

DROP POLICY IF EXISTS device_tag_preferences_owner ON public.device_tag_preferences;
CREATE POLICY device_tag_preferences_owner ON public.device_tag_preferences
  FOR ALL TO authenticated
  USING (
    device_id IN (SELECT d.id FROM public.devices d WHERE d.user_id = auth.uid())
  )
  WITH CHECK (
    device_id IN (SELECT d.id FROM public.devices d WHERE d.user_id = auth.uid())
  );

DROP POLICY IF EXISTS device_channel_tags_owner ON public.device_channel_tags;
CREATE POLICY device_channel_tags_owner ON public.device_channel_tags
  FOR ALL TO authenticated
  USING (
    device_id IN (SELECT d.id FROM public.devices d WHERE d.user_id = auth.uid())
  )
  WITH CHECK (
    device_id IN (SELECT d.id FROM public.devices d WHERE d.user_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- 4) Helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._device_id_from_child_token(p_access_token UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT d.id
  FROM public.devices d
  WHERE d.child_access_token = p_access_token
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public._content_tag_json(ct public.content_tags)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_build_object(
    'tag_id', ct.id,
    'slug', ct.slug,
    'label', ct.label,
    'icon_key', ct.icon_key,
    'color_token', ct.color_token,
    'scope', ct.scope,
    'sort_order', ct.sort_order
  );
$$;

CREATE OR REPLACE FUNCTION public._assert_channel_on_device(p_device_id UUID, p_channel_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.device_whitelist dw
    WHERE dw.device_id = p_device_id
      AND dw.channel_id = p_channel_id
  ) THEN
    RAISE EXCEPTION 'CHANNEL_NOT_ON_DEVICE';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5) Catalog RPCs
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.list_content_tags()
RETURNS TABLE (
  tag_id UUID,
  slug TEXT,
  label TEXT,
  icon_key TEXT,
  color_token TEXT,
  scope TEXT,
  sort_order INT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    ct.id,
    ct.slug,
    ct.label,
    ct.icon_key,
    ct.color_token,
    ct.scope,
    ct.sort_order
  FROM public.content_tags ct
  WHERE ct.is_active = TRUE
    AND (
      ct.scope = 'system'
      OR (ct.scope = 'family' AND ct.owner_user_id = auth.uid())
    )
  ORDER BY ct.sort_order ASC, ct.slug ASC;
$$;

REVOKE ALL ON FUNCTION public.list_content_tags() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_content_tags() TO authenticated;

CREATE OR REPLACE FUNCTION public.parent_create_family_tag(
  p_label TEXT,
  p_icon_key TEXT DEFAULT 'star',
  p_color_token TEXT DEFAULT 'tag-violet'
)
RETURNS public.content_tags
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_label TEXT;
  v_slug TEXT;
  v_row public.content_tags%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  v_label := btrim(COALESCE(p_label, ''));
  IF length(v_label) < 1 OR length(v_label) > 40 THEN
    RAISE EXCEPTION 'INVALID_FAMILY_TAG_LABEL';
  END IF;

  v_slug := 'family_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);

  INSERT INTO public.content_tags (slug, label, icon_key, color_token, scope, owner_user_id, sort_order)
  VALUES (
    v_slug,
    v_label,
    COALESCE(NULLIF(btrim(p_icon_key), ''), 'star'),
    COALESCE(NULLIF(btrim(p_color_token), ''), 'tag-violet'),
    'family',
    auth.uid(),
    1000
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.parent_create_family_tag(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.parent_create_family_tag(TEXT, TEXT, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6) Device content preference RPCs (authenticated parent + internal impl)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._get_device_content_prefs_impl(
  p_device_id UUID,
  p_owner_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_out JSONB;
BEGIN
  SELECT jsonb_build_object(
    'tag_preferences', COALESCE((
      SELECT jsonb_agg(
        public._content_tag_json(ct) || jsonb_build_object('weight', dtp.weight)
        ORDER BY ct.sort_order, ct.slug
      )
      FROM public.device_tag_preferences dtp
      JOIN public.content_tags ct ON ct.id = dtp.tag_id
      WHERE dtp.device_id = p_device_id
        AND ct.is_active = TRUE
        AND (ct.scope = 'system' OR ct.owner_user_id = p_owner_user_id)
    ), '[]'::jsonb),
    'channel_tags', COALESCE((
      SELECT jsonb_agg(row_obj ORDER BY row_obj->>'channel_id')
      FROM (
        SELECT jsonb_build_object(
          'channel_id', dct.channel_id,
          'tags', jsonb_agg(public._content_tag_json(ct) ORDER BY ct.sort_order, ct.slug)
        ) AS row_obj
        FROM public.device_channel_tags dct
        JOIN public.content_tags ct ON ct.id = dct.tag_id
        WHERE dct.device_id = p_device_id
          AND ct.is_active = TRUE
          AND (ct.scope = 'system' OR ct.owner_user_id = p_owner_user_id)
        GROUP BY dct.channel_id
      ) s
    ), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END;
$$;

CREATE OR REPLACE FUNCTION public.parent_get_device_content_prefs(p_device_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._assert_device_owner(p_device_id);
  RETURN public._get_device_content_prefs_impl(p_device_id, auth.uid());
END;
$$;

REVOKE ALL ON FUNCTION public.parent_get_device_content_prefs(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.parent_get_device_content_prefs(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public._update_device_tag_preferences_impl(
  p_device_id UUID,
  p_owner_user_id UUID,
  p_preferences JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item JSONB;
  v_tag_id UUID;
  v_weight INT;
BEGIN
  IF p_preferences IS NULL OR jsonb_typeof(p_preferences) <> 'array' THEN
    RAISE EXCEPTION 'INVALID_TAG_PREFERENCES';
  END IF;

  DELETE FROM public.device_tag_preferences
  WHERE device_id = p_device_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_preferences)
  LOOP
    v_tag_id := NULLIF(v_item->>'tag_id', '')::UUID;
    v_weight := COALESCE((v_item->>'weight')::INT, 0);

    IF v_tag_id IS NULL THEN
      CONTINUE;
    END IF;

    IF v_weight < -2 OR v_weight > 2 THEN
      RAISE EXCEPTION 'INVALID_TAG_WEIGHT';
    END IF;

    IF v_weight = 0 THEN
      CONTINUE;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.content_tags ct
      WHERE ct.id = v_tag_id
        AND ct.is_active = TRUE
        AND (ct.scope = 'system' OR ct.owner_user_id = p_owner_user_id)
    ) THEN
      RAISE EXCEPTION 'TAG_NOT_FOUND';
    END IF;

    INSERT INTO public.device_tag_preferences (device_id, tag_id, weight, updated_at)
    VALUES (p_device_id, v_tag_id, v_weight, now())
    ON CONFLICT (device_id, tag_id) DO UPDATE
      SET weight = EXCLUDED.weight, updated_at = now();
  END LOOP;

  RETURN public._get_device_content_prefs_impl(p_device_id, p_owner_user_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.parent_update_device_tag_preferences(
  p_device_id UUID,
  p_preferences JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._assert_device_owner(p_device_id);
  RETURN public._update_device_tag_preferences_impl(p_device_id, auth.uid(), p_preferences);
END;
$$;

REVOKE ALL ON FUNCTION public.parent_update_device_tag_preferences(UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.parent_update_device_tag_preferences(UUID, JSONB) TO authenticated;

CREATE OR REPLACE FUNCTION public._set_channel_tags_impl(
  p_device_id UUID,
  p_owner_user_id UUID,
  p_channel_id UUID,
  p_tag_ids UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tag_id UUID;
BEGIN
  PERFORM public._assert_channel_on_device(p_device_id, p_channel_id);

  DELETE FROM public.device_channel_tags
  WHERE device_id = p_device_id
    AND channel_id = p_channel_id;

  IF p_tag_ids IS NULL OR array_length(p_tag_ids, 1) IS NULL THEN
    RETURN public._get_device_content_prefs_impl(p_device_id, p_owner_user_id);
  END IF;

  FOREACH v_tag_id IN ARRAY p_tag_ids
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.content_tags ct
      WHERE ct.id = v_tag_id
        AND ct.is_active = TRUE
        AND (ct.scope = 'system' OR ct.owner_user_id = p_owner_user_id)
    ) THEN
      RAISE EXCEPTION 'TAG_NOT_FOUND';
    END IF;

    INSERT INTO public.device_channel_tags (device_id, channel_id, tag_id, source)
    VALUES (p_device_id, p_channel_id, v_tag_id, 'parent')
    ON CONFLICT (device_id, channel_id, tag_id) DO NOTHING;
  END LOOP;

  RETURN public._get_device_content_prefs_impl(p_device_id, p_owner_user_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.parent_set_channel_tags(
  p_device_id UUID,
  p_channel_id UUID,
  p_tag_ids UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._assert_device_owner(p_device_id);
  RETURN public._set_channel_tags_impl(p_device_id, auth.uid(), p_channel_id, p_tag_ids);
END;
$$;

REVOKE ALL ON FUNCTION public.parent_set_channel_tags(UUID, UUID, UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.parent_set_channel_tags(UUID, UUID, UUID[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.parent_bulk_set_channel_tags(
  p_device_id UUID,
  p_channel_ids UUID[],
  p_tag_ids UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_channel_id UUID;
  v_owner UUID;
BEGIN
  PERFORM public._assert_device_owner(p_device_id);
  v_owner := auth.uid();

  IF p_channel_ids IS NULL OR array_length(p_channel_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'INVALID_CHANNEL_IDS';
  END IF;

  FOREACH v_channel_id IN ARRAY p_channel_ids
  LOOP
    PERFORM public._set_channel_tags_impl(p_device_id, v_owner, v_channel_id, p_tag_ids);
  END LOOP;

  RETURN public._get_device_content_prefs_impl(p_device_id, v_owner);
END;
$$;

REVOKE ALL ON FUNCTION public.parent_bulk_set_channel_tags(UUID, UUID[], UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.parent_bulk_set_channel_tags(UUID, UUID[], UUID[]) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7) Local-parent RPCs (child device token session)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.local_parent_get_device_content_prefs(p_access_token UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_device_id UUID;
  v_owner UUID;
BEGIN
  SELECT d.id, d.user_id INTO v_device_id, v_owner
  FROM public.devices d
  WHERE d.child_access_token = p_access_token
  LIMIT 1;

  IF v_device_id IS NULL OR v_owner IS NULL THEN
    RAISE EXCEPTION 'INVALID_LOCAL_PARENT_TOKEN';
  END IF;

  RETURN public._get_device_content_prefs_impl(v_device_id, v_owner);
END;
$$;

REVOKE ALL ON FUNCTION public.local_parent_get_device_content_prefs(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.local_parent_get_device_content_prefs(UUID) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.local_parent_update_device_tag_preferences(
  p_access_token UUID,
  p_preferences JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_device_id UUID;
  v_owner UUID;
BEGIN
  SELECT d.id, d.user_id INTO v_device_id, v_owner
  FROM public.devices d
  WHERE d.child_access_token = p_access_token
  LIMIT 1;

  IF v_device_id IS NULL OR v_owner IS NULL THEN
    RAISE EXCEPTION 'INVALID_LOCAL_PARENT_TOKEN';
  END IF;

  RETURN public._update_device_tag_preferences_impl(v_device_id, v_owner, p_preferences);
END;
$$;

REVOKE ALL ON FUNCTION public.local_parent_update_device_tag_preferences(UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.local_parent_update_device_tag_preferences(UUID, JSONB) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.local_parent_set_channel_tags(
  p_access_token UUID,
  p_channel_id UUID,
  p_tag_ids UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_device_id UUID;
  v_owner UUID;
BEGIN
  SELECT d.id, d.user_id INTO v_device_id, v_owner
  FROM public.devices d
  WHERE d.child_access_token = p_access_token
  LIMIT 1;

  IF v_device_id IS NULL OR v_owner IS NULL THEN
    RAISE EXCEPTION 'INVALID_LOCAL_PARENT_TOKEN';
  END IF;

  RETURN public._set_channel_tags_impl(v_device_id, v_owner, p_channel_id, p_tag_ids);
END;
$$;

REVOKE ALL ON FUNCTION public.local_parent_set_channel_tags(UUID, UUID, UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.local_parent_set_channel_tags(UUID, UUID, UUID[]) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.local_parent_bulk_set_channel_tags(
  p_access_token UUID,
  p_channel_ids UUID[],
  p_tag_ids UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_device_id UUID;
  v_owner UUID;
  v_channel_id UUID;
BEGIN
  SELECT d.id, d.user_id INTO v_device_id, v_owner
  FROM public.devices d
  WHERE d.child_access_token = p_access_token
  LIMIT 1;

  IF v_device_id IS NULL OR v_owner IS NULL THEN
    RAISE EXCEPTION 'INVALID_LOCAL_PARENT_TOKEN';
  END IF;

  IF p_channel_ids IS NULL OR array_length(p_channel_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'INVALID_CHANNEL_IDS';
  END IF;

  FOREACH v_channel_id IN ARRAY p_channel_ids
  LOOP
    PERFORM public._set_channel_tags_impl(v_device_id, v_owner, v_channel_id, p_tag_ids);
  END LOOP;

  RETURN public._get_device_content_prefs_impl(v_device_id, v_owner);
END;
$$;

REVOKE ALL ON FUNCTION public.local_parent_bulk_set_channel_tags(UUID, UUID[], UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.local_parent_bulk_set_channel_tags(UUID, UUID[], UUID[]) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.local_parent_create_family_tag(
  p_access_token UUID,
  p_label TEXT,
  p_icon_key TEXT DEFAULT 'star',
  p_color_token TEXT DEFAULT 'tag-violet'
)
RETURNS public.content_tags
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_device_id UUID;
  v_owner UUID;
  v_label TEXT;
  v_slug TEXT;
  v_row public.content_tags%ROWTYPE;
BEGIN
  v_device_id := public._device_id_from_child_token(p_access_token);
  IF v_device_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_LOCAL_PARENT_TOKEN';
  END IF;

  SELECT d.user_id INTO v_owner FROM public.devices d WHERE d.id = v_device_id;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'DEVICE_NOT_FOUND';
  END IF;

  v_label := btrim(COALESCE(p_label, ''));
  IF length(v_label) < 1 OR length(v_label) > 40 THEN
    RAISE EXCEPTION 'INVALID_FAMILY_TAG_LABEL';
  END IF;

  v_slug := 'family_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);

  INSERT INTO public.content_tags (slug, label, icon_key, color_token, scope, owner_user_id, sort_order)
  VALUES (
    v_slug,
    v_label,
    COALESCE(NULLIF(btrim(p_icon_key), ''), 'star'),
    COALESCE(NULLIF(btrim(p_color_token), ''), 'tag-violet'),
    'family',
    v_owner,
    1000
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.local_parent_create_family_tag(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.local_parent_create_family_tag(UUID, TEXT, TEXT, TEXT) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8) Extend child_get_allowed_channels — additive tags JSON column
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.child_get_allowed_channels(UUID);

CREATE OR REPLACE FUNCTION public.child_get_allowed_channels(p_access_token UUID)
RETURNS TABLE (
  channel_id UUID,
  youtube_channel_id TEXT,
  channel_name TEXT,
  category TEXT,
  channel_thumbnail TEXT,
  subscriber_count TEXT,
  videos_cache_has_more BOOLEAN,
  videos_cache_next_page_token TEXT,
  videos_cache_uploads_playlist_id TEXT,
  tags JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_device_id UUID;
  v_owner UUID;
BEGIN
  SELECT d.id, d.user_id INTO v_device_id, v_owner
  FROM public.devices d
  WHERE d.child_access_token = p_access_token
  LIMIT 1;

  IF v_device_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    wc.id,
    wc.youtube_channel_id,
    wc.channel_name,
    wc.category,
    wc.channel_thumbnail,
    wc.subscriber_count,
    COALESCE(wc.videos_cache_has_more, false),
    wc.videos_cache_next_page_token,
    wc.videos_cache_uploads_playlist_id,
    COALESCE((
      SELECT jsonb_agg(public._content_tag_json(ct) ORDER BY ct.sort_order, ct.slug)
      FROM public.device_channel_tags dct
      JOIN public.content_tags ct ON ct.id = dct.tag_id
      WHERE dct.device_id = v_device_id
        AND dct.channel_id = wc.id
        AND ct.is_active = TRUE
        AND (ct.scope = 'system' OR ct.owner_user_id = v_owner)
    ), '[]'::jsonb) AS tags
  FROM public.device_whitelist dw
  JOIN public.whitelisted_channels wc ON wc.id = dw.channel_id
  WHERE dw.device_id = v_device_id
  ORDER BY dw.added_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.child_get_allowed_channels(UUID) TO anon, authenticated;
