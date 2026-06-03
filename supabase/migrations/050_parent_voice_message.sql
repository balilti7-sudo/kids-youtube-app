-- Parent voice message: storage + parent_settings column + child RPC + Realtime.

ALTER TABLE public.parent_settings
  ADD COLUMN IF NOT EXISTS latest_parent_message TEXT,
  ADD COLUMN IF NOT EXISTS latest_parent_message_at TIMESTAMPTZ;

COMMENT ON COLUMN public.parent_settings.latest_parent_message IS
  'Public URL of the latest parent voice message (parent_messages/{user_id}/latest.webm).';

COMMENT ON COLUMN public.parent_settings.latest_parent_message_at IS
  'Timestamp when latest_parent_message was last updated — used for child dismiss / show-once.';

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'parent_messages',
  'parent_messages',
  TRUE,
  5242880,
  ARRAY['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS parent_messages_owner_insert ON storage.objects;
CREATE POLICY parent_messages_owner_insert
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'parent_messages'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS parent_messages_owner_update ON storage.objects;
CREATE POLICY parent_messages_owner_update
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'parent_messages'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'parent_messages'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS parent_messages_owner_delete ON storage.objects;
CREATE POLICY parent_messages_owner_delete
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'parent_messages'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS parent_messages_public_read ON storage.objects;
CREATE POLICY parent_messages_public_read
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'parent_messages');

CREATE OR REPLACE FUNCTION public.child_get_latest_parent_message(p_access_token UUID)
RETURNS TABLE (
  owner_user_id UUID,
  latest_parent_message TEXT,
  latest_parent_message_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  IF p_access_token IS NULL THEN
    RETURN;
  END IF;

  SELECT d.user_id
  INTO v_user_id
  FROM public.devices d
  WHERE d.child_access_token = p_access_token
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    ps.user_id,
    ps.latest_parent_message,
    ps.latest_parent_message_at
  FROM public.parent_settings ps
  WHERE ps.user_id = v_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.child_get_latest_parent_message(UUID) TO anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'parent_settings'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.parent_settings;
    END IF;
  END IF;
END $$;
