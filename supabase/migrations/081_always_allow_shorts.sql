-- Always allow Shorts for every child profile (blocking removed app-wide).

UPDATE public.devices
SET allow_shorts = true
WHERE allow_shorts IS DISTINCT FROM true;

ALTER TABLE public.devices
  ALTER COLUMN allow_shorts SET DEFAULT true;

COMMENT ON COLUMN public.devices.allow_shorts IS
  'When false, Shorts are blocked. App currently forces Shorts allowed (SHORTS_BLOCKING_ENABLED = false).';
