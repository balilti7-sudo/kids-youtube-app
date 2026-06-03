-- Expand educational break interval choices (minutes).

ALTER TABLE public.devices
  DROP CONSTRAINT IF EXISTS devices_break_interval_minutes_check;

ALTER TABLE public.devices
  ADD CONSTRAINT devices_break_interval_minutes_check
  CHECK (break_interval_minutes IN (5, 10, 15, 30, 45, 60));

CREATE OR REPLACE FUNCTION public._normalize_break_interval_minutes(raw INT)
RETURNS INT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN raw IN (5, 10, 15, 30, 45, 60) THEN raw
    WHEN raw = 2 THEN 15
    WHEN raw = 3 THEN 30
    ELSE 30
  END;
$$;
