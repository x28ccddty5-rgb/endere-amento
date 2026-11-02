-- LOCAL-ONLY COMPATIBILITY MIGRATION for the main app login smoke test.
-- This migration belongs ONLY to docs/seguranca/permission-sandbox.
-- It must never be copied to the production Supabase migration directory.
-- The app reads the authenticated user's own profile after successful Auth login.
-- Grant only the identity columns required by the app; RLS still restricts rows to auth.uid().
BEGIN;

DO $preflight$
BEGIN
  IF pg_catalog.to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'PERMISSION_TEST_PROFILES_TABLE_MISSING';
  END IF;
  IF pg_catalog.to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION 'PERMISSION_TEST_AUTH_UID_MISSING';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    RAISE EXCEPTION 'PERMISSION_TEST_AUTHENTICATED_ROLE_MISSING';
  END IF;
END;
$preflight$;

-- Current app builds in this project have queried both `name` and `full_name`.
-- Keep a local-only compatibility column so the sandbox matches either query shape.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS full_name text;

UPDATE public.profiles
   SET full_name = name
 WHERE full_name IS NULL;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Deliberately grant SELECT only on identity columns used by the app.
-- No INSERT/UPDATE/DELETE privileges are granted to authenticated clients.
GRANT SELECT (id, username, name, full_name, role)
  ON TABLE public.profiles TO authenticated;

-- The app can read only its own profile, never the profile list.
DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
CREATE POLICY profiles_select_own
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (id = (SELECT auth.uid()));

NOTIFY pgrst, 'reload schema';
COMMIT;
