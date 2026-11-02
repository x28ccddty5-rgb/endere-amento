DO $verify$
DECLARE
  v_catalog integer; v_roles integer; v_distinct integer;
  v_base oid := to_regprocedure('public.apply_stock_mutation_atomic(jsonb,jsonb,jsonb,jsonb,jsonb,text)');
  v_delete oid := to_regprocedure('public.apply_stock_mutation_atomic_with_deletes(jsonb,jsonb,jsonb,jsonb,jsonb,text[],text)');
  v_old_base oid := to_regprocedure('public.apply_stock_mutation_atomic(jsonb,jsonb,jsonb,jsonb,jsonb)');
  v_old_delete oid := to_regprocedure('public.apply_stock_mutation_atomic_with_deletes(jsonb,jsonb,jsonb,jsonb,jsonb,text[])');
BEGIN
  SELECT count(*) INTO v_catalog FROM public.permission_catalog WHERE is_active IS TRUE;
  SELECT count(*) INTO v_roles FROM public.role_permissions;
  SELECT count(DISTINCT (role, permission_key)) INTO v_distinct FROM public.role_permissions;
  IF v_catalog <> 29 OR v_roles <> 116 OR v_distinct <> 116 THEN RAISE EXCEPTION 'B7_1_MATRIX_CHANGED'; END IF;
  IF v_base IS NULL OR v_delete IS NULL OR v_old_base IS NULL OR v_old_delete IS NULL THEN RAISE EXCEPTION 'B7_1_FUNCTION_SET_INVALID'; END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid=v_base) OR NOT (SELECT prosecdef FROM pg_proc WHERE oid=v_delete) THEN RAISE EXCEPTION 'B7_1_TYPED_WRITERS_NOT_SECURITY_DEFINER'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=v_base AND COALESCE(array_to_string(p.proconfig,','),'') LIKE '%search_path=""%') OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=v_delete AND COALESCE(array_to_string(p.proconfig,','),'') LIKE '%search_path=""%') THEN RAISE EXCEPTION 'B7_1_TYPED_WRITER_SEARCH_PATH_INVALID'; END IF;
  IF NOT has_function_privilege('authenticated',v_base,'EXECUTE') OR NOT has_function_privilege('authenticated',v_delete,'EXECUTE') THEN RAISE EXCEPTION 'B7_1_AUTHENTICATED_TYPED_EXECUTE_MISSING'; END IF;
  IF has_function_privilege('anon',v_base,'EXECUTE') OR has_function_privilege('anon',v_delete,'EXECUTE') THEN RAISE EXCEPTION 'B7_1_ANON_TYPED_EXECUTE_MUST_BE_DENIED'; END IF;
  IF has_function_privilege('authenticated',v_old_base,'EXECUTE') OR has_function_privilege('authenticated',v_old_delete,'EXECUTE') THEN RAISE EXCEPTION 'B7_1_LEGACY_UNTYPED_WRITER_STILL_EXECUTABLE'; END IF;
  IF position('PERMISSION_DENIED:stock.launch.create' in pg_get_functiondef(v_base)) = 0 OR position('PERMISSION_DENIED:stock.transfer.create' in pg_get_functiondef(v_base)) = 0 OR position('PERMISSION_DENIED:stock.physical_correction' in pg_get_functiondef(v_base)) = 0 THEN RAISE EXCEPTION 'B7_1_BASE_PERMISSION_GATES_MISSING'; END IF;
  IF position('PERMISSION_DENIED:stock.launch.create' in pg_get_functiondef(v_delete)) = 0 OR position('PERMISSION_DENIED:stock.transfer.create' in pg_get_functiondef(v_delete)) = 0 OR position('PERMISSION_DENIED:stock.physical_correction' in pg_get_functiondef(v_delete)) = 0 THEN RAISE EXCEPTION 'B7_1_DELETE_PERMISSION_GATES_MISSING'; END IF;
  IF position('TRANSFER_PAYLOAD_SHAPE_INVALID' in pg_get_functiondef(v_base)) = 0 OR position('SINGLE_SCOPE_OPERATION_REQUIRED' in pg_get_functiondef(v_base)) = 0 OR position('PHYSICAL_CORRECTION_AUDIT_MARKER_REQUIRED' in pg_get_functiondef(v_base)) = 0 THEN RAISE EXCEPTION 'B7_1_OPERATION_SHAPE_GUARDS_MISSING'; END IF;
  IF position('STOCK_OPERATION_TYPE_REQUIRED' in pg_get_functiondef(v_old_base)) = 0 OR position('STOCK_OPERATION_TYPE_REQUIRED' in pg_get_functiondef(v_old_delete)) = 0 THEN RAISE EXCEPTION 'B7_1_LEGACY_SIGNATURE_NOT_FAIL_CLOSED'; END IF;
END;
$verify$;

SELECT proname, oid::regprocedure AS signature, prosecdef AS security_definer, proconfig
FROM pg_proc WHERE oid IN (
  to_regprocedure('public.apply_stock_mutation_atomic(jsonb,jsonb,jsonb,jsonb,jsonb,text)'),
  to_regprocedure('public.apply_stock_mutation_atomic_with_deletes(jsonb,jsonb,jsonb,jsonb,jsonb,text[],text)'),
  to_regprocedure('public.apply_stock_mutation_atomic(jsonb,jsonb,jsonb,jsonb,jsonb)'),
  to_regprocedure('public.apply_stock_mutation_atomic_with_deletes(jsonb,jsonb,jsonb,jsonb,jsonb,text[])')
) ORDER BY proname, oid;
