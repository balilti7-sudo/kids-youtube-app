-- App uses direct profiles SELECT/UPDATE for PIN changes (no RPC).
-- Safe to run even if 025 was never applied.

DROP TRIGGER IF EXISTS profiles_guard_parent_pin ON public.profiles;
DROP FUNCTION IF EXISTS public.profiles_guard_parent_pin_update();
DROP FUNCTION IF EXISTS public.change_parent_pin(text, text);
DROP FUNCTION IF EXISTS public._profile_resolved_parent_pin(text, text);
