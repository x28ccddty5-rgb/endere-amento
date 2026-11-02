DO $verify$
DECLARE
  v_rpc_names text[] := ARRAY[
    'get_shared_lancamento_draft',
    'upsert_shared_lancamento_draft_lines',
    'delete_shared_lancamento_draft_line',
    'clear_shared_lancamento_draft',
    'get_shared_lancamento_batch_result',
    'process_shared_lancamento_draft_batch_atomic'
  ];
  v_rpc_count integer;
  v_table_count integer;
  v_bad_rpc_count integer;
  v_bad_table_count integer;
  v_quarantine_missing bigint;
  v_process_oid oid := to_regprocedure('public.process_shared_lancamento_draft_batch_atomic(uuid,uuid,bigint,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text[])');
  v_expected_permission_count integer;
BEGIN
  SELECT count(*) INTO v_table_count
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public'
    AND c.relname = ANY(ARRAY[
      'lancamento_draft_legacy_quarantine','lancamento_draft_control',
      'lancamento_draft_lines','lancamento_draft_archive_lines','lancamento_batch_runs'
    ]) AND c.relkind='r';
  IF v_table_count <> 5 THEN RAISE EXCEPTION 'SHARED_DRAFT_TABLE_SET_INVALID: %/5', v_table_count; END IF;

  SELECT count(*) INTO v_rpc_count
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname = ANY(v_rpc_names);
  IF v_rpc_count <> 6 THEN RAISE EXCEPTION 'SHARED_DRAFT_RPC_SET_INVALID: %/6', v_rpc_count; END IF;

  IF to_regprocedure('public.get_shared_lancamento_draft()') IS NULL
     OR to_regprocedure('public.upsert_shared_lancamento_draft_lines(uuid,jsonb)') IS NULL
     OR to_regprocedure('public.delete_shared_lancamento_draft_line(uuid,text,bigint)') IS NULL
     OR to_regprocedure('public.clear_shared_lancamento_draft(uuid,bigint)') IS NULL
     OR to_regprocedure('public.get_shared_lancamento_batch_result(uuid)') IS NULL
     OR v_process_oid IS NULL THEN
    RAISE EXCEPTION 'SHARED_DRAFT_RPC_SIGNATURE_SET_INVALID';
  END IF;

  SELECT count(*) INTO v_bad_table_count
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public'
    AND c.relname = ANY(ARRAY[
      'lancamento_draft_legacy_quarantine','lancamento_draft_control',
      'lancamento_draft_lines','lancamento_draft_archive_lines','lancamento_batch_runs'
    ])
    AND (c.relkind <> 'r' OR NOT c.relrowsecurity
      OR has_table_privilege('authenticated',c.oid,'SELECT')
      OR has_table_privilege('authenticated',c.oid,'INSERT')
      OR has_table_privilege('authenticated',c.oid,'UPDATE')
      OR has_table_privilege('authenticated',c.oid,'DELETE')
      OR has_table_privilege('authenticated',c.oid,'TRUNCATE')
      OR has_table_privilege('authenticated',c.oid,'REFERENCES')
      OR has_table_privilege('authenticated',c.oid,'TRIGGER')
      OR has_table_privilege('anon',c.oid,'SELECT')
      OR has_table_privilege('anon',c.oid,'INSERT')
      OR has_table_privilege('anon',c.oid,'UPDATE')
      OR has_table_privilege('anon',c.oid,'DELETE')
      OR has_table_privilege('anon',c.oid,'TRUNCATE')
      OR has_table_privilege('anon',c.oid,'REFERENCES')
      OR has_table_privilege('anon',c.oid,'TRIGGER')
      OR has_table_privilege('service_role',c.oid,'SELECT')
      OR has_table_privilege('service_role',c.oid,'INSERT')
      OR has_table_privilege('service_role',c.oid,'UPDATE')
      OR has_table_privilege('service_role',c.oid,'DELETE')
      OR has_table_privilege('service_role',c.oid,'TRUNCATE')
      OR has_table_privilege('service_role',c.oid,'REFERENCES')
      OR has_table_privilege('service_role',c.oid,'TRIGGER'));
  IF v_bad_table_count <> 0 THEN RAISE EXCEPTION 'SHARED_DRAFT_TABLE_SECURITY_INVALID: %', v_bad_table_count; END IF;

  SELECT count(*) INTO v_bad_rpc_count
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname = ANY(v_rpc_names)
    AND (NOT p.prosecdef
      OR NOT COALESCE(array_to_string(p.proconfig,','),'') LIKE '%search_path=""%'
      OR NOT has_function_privilege('authenticated',p.oid,'EXECUTE')
      OR has_function_privilege('anon',p.oid,'EXECUTE')
      OR has_function_privilege('service_role',p.oid,'EXECUTE'));
  IF v_bad_rpc_count <> 0 THEN RAISE EXCEPTION 'SHARED_DRAFT_RPC_SECURITY_INVALID: %', v_bad_rpc_count; END IF;

  SELECT count(*) INTO v_expected_permission_count
  FROM public.permission_catalog
  WHERE is_active IS TRUE
    AND permission_key = ANY(ARRAY['stock.launch.view','stock.launch.create','stock.batch.process']);
  IF v_expected_permission_count <> 3 THEN RAISE EXCEPTION 'SHARED_DRAFT_PERMISSION_CATALOG_INVALID'; END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname = ANY(v_rpc_names)
      AND position('has_app_role' in p.prosrc) > 0
  ) THEN RAISE EXCEPTION 'SHARED_DRAFT_LEGACY_ROLE_GUARD_REMAINS'; END IF;

  IF position('stock.launch.view' in pg_get_functiondef(to_regprocedure('public.get_shared_lancamento_draft()'))) = 0
     OR position('stock.launch.create' in pg_get_functiondef(to_regprocedure('public.upsert_shared_lancamento_draft_lines(uuid,jsonb)'))) = 0
     OR position('stock.launch.create' in pg_get_functiondef(to_regprocedure('public.delete_shared_lancamento_draft_line(uuid,text,bigint)'))) = 0
     OR position('stock.launch.create' in pg_get_functiondef(to_regprocedure('public.clear_shared_lancamento_draft(uuid,bigint)'))) = 0
     OR position('stock.batch.process' in pg_get_functiondef(to_regprocedure('public.clear_shared_lancamento_draft(uuid,bigint)'))) = 0
     OR position('stock.batch.process' in pg_get_functiondef(to_regprocedure('public.get_shared_lancamento_batch_result(uuid)'))) = 0
     OR position('stock.launch.create' in pg_get_functiondef(v_process_oid)) = 0
     OR position('stock.batch.process' in pg_get_functiondef(v_process_oid)) = 0 THEN
    RAISE EXCEPTION 'SHARED_DRAFT_PERMISSION_GUARDS_INCOMPLETE';
  END IF;

  IF position('v_normal_delete_slot_ids, ''launch''' in pg_get_functiondef(v_process_oid)) = 0
     OR position('v_normal_history, ''launch''' in pg_get_functiondef(v_process_oid)) = 0 THEN
    RAISE EXCEPTION 'SHARED_DRAFT_TYPED_WRITER_CALL_MISSING_LAUNCH_TYPE';
  END IF;

  IF to_regprocedure('public.shared_draft_slot_identity_is_inconsistent(public.slots)') IS NULL THEN
    RAISE EXCEPTION 'SHARED_DRAFT_IDENTITY_HELPER_MISSING';
  END IF;
  IF has_function_privilege('authenticated','public.shared_draft_slot_identity_is_inconsistent(public.slots)','EXECUTE')
     OR has_function_privilege('anon','public.shared_draft_slot_identity_is_inconsistent(public.slots)','EXECUTE')
     OR has_function_privilege('service_role','public.shared_draft_slot_identity_is_inconsistent(public.slots)','EXECUTE') THEN
    RAISE EXCEPTION 'SHARED_DRAFT_IDENTITY_HELPER_EXPOSED';
  END IF;

  SELECT count(*) INTO v_quarantine_missing
  FROM public.lancamento_drafts d
  LEFT JOIN public.lancamento_draft_legacy_quarantine q
    ON q.user_id=d.user_id AND q.rows=d.rows AND q.source_updated_at=d.updated_at;
  IF v_quarantine_missing <> 0 THEN
    RAISE EXCEPTION 'SHARED_DRAFT_LEGACY_QUARANTINE_INCOMPLETE: %', v_quarantine_missing;
  END IF;

  RAISE NOTICE 'PASS_SHARED_DRAFT_SCHEMA_RPCS_PERMISSIONS_TYPED_WRITERS_AND_QUARANTINE';
END;
$verify$;

SELECT 'TABLE|'||c.relname||'|rls='||c.relrowsecurity::text
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public'
  AND c.relname = ANY(ARRAY[
    'lancamento_draft_legacy_quarantine','lancamento_draft_control',
    'lancamento_draft_lines','lancamento_draft_archive_lines','lancamento_batch_runs'
  ])
ORDER BY c.relname;

SELECT 'RPC|'||p.proname||'|'||p.oid::regprocedure::text||'|security_definer='||p.prosecdef::text||'|search_path='||coalesce(array_to_string(p.proconfig,','),'(default)')
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname = ANY(ARRAY[
  'get_shared_lancamento_draft','upsert_shared_lancamento_draft_lines',
  'delete_shared_lancamento_draft_line','clear_shared_lancamento_draft',
  'get_shared_lancamento_batch_result','process_shared_lancamento_draft_batch_atomic'
])
ORDER BY p.proname,p.oid;
