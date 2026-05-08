-- Optional alias column for management gate parity (legacy naming / dashboards).
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS access_code text;

COMMENT ON COLUMN public.profiles.access_code IS
  'Optional; clients verify parental management gate against parent_pin or access_code when set. Prefer parent_pin.';
