-- READ-ONLY PREFLIGHT. Run only against the intended isolated local/test database.
-- This script does not change schema or data.
SELECT
  pg_catalog.to_regclass('public.profiles') IS NOT NULL AS profiles_table_exists,
  EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') AS anon_role_exists,
  EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') AS authenticated_role_exists,
  pg_catalog.to_regprocedure('auth.uid()') IS NOT NULL AS auth_uid_function_exists,
  (SELECT count(*) = 4 FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'profiles'
     AND column_name IN ('id', 'role', 'username', 'name')) AS required_profile_columns_exist;

-- legacy_lideranca_profiles is informational during transition: existing legacy rows may remain.
-- The new permission foundation grants no matrix permissions to Liderança and does not rewrite profiles.
SELECT
  (SELECT count(*) FROM public.profiles WHERE lower(btrim(role)) = 'administrador') AS administrator_profiles,
  (SELECT count(*) FROM public.profiles WHERE lower(btrim(role)) = 'lideranca') AS legacy_lideranca_profiles,
  (SELECT count(*) FROM public.profiles WHERE lower(btrim(role)) NOT IN ('administrador','lideranca','apoio','producao','visualizador')) AS unknown_role_profiles,
  (SELECT count(*) FROM public.profiles) AS total_profiles;

SELECT lower(btrim(role)) AS role, count(*) AS users
FROM public.profiles
GROUP BY lower(btrim(role))
ORDER BY role;
