-- LOCAL-ONLY helper for the isolated permissions test page. Never copy to production.
BEGIN;
CREATE FUNCTION public.permission_test_list_users()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_result jsonb;
BEGIN
  SELECT pg_catalog.lower(pg_catalog.btrim(p.role))
    INTO v_actor_role
    FROM public.profiles p
   WHERE p.id = v_actor_id;

  IF v_actor_id IS NULL OR v_actor_role IS DISTINCT FROM 'administrador' THEN
    RAISE EXCEPTION 'PERMISSION_TEST_ADMIN_REQUIRED' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', p.id,
        'username', p.username,
        'name', p.name,
        'email', p.email,
        'role', pg_catalog.lower(pg_catalog.btrim(p.role))
      ) ORDER BY p.role, p.username
    ), '[]'::jsonb
  )
  INTO v_result
  FROM public.profiles p;

  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.permission_test_list_users() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.permission_test_list_users() TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
