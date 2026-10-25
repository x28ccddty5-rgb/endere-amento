-- VERIFICACAO POS-MIGRACAO: rascunho compartilhado
-- Run immediately after the permanent V4 migration, in the same project, before reopening launches.
-- Read-only. Stop if any check is false or any mismatch count is nonzero.
WITH expected_tables(name) AS (
  VALUES ('lancamento_draft_legacy_quarantine'),('lancamento_draft_control'),
    ('lancamento_draft_lines'),('lancamento_draft_archive_lines'),('lancamento_batch_runs')
), expected_functions(name) AS (
  VALUES ('get_shared_lancamento_draft'),('upsert_shared_lancamento_draft_lines'),
    ('delete_shared_lancamento_draft_line'),('clear_shared_lancamento_draft'),
    ('get_shared_lancamento_batch_result'),('shared_draft_slot_identity_is_inconsistent'),
    ('process_shared_lancamento_draft_batch_atomic')
)
SELECT 'table:'||e.name AS check_item,
       to_regclass('public.'||e.name) IS NOT NULL AS exists
FROM expected_tables e
UNION ALL
SELECT 'function:'||e.name,
       EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
               WHERE n.nspname='public' AND p.proname=e.name)
FROM expected_functions e
ORDER BY check_item;

-- Exact legacy-to-quarantine consistency; do not rely on aggregate counts alone.
WITH mismatch AS (
  SELECT d.user_id
  FROM public.lancamento_drafts d
  LEFT JOIN public.lancamento_draft_legacy_quarantine q ON q.user_id=d.user_id
  WHERE q.user_id IS NULL OR q.rows IS DISTINCT FROM d.rows
     OR q.source_updated_at IS DISTINCT FROM d.updated_at
     OR q.row_count IS DISTINCT FROM CASE WHEN jsonb_typeof(d.rows)='array' THEN jsonb_array_length(d.rows) ELSE 0 END
  UNION ALL
  SELECT q.user_id
  FROM public.lancamento_draft_legacy_quarantine q
  LEFT JOIN public.lancamento_drafts d ON d.user_id=q.user_id
  WHERE d.user_id IS NULL
)
SELECT
  (SELECT count(*) FROM public.lancamento_drafts) AS legacy_records,
  (SELECT coalesce(sum(CASE WHEN jsonb_typeof(rows)='array' THEN jsonb_array_length(rows) ELSE 0 END),0) FROM public.lancamento_drafts) AS legacy_lines,
  (SELECT count(*) FROM public.lancamento_draft_legacy_quarantine) AS quarantine_records,
  (SELECT coalesce(sum(row_count),0) FROM public.lancamento_draft_legacy_quarantine) AS quarantine_lines,
  (SELECT count(*) FROM mismatch) AS exact_mismatches;

-- Newly created operational structures should be empty at deployment.
SELECT
  (SELECT count(*) FROM public.lancamento_draft_control WHERE singleton IS TRUE) AS singleton_control_rows,
  (SELECT count(*) FROM public.lancamento_draft_lines) AS active_lines,
  (SELECT count(*) FROM public.lancamento_draft_archive_lines) AS archived_lines,
  (SELECT count(*) FROM public.lancamento_batch_runs) AS processed_batches;

-- Direct table privileges are intentionally absent; access is through guarded RPCs.
WITH table_names(name) AS (
  VALUES ('lancamento_draft_legacy_quarantine'),('lancamento_draft_control'),
    ('lancamento_draft_lines'),('lancamento_draft_archive_lines'),('lancamento_batch_runs')
)
SELECT t.name AS table_name,
       coalesce((SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                 WHERE n.nspname='public' AND c.relname=t.name),false) AS rls_enabled,
       (has_table_privilege('anon','public.'||t.name,'SELECT') OR has_table_privilege('anon','public.'||t.name,'INSERT') OR has_table_privilege('anon','public.'||t.name,'UPDATE') OR has_table_privilege('anon','public.'||t.name,'DELETE') OR has_table_privilege('anon','public.'||t.name,'TRUNCATE')) AS anon_any_direct_access,
       (has_table_privilege('authenticated','public.'||t.name,'SELECT') OR has_table_privilege('authenticated','public.'||t.name,'INSERT') OR has_table_privilege('authenticated','public.'||t.name,'UPDATE') OR has_table_privilege('authenticated','public.'||t.name,'DELETE') OR has_table_privilege('authenticated','public.'||t.name,'TRUNCATE')) AS authenticated_any_direct_access,
       (has_table_privilege('service_role','public.'||t.name,'SELECT') OR has_table_privilege('service_role','public.'||t.name,'INSERT') OR has_table_privilege('service_role','public.'||t.name,'UPDATE') OR has_table_privilege('service_role','public.'||t.name,'DELETE') OR has_table_privilege('service_role','public.'||t.name,'TRUNCATE')) AS service_role_any_direct_access
FROM table_names t ORDER BY t.name;

-- New public operational RPCs: authenticated only; internal helper: no direct EXECUTE.
WITH checks(name, signature, auth_expected) AS (
  VALUES
    ('get_shared_lancamento_draft','public.get_shared_lancamento_draft()',true),
    ('upsert_shared_lancamento_draft_lines','public.upsert_shared_lancamento_draft_lines(uuid,jsonb)',true),
    ('delete_shared_lancamento_draft_line','public.delete_shared_lancamento_draft_line(uuid,text,bigint)',true),
    ('clear_shared_lancamento_draft','public.clear_shared_lancamento_draft(uuid,bigint)',true),
    ('get_shared_lancamento_batch_result','public.get_shared_lancamento_batch_result(uuid)',true),
    ('process_shared_lancamento_draft_batch_atomic','public.process_shared_lancamento_draft_batch_atomic(uuid,uuid,bigint,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text[])',true),
    ('shared_draft_slot_identity_is_inconsistent','public.shared_draft_slot_identity_is_inconsistent(public.slots)',false)
)
SELECT name,
       to_regprocedure(signature) IS NOT NULL AS exists,
       has_function_privilege('authenticated',signature,'EXECUTE') AS authenticated_execute,
       has_function_privilege('anon',signature,'EXECUTE') AS anon_execute,
       has_function_privilege('service_role',signature,'EXECUTE') AS service_role_execute,
       auth_expected
FROM checks ORDER BY name;

-- Existing stock RPCs must still exist and remain executable by authenticated clients.
SELECT
  to_regprocedure('public.apply_stock_mutation_atomic(jsonb,jsonb,jsonb,jsonb,jsonb)') IS NOT NULL AS legacy_stock_rpc_exists,
  has_function_privilege('authenticated','public.apply_stock_mutation_atomic(jsonb,jsonb,jsonb,jsonb,jsonb)','EXECUTE') AS legacy_stock_rpc_authenticated_execute,
  to_regprocedure('public.apply_stock_mutation_atomic_with_deletes(jsonb,jsonb,jsonb,jsonb,jsonb,text[])') IS NOT NULL AS legacy_delete_stock_rpc_exists,
  has_function_privilege('authenticated','public.apply_stock_mutation_atomic_with_deletes(jsonb,jsonb,jsonb,jsonb,jsonb,text[])','EXECUTE') AS legacy_delete_stock_rpc_authenticated_execute;
