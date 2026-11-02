-- RELEASE PRODUCTION / A2 — escritores tipados + bridge do lote compartilhado.
-- Adaptada ao estado remoto existente: NÃO cria tabelas/índices/constraints/dados;
-- substitui 7 RPCs existentes, cria apenas 2 overloads tipados e mantém
-- as 2 overloads antigas executáveis até o corte final.
-- Preflight fixa os fingerprints observados em produção em 2026-11-02.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $production_bridge_preflight$
DECLARE
  v_catalog integer;
  v_role_rows integer;
  v_role_distinct integer;
  v_leadership_rows integer;
  v_expected_objects integer;
BEGIN
  IF to_regclass('public.permission_catalog') IS NULL
     OR to_regclass('public.role_permissions') IS NULL
     OR to_regclass('public.user_permission_overrides') IS NULL
     OR to_regclass('public.permission_change_audit') IS NULL
     OR to_regprocedure('public.has_app_permission(text)') IS NULL
     OR to_regprocedure('public.has_app_permissions(text[])') IS NULL
     OR to_regprocedure('public.update_slot_metadata_atomic(jsonb,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'PROD_BRIDGE_REQUIRED_PERMISSION_FOUNDATION_OR_B6_MISSING';
  END IF;

  SELECT count(*) INTO v_catalog
  FROM public.permission_catalog WHERE is_active IS TRUE;
  SELECT count(*) INTO v_role_rows FROM public.role_permissions;
  SELECT count(DISTINCT (role, permission_key)) INTO v_role_distinct
  FROM public.role_permissions;
  SELECT count(*) INTO v_leadership_rows
  FROM public.role_permissions WHERE role='lideranca';

  IF v_catalog <> 29 OR v_role_rows <> 116 OR v_role_distinct <> 116
     OR v_leadership_rows <> 0 THEN
    RAISE EXCEPTION 'PROD_BRIDGE_EXPECTS_29_KEYS_116_FOUR_ROLE_ROWS: catalog %, rows %, distinct %, leadership %',
      v_catalog, v_role_rows, v_role_distinct, v_leadership_rows;
  END IF;

  IF (SELECT count(*) FROM pg_policies
      WHERE schemaname='public' AND tablename='products'
        AND policyname IN ('products_insert_permission','products_update_permission','products_delete_permission')) <> 3 THEN
    RAISE EXCEPTION 'PROD_BRIDGE_B6_1_PRODUCT_POLICIES_MISSING';
  END IF;

  IF to_regprocedure('public.save_warehouse_layout_atomic(jsonb,jsonb)') IS NULL
     OR to_regprocedure('public.save_warehouse_positions_atomic(jsonb,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'PROD_BRIDGE_LAYOUT_RPC_DEPENDENCY_MISSING';
  END IF;

  IF to_regprocedure('public.apply_stock_mutation_atomic(jsonb,jsonb,jsonb,jsonb,jsonb)') IS NULL
     OR to_regprocedure('public.apply_stock_mutation_atomic_with_deletes(jsonb,jsonb,jsonb,jsonb,jsonb,text[])') IS NULL THEN
    RAISE EXCEPTION 'PROD_BRIDGE_LEGACY_WRITERS_MISSING';
  END IF;

  IF to_regprocedure('public.apply_stock_mutation_atomic(jsonb,jsonb,jsonb,jsonb,jsonb,text)') IS NOT NULL
     OR to_regprocedure('public.apply_stock_mutation_atomic_with_deletes(jsonb,jsonb,jsonb,jsonb,jsonb,text[],text)') IS NOT NULL THEN
    RAISE EXCEPTION 'PROD_BRIDGE_TYPED_WRITER_ALREADY_EXISTS';
  END IF;

  IF (SELECT prosecdef FROM pg_proc WHERE oid=to_regprocedure('public.apply_stock_mutation_atomic(jsonb,jsonb,jsonb,jsonb,jsonb)')) IS DISTINCT FROM TRUE
     OR (SELECT prosecdef FROM pg_proc WHERE oid=to_regprocedure('public.apply_stock_mutation_atomic_with_deletes(jsonb,jsonb,jsonb,jsonb,jsonb,text[])')) IS DISTINCT FROM TRUE
     OR NOT ((SELECT proconfig FROM pg_proc WHERE oid=to_regprocedure('public.apply_stock_mutation_atomic(jsonb,jsonb,jsonb,jsonb,jsonb)')) @> ARRAY['search_path=""']::text[])
     OR NOT ((SELECT proconfig FROM pg_proc WHERE oid=to_regprocedure('public.apply_stock_mutation_atomic_with_deletes(jsonb,jsonb,jsonb,jsonb,jsonb,text[])')) @> ARRAY['search_path=""']::text[])
     OR NOT has_function_privilege('authenticated','public.apply_stock_mutation_atomic(jsonb,jsonb,jsonb,jsonb,jsonb)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.apply_stock_mutation_atomic_with_deletes(jsonb,jsonb,jsonb,jsonb,jsonb,text[])','EXECUTE')
     OR has_function_privilege('anon','public.apply_stock_mutation_atomic(jsonb,jsonb,jsonb,jsonb,jsonb)','EXECUTE')
     OR has_function_privilege('anon','public.apply_stock_mutation_atomic_with_deletes(jsonb,jsonb,jsonb,jsonb,jsonb,text[])','EXECUTE') THEN
    RAISE EXCEPTION 'PROD_BRIDGE_LEGACY_WRITER_ACL_OR_SECURITY_UNEXPECTED';
  END IF;

  IF to_regclass('public.lancamento_drafts') IS NULL
     OR to_regclass('public.lancamento_draft_legacy_quarantine') IS NULL
     OR to_regclass('public.lancamento_draft_control') IS NULL
     OR to_regclass('public.lancamento_draft_lines') IS NULL
     OR to_regclass('public.lancamento_draft_archive_lines') IS NULL
     OR to_regclass('public.lancamento_batch_runs') IS NULL THEN
    RAISE EXCEPTION 'PROD_BRIDGE_SHARED_DRAFT_TABLES_MISSING';
  END IF;

  SELECT count(*) INTO v_expected_objects
  FROM (VALUES
    ('public.get_shared_lancamento_draft()'::text),
    ('public.upsert_shared_lancamento_draft_lines(uuid,jsonb)'::text),
    ('public.delete_shared_lancamento_draft_line(uuid,text,bigint)'::text),
    ('public.clear_shared_lancamento_draft(uuid,bigint)'::text),
    ('public.get_shared_lancamento_batch_result(uuid)'::text),
    ('public.shared_draft_slot_identity_is_inconsistent(public.slots)'::text),
    ('public.process_shared_lancamento_draft_batch_atomic(uuid,uuid,bigint,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text[])'::text)
  ) AS expected(signature)
  WHERE to_regprocedure(expected.signature) IS NOT NULL;
  IF v_expected_objects <> 7 THEN
    RAISE EXCEPTION 'PROD_BRIDGE_EXPECTS_SEVEN_EXISTING_SHARED_FUNCTIONS_FOUND_%',v_expected_objects;
  END IF;

  IF NOT has_function_privilege('authenticated','public.process_shared_lancamento_draft_batch_atomic(uuid,uuid,bigint,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text[])','EXECUTE')
     OR has_function_privilege('anon','public.process_shared_lancamento_draft_batch_atomic(uuid,uuid,bigint,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text[])','EXECUTE') THEN
    RAISE EXCEPTION 'PROD_BRIDGE_SHARED_BATCH_ACL_UNEXPECTED';
  END IF;

  IF has_function_privilege('authenticated','public.shared_draft_slot_identity_is_inconsistent(public.slots)','EXECUTE')
     OR has_function_privilege('anon','public.shared_draft_slot_identity_is_inconsistent(public.slots)','EXECUTE') THEN
    RAISE EXCEPTION 'PROD_BRIDGE_SHARED_IDENTITY_HELPER_MUST_REMAIN_PRIVATE';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('public.get_shared_lancamento_draft()'::text, TRUE, TRUE),
      ('public.upsert_shared_lancamento_draft_lines(uuid,jsonb)'::text, TRUE, TRUE),
      ('public.delete_shared_lancamento_draft_line(uuid,text,bigint)'::text, TRUE, TRUE),
      ('public.clear_shared_lancamento_draft(uuid,bigint)'::text, TRUE, TRUE),
      ('public.get_shared_lancamento_batch_result(uuid)'::text, TRUE, TRUE),
      ('public.shared_draft_slot_identity_is_inconsistent(public.slots)'::text, FALSE, FALSE),
      ('public.process_shared_lancamento_draft_batch_atomic(uuid,uuid,bigint,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text[])'::text, TRUE, TRUE)
    ) AS expected(signature, security_definer, auth_exec)
    JOIN pg_proc p ON p.oid=to_regprocedure(expected.signature)
    WHERE p.prosecdef IS DISTINCT FROM expected.security_definer
       OR NOT (COALESCE(p.proconfig,ARRAY[]::text[]) @> ARRAY['search_path=""']::text[])
       OR has_function_privilege('authenticated',p.oid,'EXECUTE') IS DISTINCT FROM expected.auth_exec
       OR has_function_privilege('anon',p.oid,'EXECUTE') IS DISTINCT FROM FALSE
       OR has_function_privilege('service_role',p.oid,'EXECUTE') IS DISTINCT FROM FALSE
  ) THEN
    RAISE EXCEPTION 'PROD_BRIDGE_EXISTING_SHARED_FUNCTION_SECURITY_OR_ACL_UNEXPECTED';
  END IF;

  -- Source fingerprint guard: se qualquer função existente mudou desde a captura
  -- de 02/11/2026, abortar e refazer a comparação; nunca sobrescrever drift.
  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('public.apply_stock_mutation_atomic(jsonb,jsonb,jsonb,jsonb,jsonb)'::text, '5fa2a17bb2862bdb32a71958ea9c9c09'::text),
      ('public.apply_stock_mutation_atomic_with_deletes(jsonb,jsonb,jsonb,jsonb,jsonb,text[])'::text, '2406d91dcf628eb4b0c3be72ee0b95fb'::text),
      ('public.get_shared_lancamento_draft()'::text, 'cde888a893412ff52423ee2d92101778'::text),
      ('public.upsert_shared_lancamento_draft_lines(uuid,jsonb)'::text, '906854366281c00972be5fecb9868447'::text),
      ('public.delete_shared_lancamento_draft_line(uuid,text,bigint)'::text, '0a77614b454a86a1eec9d455b40fc813'::text),
      ('public.clear_shared_lancamento_draft(uuid,bigint)'::text, '16cf9d2f65fa8ed9ed76fd27aa1a7640'::text),
      ('public.get_shared_lancamento_batch_result(uuid)'::text, '006c97764e338ba4837c4fb08727db21'::text),
      ('public.shared_draft_slot_identity_is_inconsistent(public.slots)'::text, '7c410f04f29d6f31dfcc2c0b93ffa679'::text),
      ('public.process_shared_lancamento_draft_batch_atomic(uuid,uuid,bigint,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text[])'::text, '1464207ece8b3f64b02db8d6f549e444'::text)
    ) AS expected(signature, source_md5)
    JOIN pg_proc p ON p.oid=to_regprocedure(expected.signature)
    WHERE md5(p.prosrc) IS DISTINCT FROM expected.source_md5
  ) THEN
    RAISE EXCEPTION 'PROD_BRIDGE_SOURCE_FINGERPRINT_CHANGED_RECAPTURE_REQUIRED';
  END IF;
END;
$production_bridge_preflight$;

-- ===== NOVOS ESCRITORES TIPADOS (somente novas assinaturas) =====

CREATE FUNCTION public.apply_stock_mutation_atomic(p_expected_slots jsonb, p_slots jsonb, p_expected_divergencias jsonb, p_divergencias jsonb, p_history jsonb, p_operation_type text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_actor_name text;
  v_scope_keys text[] := ARRAY[]::text[];
  v_key text;
  v_scope_parts jsonb;
  v_position_active boolean;
  v_module_active boolean;
  v_payload jsonb;
  v_expected_slot public.slots%ROWTYPE;
  v_current_slot public.slots%ROWTYPE;
  v_new_slot public.slots%ROWTYPE;
  v_expected_div public.divergencias%ROWTYPE;
  v_current_div public.divergencias%ROWTYPE;
  v_new_div public.divergencias%ROWTYPE;
  v_id text;
  v_current_count bigint;
  v_payload_count bigint;
  v_slots_written integer := 0;
  v_history_written integer := 0;
  v_divergencias_written integer := 0;
  v_conflict_message text;
  v_sqlstate text;
  v_operation_scope_count bigint := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF p_operation_type IS NULL OR p_operation_type NOT IN ('launch', 'transfer', 'physical_correction') THEN
    RAISE EXCEPTION 'INVALID_STOCK_OPERATION_TYPE' USING ERRCODE = '22023';
  END IF;
  IF p_operation_type = 'launch' THEN
    IF public.has_app_permission('stock.launch.create') IS DISTINCT FROM TRUE THEN
      RAISE EXCEPTION 'PERMISSION_DENIED:stock.launch.create' USING ERRCODE = '42501';
    END IF;
  ELSIF p_operation_type = 'transfer' THEN
    IF public.has_app_permission('stock.transfer.create') IS DISTINCT FROM TRUE THEN
      RAISE EXCEPTION 'PERMISSION_DENIED:stock.transfer.create' USING ERRCODE = '42501';
    END IF;
  ELSIF p_operation_type = 'physical_correction' THEN
    IF public.has_app_permission('stock.physical_correction') IS DISTINCT FROM TRUE THEN
      RAISE EXCEPTION 'PERMISSION_DENIED:stock.physical_correction' USING ERRCODE = '42501';
    END IF;
  END IF;
  SELECT p.name INTO v_actor_name FROM public.profiles AS p WHERE p.id = auth.uid();
  IF coalesce(btrim(v_actor_name), '') = '' THEN
    RAISE EXCEPTION 'OPERATOR_PROFILE_MISSING' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_expected_slots) IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_slots) IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_expected_divergencias) IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_divergencias) IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_history) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'INVALID_TRANSACTION_PAYLOAD' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_expected_slots) > 10000
     OR jsonb_array_length(p_slots) > 10000
     OR jsonb_array_length(p_expected_divergencias) > 10000
     OR jsonb_array_length(p_divergencias) > 10000
     OR jsonb_array_length(p_history) > 10000 THEN
    RAISE EXCEPTION 'INVALID_TRANSACTION_PAYLOAD_SIZE' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_expected_slots) = 0 AND jsonb_array_length(p_slots) = 0
     AND jsonb_array_length(p_expected_divergencias) = 0 AND jsonb_array_length(p_divergencias) = 0
     AND jsonb_array_length(p_history) = 0 THEN
    RAISE EXCEPTION 'EMPTY_STOCK_MUTATION' USING ERRCODE = '22023';
  END IF;

  /* Ordinary launches may span many addresses. A physical correction is limited
     to one scope, and a transfer to one exact source/destination pair. Shared
     batches use a dedicated RPC and do not enter this function. */
  SELECT count(DISTINCT scope_key)
    INTO v_operation_scope_count
    FROM (
      SELECT public.stock_address_lock_key(x.value->>'estoque', x.value->>'modulo', coalesce(x.value->>'posicao','')) AS scope_key
        FROM jsonb_array_elements(p_expected_slots) AS x(value)
      UNION ALL
      SELECT public.stock_address_lock_key(x.value->>'estoque', x.value->>'modulo', coalesce(x.value->>'posicao',''))
        FROM jsonb_array_elements(p_slots) AS x(value)
      UNION ALL
      SELECT public.stock_address_lock_key(x.value->>'estoque', x.value->>'modulo', coalesce(x.value->>'posicao',''))
        FROM jsonb_array_elements(p_expected_divergencias) AS x(value)
      UNION ALL
      SELECT public.stock_address_lock_key(x.value->>'estoque', x.value->>'modulo', coalesce(x.value->>'posicao',''))
        FROM jsonb_array_elements(p_divergencias) AS x(value)
      UNION ALL
      SELECT public.stock_address_lock_key(x.value->>'estoque', x.value->>'modulo', coalesce(x.value->>'posicao',''))
        FROM jsonb_array_elements(p_history) AS x(value)
    ) AS submitted_scopes;

  IF p_operation_type = 'physical_correction' AND v_operation_scope_count > 1 THEN
    RAISE EXCEPTION 'SINGLE_SCOPE_OPERATION_REQUIRED' USING ERRCODE = '22023';
  END IF;

  IF p_operation_type = 'launch' AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_history) AS h(value)
     WHERE lower(btrim(coalesce(h.value->>'naturezaTransacao',''))) = 'correcao_fisica'
  ) THEN
    RAISE EXCEPTION 'PHYSICAL_CORRECTION_OPERATION_TYPE_REQUIRED' USING ERRCODE = '22023';
  END IF;

  IF p_operation_type = 'physical_correction' AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_history) AS h(value)
     WHERE lower(btrim(coalesce(h.value->>'naturezaTransacao',''))) <> 'correcao_fisica'
  ) THEN
    RAISE EXCEPTION 'PHYSICAL_CORRECTION_AUDIT_MARKER_REQUIRED' USING ERRCODE = '22023';
  END IF;

  IF p_operation_type = 'transfer' THEN
    IF v_operation_scope_count <> 2
       OR jsonb_array_length(p_history) <> 2
       OR (SELECT count(*) FROM jsonb_array_elements(p_history) AS h(value) WHERE h.value->>'tipo' = 'Entrada') <> 1
       OR (SELECT count(*) FROM jsonb_array_elements(p_history) AS h(value) WHERE h.value->>'tipo' = 'Saída') <> 1
       OR (SELECT count(DISTINCT public.stock_address_lock_key(h.value->>'estoque', h.value->>'modulo', coalesce(h.value->>'posicao',''))) FROM jsonb_array_elements(p_history) AS h(value)) <> 2
       OR (SELECT count(DISTINCT upper(btrim(coalesce(h.value->>'referencia','')))) FROM jsonb_array_elements(p_history) AS h(value)) <> 1
       OR (SELECT count(DISTINCT coalesce(nullif(btrim(h.value->>'quantidade'),''),'<null>')) FROM jsonb_array_elements(p_history) AS h(value)) <> 1
       OR (SELECT count(DISTINCT coalesce(h.value->>'estoque','')) FROM jsonb_array_elements(p_history) AS h(value)) <> 1
       OR (SELECT count(*) FROM jsonb_array_elements(p_history) AS h(value) WHERE coalesce(h.value->>'estoque','') NOT IN ('2','3')) <> 0
       OR (SELECT count(DISTINCT lower(coalesce(nullif(btrim(h.value->>'restricao'),''),'nenhuma'))) FROM jsonb_array_elements(p_history) AS h(value)) <> 1
       OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(p_history) AS h(value)
          WHERE lower(btrim(coalesce(h.value->>'naturezaTransacao',''))) = 'correcao_fisica'
       ) THEN
      RAISE EXCEPTION 'TRANSFER_PAYLOAD_SHAPE_INVALID' USING ERRCODE = '22023';
    END IF;

    IF jsonb_array_length(p_expected_divergencias) <> jsonb_array_length(p_divergencias)
       OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(p_expected_divergencias) AS e(value)
          WHERE NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(p_divergencias) AS n(value)
             WHERE n.value->>'id' = e.value->>'id' AND n.value = e.value
          )
       ) THEN
      RAISE EXCEPTION 'TRANSFER_CANNOT_CHANGE_DIVERGENCES' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_operation_type = 'physical_correction'
     AND (jsonb_array_length(p_expected_divergencias) <> jsonb_array_length(p_divergencias)
       OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(p_expected_divergencias) AS e(value)
          WHERE NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(p_divergencias) AS n(value)
             WHERE n.value->>'id' = e.value->>'id' AND n.value = e.value
          )
       )) THEN
    RAISE EXCEPTION 'PHYSICAL_CORRECTION_CANNOT_RESOLVE_DIVERGENCES' USING ERRCODE = '22023';
  END IF;


  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_expected_slots) x(value) WHERE coalesce(x.value->>'id','')='')
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_expected_slots) x(value) GROUP BY x.value->>'id' HAVING count(*)>1)
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_slots) x(value) WHERE coalesce(x.value->>'id','')='')
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_slots) x(value) GROUP BY x.value->>'id' HAVING count(*)>1) THEN
    RAISE EXCEPTION 'DUPLICATE_OR_EMPTY_SLOT_ID' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_expected_divergencias) x(value) WHERE coalesce(x.value->>'id','')='')
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_expected_divergencias) x(value) GROUP BY x.value->>'id' HAVING count(*)>1)
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_divergencias) x(value) WHERE coalesce(x.value->>'id','')='')
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_divergencias) x(value) GROUP BY x.value->>'id' HAVING count(*)>1) THEN
    RAISE EXCEPTION 'DUPLICATE_OR_EMPTY_DIVERGENCIA_ID' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_history) x(value) WHERE coalesce(x.value->>'id','')='')
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_history) x(value) GROUP BY x.value->>'id' HAVING count(*)>1) THEN
    RAISE EXCEPTION 'DUPLICATE_OR_EMPTY_HISTORY_ID' USING ERRCODE = '22023';
  END IF;

  /* Derive all scopes from both pre-state and post-state. The sorted key order avoids deadlocks. */
  FOR v_payload IN
    SELECT x.value FROM jsonb_array_elements(p_expected_slots) x(value)
    UNION ALL SELECT x.value FROM jsonb_array_elements(p_slots) x(value)
    UNION ALL SELECT x.value FROM jsonb_array_elements(p_expected_divergencias) x(value)
    UNION ALL SELECT x.value FROM jsonb_array_elements(p_divergencias) x(value)
    UNION ALL SELECT x.value FROM jsonb_array_elements(p_history) x(value)
  LOOP
    v_key := public.stock_address_lock_key(
      v_payload->>'estoque', v_payload->>'modulo', coalesce(v_payload->>'posicao','')
    );
    IF array_position(v_scope_keys, v_key) IS NULL THEN
      v_scope_keys := array_append(v_scope_keys, v_key);
    END IF;
  END LOOP;
  IF coalesce(array_length(v_scope_keys,1),0)=0 THEN
    RAISE EXCEPTION 'NO_STOCK_SCOPE_IN_PAYLOAD' USING ERRCODE = '22023';
  END IF;
  FOR v_key IN SELECT unnest(v_scope_keys) ORDER BY 1 LOOP
    PERFORM public.lock_stock_address_key(v_key);
  END LOOP;

  /* Physical scope changes and layout activation/deactivation use the same lock order. */
  FOR v_key IN SELECT unnest(v_scope_keys) ORDER BY 1 LOOP
    v_scope_parts := v_key::jsonb;
    IF v_scope_parts ->> 0 IN ('2','3') THEN
      SELECT p.ativo INTO v_position_active
        FROM public.warehouse_layout_positions AS p
       WHERE p.estoque = v_scope_parts ->> 0
         AND p.modulo = v_scope_parts ->> 1
         AND upper(btrim(p.posicao)) = v_scope_parts ->> 2
       FOR SHARE;
      IF NOT FOUND OR v_position_active IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'PHYSICAL_POSITION_NOT_ACTIVE_OR_UNKNOWN: %', v_key USING ERRCODE = '22023';
      END IF;

      /* A persisted inactive module must never accept new stock mutations,
         even if an old/partial layout still marks one of its positions active.
         Legacy modules with no warehouse_layout row remain governed by positions. */
      SELECT l.ativo INTO v_module_active
        FROM public.warehouse_layout AS l
       WHERE l.estoque = v_scope_parts ->> 0
         AND l.modulo = v_scope_parts ->> 1
       FOR SHARE;
      IF FOUND AND v_module_active IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'PHYSICAL_MODULE_INACTIVE: %-%',
          v_scope_parts ->> 0, v_scope_parts ->> 1 USING ERRCODE = '22023';
      END IF;
    END IF;
  END LOOP;

  /* Compare complete address/module snapshots, not only rows the UI intends to change. */
  FOR v_key IN SELECT unnest(v_scope_keys) ORDER BY 1 LOOP
    SELECT count(*) INTO v_current_count FROM public.slots s
     WHERE public.stock_address_lock_key(s.estoque,s.modulo,coalesce(s.posicao,'')) = v_key;
    SELECT count(*) INTO v_payload_count FROM jsonb_array_elements(p_expected_slots) x(value)
     WHERE public.stock_address_lock_key(x.value->>'estoque',x.value->>'modulo',coalesce(x.value->>'posicao','')) = v_key;
    IF v_current_count <> v_payload_count THEN
      RETURN jsonb_build_object(
        'success', false,
        'conflict', true,
        'code', 'SLOT_SET_CONFLICT',
        'message', format('SLOT_SET_CONFLICT: scope %s changed; expected %s, current %s', v_key, v_payload_count, v_current_count),
        'scope', v_key
      );
    END IF;
    FOR v_payload IN SELECT x.value FROM jsonb_array_elements(p_expected_slots) x(value)
      WHERE public.stock_address_lock_key(x.value->>'estoque',x.value->>'modulo',coalesce(x.value->>'posicao','')) = v_key
      ORDER BY x.value->>'id'
    LOOP
      v_id := v_payload->>'id';
      SELECT s.* INTO v_current_slot FROM public.slots s WHERE s.id=v_id FOR UPDATE;
      IF NOT FOUND THEN
        RETURN jsonb_build_object(
          'success', false,
          'conflict', true,
          'code', 'SLOT_CONFLICT',
          'message', format('SLOT_CONFLICT: %s removed', v_id),
          'slot_id', v_id
        );
      END IF;
      SELECT r.* INTO v_expected_slot FROM jsonb_populate_record(NULL::public.slots,v_payload) r;
      IF to_jsonb(v_current_slot) IS DISTINCT FROM to_jsonb(v_expected_slot) THEN
        RETURN jsonb_build_object(
          'success', false,
          'conflict', true,
          'code', 'SLOT_CONFLICT',
          'message', format('SLOT_CONFLICT: %s changed since snapshot', v_id),
          'slot_id', v_id
        );
      END IF;
    END LOOP;

    SELECT count(*) INTO v_current_count FROM public.divergencias d
     WHERE public.stock_address_lock_key(d.estoque,d.modulo,coalesce(d.posicao,'')) = v_key;
    SELECT count(*) INTO v_payload_count FROM jsonb_array_elements(p_expected_divergencias) x(value)
     WHERE public.stock_address_lock_key(x.value->>'estoque',x.value->>'modulo',coalesce(x.value->>'posicao','')) = v_key;
    IF v_current_count <> v_payload_count THEN
      RETURN jsonb_build_object(
        'success', false,
        'conflict', true,
        'code', 'DIVERGENCIA_SET_CONFLICT',
        'message', format('DIVERGENCIA_SET_CONFLICT: scope %s changed; expected %s, current %s', v_key, v_payload_count, v_current_count),
        'scope', v_key
      );
    END IF;
    FOR v_payload IN SELECT x.value FROM jsonb_array_elements(p_expected_divergencias) x(value)
      WHERE public.stock_address_lock_key(x.value->>'estoque',x.value->>'modulo',coalesce(x.value->>'posicao','')) = v_key
      ORDER BY x.value->>'id'
    LOOP
      v_id := v_payload->>'id';
      SELECT d.* INTO v_current_div FROM public.divergencias d WHERE d.id=v_id FOR UPDATE;
      IF NOT FOUND THEN
        RETURN jsonb_build_object(
          'success', false,
          'conflict', true,
          'code', 'DIVERGENCIA_CONFLICT',
          'message', format('DIVERGENCIA_CONFLICT: %s removed', v_id),
          'divergencia_id', v_id
        );
      END IF;
      SELECT r.* INTO v_expected_div FROM jsonb_populate_record(NULL::public.divergencias,v_payload) r;
      IF to_jsonb(v_current_div) IS DISTINCT FROM to_jsonb(v_expected_div) THEN
        RETURN jsonb_build_object(
          'success', false,
          'conflict', true,
          'code', 'DIVERGENCIA_CONFLICT',
          'message', format('DIVERGENCIA_CONFLICT: %s changed since snapshot', v_id),
          'divergencia_id', v_id
        );
      END IF;
    END LOOP;
  END LOOP;

  /* No existing slot/divergence may be silently deleted from a submitted scope snapshot. */
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_expected_slots) e(value)
    WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_slots) n(value) WHERE n.value->>'id'=e.value->>'id')) THEN
    RAISE EXCEPTION 'SLOT_DELETE_NOT_ALLOWED_IN_GENERIC_MUTATION' USING ERRCODE='22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_expected_divergencias) e(value)
    WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_divergencias) n(value) WHERE n.value->>'id'=e.value->>'id')) THEN
    RAISE EXCEPTION 'DIVERGENCIA_DELETE_NOT_ALLOWED_IN_GENERIC_MUTATION' USING ERRCODE='22023';
  END IF;

  FOR v_payload IN SELECT x.value FROM jsonb_array_elements(p_slots) x(value) ORDER BY x.value->>'id'
  LOOP
    v_key := public.stock_address_lock_key(v_payload->>'estoque',v_payload->>'modulo',coalesce(v_payload->>'posicao',''));
    IF array_position(v_scope_keys,v_key) IS NULL THEN RAISE EXCEPTION 'UNLOCKED_SLOT_SCOPE' USING ERRCODE='22023'; END IF;
    SELECT r.* INTO v_new_slot FROM jsonb_populate_record(NULL::public.slots,v_payload) r;

    /* Fail closed on non-canonical address values; lock scope and stored scope must agree. */
    IF v_new_slot.estoque NOT IN ('1','2','3')
       OR v_new_slot.modulo IS NULL OR btrim(v_new_slot.modulo) = ''
       OR v_new_slot.modulo !~ '^\d+$' THEN
      RAISE EXCEPTION 'NON_CANONICAL_SLOT_SCOPE: %',v_new_slot.id USING ERRCODE='22023';
    END IF;
    IF v_new_slot.modulo::numeric <= 0 OR v_new_slot.modulo <> (v_new_slot.modulo::numeric)::text THEN
      RAISE EXCEPTION 'NON_CANONICAL_SLOT_MODULE: %',v_new_slot.id USING ERRCODE='22023';
    END IF;
    IF (v_new_slot.estoque = '1' AND coalesce(v_new_slot.posicao,'') <> '')
       OR (v_new_slot.estoque IN ('2','3') AND (coalesce(btrim(v_new_slot.posicao),'') = '' OR v_new_slot.posicao <> upper(btrim(v_new_slot.posicao)))) THEN
      RAISE EXCEPTION 'NON_CANONICAL_SLOT_POSITION: %',v_new_slot.id USING ERRCODE='22023';
    END IF;
    IF v_new_slot.galpao NOT IN ('3','12') OR v_new_slot.restricao NOT IN ('nenhuma','teste','autorizacao','outra')
       OR (v_new_slot.galpao = '12' AND v_new_slot.restricao <> 'autorizacao') THEN
      RAISE EXCEPTION 'INVALID_SLOT_WAREHOUSE_OR_RESTRICTION: %',v_new_slot.id USING ERRCODE='22023';
    END IF;
    IF upper(btrim(coalesce(v_new_slot.referencia,''))) = 'VAZIO'
       OR coalesce(v_new_slot.saldo,0) < 0
       OR (nullif(upper(btrim(coalesce(v_new_slot.referencia,''))),'') IS NOT NULL AND v_new_slot.saldo IS NULL)
       OR (nullif(upper(btrim(coalesce(v_new_slot.referencia,''))),'') IS NULL AND coalesce(v_new_slot.saldo,0) > 0) THEN
      RAISE EXCEPTION 'INVALID_SLOT_STOCK_STATE: %',v_new_slot.id USING ERRCODE='22023';
    END IF;

    SELECT s.* INTO v_current_slot FROM public.slots s WHERE s.id=v_new_slot.id FOR UPDATE;
    IF FOUND THEN
      IF v_new_slot.estoque = '1'
         AND v_new_slot.id LIKE ('1-' || v_new_slot.modulo || '-%')
         AND nullif(upper(trim(coalesce(v_new_slot.referencia,''))),'') IS NOT NULL
         AND upper(trim(v_new_slot.referencia)) IS DISTINCT FROM upper(substring(v_new_slot.id FROM length('1-' || v_new_slot.modulo || '-') + 1)) THEN
        RAISE EXCEPTION 'E1_SLOT_ID_SKU_MISMATCH: % cannot be reassigned to SKU %',v_new_slot.id,v_new_slot.referencia USING ERRCODE='22023';
      END IF;
      IF v_new_slot.estoque IN ('2','3')
         AND position('::ITEM::' IN v_new_slot.id) > 0
         AND nullif(upper(trim(coalesce(v_new_slot.referencia,''))),'') IS NOT NULL
         AND v_new_slot.id <> v_new_slot.estoque || '-' || v_new_slot.modulo || '-' || v_new_slot.posicao || '::ITEM::' || v_new_slot.referencia || '::' || v_new_slot.restricao THEN
        RAISE EXCEPTION 'AUXILIARY_SLOT_ID_IDENTITY_MISMATCH: % cannot be reassigned to SKU/restriction',v_new_slot.id USING ERRCODE='22023';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_expected_slots) e(value) WHERE e.value->>'id'=v_new_slot.id) THEN
        RAISE EXCEPTION 'SLOT_ID_EXISTS_OUTSIDE_EXPECTED_SCOPE: %',v_new_slot.id USING ERRCODE='40001';
      END IF;
      IF upper(trim(coalesce(v_current_slot.referencia,''))) IS DISTINCT FROM upper(trim(coalesce(v_new_slot.referencia,'')))
         AND nullif(upper(trim(coalesce(v_new_slot.referencia,''))),'') IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM public.products p WHERE upper(trim(p.referencia))=upper(trim(v_new_slot.referencia))) THEN
        RAISE EXCEPTION 'UNKNOWN_SKU: %',v_new_slot.referencia USING ERRCODE='22023';
      END IF;
      IF to_jsonb(v_current_slot) IS DISTINCT FROM to_jsonb(v_new_slot) THEN
        UPDATE public.slots s SET
          estoque=v_new_slot.estoque, modulo=v_new_slot.modulo, posicao=v_new_slot.posicao,
          referencia=v_new_slot.referencia, descricao=v_new_slot.descricao, saldo=v_new_slot.saldo,
          "dataChacote"=v_new_slot."dataChacote", "ultimaData"=v_new_slot."ultimaData",
          "ultimaHora"=v_new_slot."ultimaHora", "ultimoResponsavel"=v_new_slot."ultimoResponsavel",
          galpao=v_new_slot.galpao, restricao=v_new_slot.restricao, observacao=v_new_slot.observacao
        WHERE s.id=v_new_slot.id;
        v_slots_written := v_slots_written + 1;
      END IF;
    ELSE
      IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_expected_slots) e(value) WHERE e.value->>'id'=v_new_slot.id) THEN
        RAISE EXCEPTION 'SLOT_CONFLICT: expected slot % no longer exists',v_new_slot.id USING ERRCODE='40001';
      END IF;
      IF v_new_slot.estoque = '1'
         AND (nullif(upper(trim(coalesce(v_new_slot.referencia,''))),'') IS NULL
              OR v_new_slot.id <> '1-' || v_new_slot.modulo || '-' || v_new_slot.referencia) THEN
        RAISE EXCEPTION 'INVALID_NEW_E1_SLOT_ID: %',v_new_slot.id USING ERRCODE='22023';
      END IF;
      IF v_new_slot.estoque IN ('2','3')
         AND v_new_slot.id <> v_new_slot.estoque || '-' || v_new_slot.modulo || '-' || v_new_slot.posicao
         AND v_new_slot.id <> v_new_slot.estoque || '-' || v_new_slot.modulo || '-' || v_new_slot.posicao || '::ITEM::' || v_new_slot.referencia || '::' || v_new_slot.restricao THEN
        RAISE EXCEPTION 'INVALID_NEW_PHYSICAL_SLOT_ID: %',v_new_slot.id USING ERRCODE='22023';
      END IF;
      IF nullif(upper(trim(coalesce(v_new_slot.referencia,''))),'') IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM public.products p WHERE upper(trim(p.referencia))=upper(trim(v_new_slot.referencia))) THEN
        RAISE EXCEPTION 'UNKNOWN_SKU: %',v_new_slot.referencia USING ERRCODE='22023';
      END IF;
      INSERT INTO public.slots(id,estoque,modulo,posicao,referencia,descricao,saldo,"dataChacote","ultimaData","ultimaHora","ultimoResponsavel",galpao,restricao,observacao)
      VALUES(v_new_slot.id,v_new_slot.estoque,v_new_slot.modulo,v_new_slot.posicao,v_new_slot.referencia,v_new_slot.descricao,v_new_slot.saldo,v_new_slot."dataChacote",v_new_slot."ultimaData",v_new_slot."ultimaHora",v_new_slot."ultimoResponsavel",v_new_slot.galpao,v_new_slot.restricao,v_new_slot.observacao);
      v_slots_written := v_slots_written + 1;
    END IF;
  END LOOP;

  /* Generic movement writers may append new open divergences, but cannot alter or resolve existing ones. */
  FOR v_payload IN SELECT x.value FROM jsonb_array_elements(p_divergencias) x(value) ORDER BY x.value->>'id'
  LOOP
    v_key := public.stock_address_lock_key(v_payload->>'estoque',v_payload->>'modulo',coalesce(v_payload->>'posicao',''));
    IF array_position(v_scope_keys,v_key) IS NULL THEN RAISE EXCEPTION 'UNLOCKED_DIVERGENCIA_SCOPE' USING ERRCODE='22023'; END IF;
    SELECT r.* INTO v_new_div FROM jsonb_populate_record(NULL::public.divergencias,v_payload) r;
    SELECT d.* INTO v_current_div FROM public.divergencias d WHERE d.id=v_new_div.id FOR UPDATE;
    IF FOUND THEN
      IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_expected_divergencias) e(value) WHERE e.value->>'id'=v_new_div.id)
         OR to_jsonb(v_current_div) IS DISTINCT FROM to_jsonb(v_new_div) THEN
        RAISE EXCEPTION 'DIVERGENCIA_UPDATE_REQUIRES_RESOLUTION_RPC: %',v_new_div.id USING ERRCODE='22023';
      END IF;
    ELSE
      IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_expected_divergencias) e(value) WHERE e.value->>'id'=v_new_div.id)
         OR lower(trim(coalesce(v_new_div.status,''))) <> 'aberta' THEN
        RAISE EXCEPTION 'INVALID_NEW_DIVERGENCIA: %',v_new_div.id USING ERRCODE='22023';
      END IF;
      INSERT INTO public.divergencias(id,"dataDivergencia","tipoDivergencia",estoque,modulo,posicao,"refAtual","refNova","saldoAntes",movimentacao,"saldoFinal",responsavel,status,"dataChacote","dataCorrecao","corrigidoPor",observacao,slot_id,restricao,"correcaoId")
      VALUES(v_new_div.id,v_new_div."dataDivergencia",v_new_div."tipoDivergencia",v_new_div.estoque,v_new_div.modulo,v_new_div.posicao,v_new_div."refAtual",v_new_div."refNova",v_new_div."saldoAntes",v_new_div.movimentacao,v_new_div."saldoFinal",v_new_div.responsavel,v_new_div.status,v_new_div."dataChacote",v_new_div."dataCorrecao",v_new_div."corrigidoPor",v_new_div.observacao,v_new_div.slot_id,v_new_div.restricao,v_new_div."correcaoId");
      v_divergencias_written := v_divergencias_written + 1;
    END IF;
  END LOOP;

  /* A changed stock identity/balance must have history, unless the same atomic
     operation records a new open divergence explaining why the slot was cleared. */
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(p_expected_slots) e(value)
      JOIN jsonb_array_elements(p_slots) n(value) ON n.value->>'id' = e.value->>'id'
     WHERE (
         coalesce(e.value->>'saldo','0') IS DISTINCT FROM coalesce(n.value->>'saldo','0')
         OR upper(trim(coalesce(e.value->>'referencia',''))) IS DISTINCT FROM upper(trim(coalesce(n.value->>'referencia','')))
         OR lower(coalesce(nullif(trim(e.value->>'restricao'),''),'nenhuma')) IS DISTINCT FROM lower(coalesce(nullif(trim(n.value->>'restricao'),''),'nenhuma'))
       )
       AND nullif(upper(trim(coalesce(e.value->>'referencia',''))),'') IS NOT NULL
       AND upper(trim(coalesce(e.value->>'referencia',''))) <> 'VAZIO'
       AND NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(p_history) h(value)
          WHERE public.stock_address_lock_key(h.value->>'estoque',h.value->>'modulo',coalesce(h.value->>'posicao','')) = public.stock_address_lock_key(e.value->>'estoque',e.value->>'modulo',coalesce(e.value->>'posicao',''))
            AND upper(trim(coalesce(h.value->>'referencia',''))) = upper(trim(e.value->>'referencia'))
            AND lower(coalesce(nullif(trim(h.value->>'restricao'),''),'nenhuma')) = lower(coalesce(nullif(trim(e.value->>'restricao'),''),'nenhuma'))
       )
       AND NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(p_divergencias) d(value)
          WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_expected_divergencias) old(value) WHERE old.value->>'id'=d.value->>'id')
            AND lower(trim(coalesce(d.value->>'status','')))='aberta'
            AND d.value->>'slot_id'=e.value->>'id'
            AND upper(trim(coalesce(d.value->>'refAtual',''))) = upper(trim(e.value->>'referencia'))
            AND lower(coalesce(nullif(trim(d.value->>'restricao'),''),'nenhuma')) = lower(coalesce(nullif(trim(e.value->>'restricao'),''),'nenhuma'))
       )
  ) THEN
    RAISE EXCEPTION 'STOCK_CHANGE_MISSING_OLD_IDENTITY_AUDIT' USING ERRCODE='22023';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(p_slots) n(value)
      LEFT JOIN jsonb_array_elements(p_expected_slots) e(value) ON e.value->>'id'=n.value->>'id'
     WHERE nullif(upper(trim(coalesce(n.value->>'referencia',''))),'') IS NOT NULL
       AND upper(trim(coalesce(n.value->>'referencia',''))) <> 'VAZIO'
       AND (
         e.value IS NULL
         OR coalesce(e.value->>'saldo','0') IS DISTINCT FROM coalesce(n.value->>'saldo','0')
         OR upper(trim(coalesce(e.value->>'referencia',''))) IS DISTINCT FROM upper(trim(coalesce(n.value->>'referencia','')))
         OR lower(coalesce(nullif(trim(e.value->>'restricao'),''),'nenhuma')) IS DISTINCT FROM lower(coalesce(nullif(trim(n.value->>'restricao'),''),'nenhuma'))
       )
       AND NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(p_history) h(value)
          WHERE public.stock_address_lock_key(h.value->>'estoque',h.value->>'modulo',coalesce(h.value->>'posicao','')) = public.stock_address_lock_key(n.value->>'estoque',n.value->>'modulo',coalesce(n.value->>'posicao',''))
            AND upper(trim(coalesce(h.value->>'referencia',''))) = upper(trim(n.value->>'referencia'))
            AND lower(coalesce(nullif(trim(h.value->>'restricao'),''),'nenhuma')) = lower(coalesce(nullif(trim(n.value->>'restricao'),''),'nenhuma'))
       )
  ) THEN
    RAISE EXCEPTION 'STOCK_CHANGE_MISSING_NEW_IDENTITY_AUDIT' USING ERRCODE='22023';
  END IF;

  /* E1 physical corrections must carry a mathematically consistent audit event.
     Normal E1 movements remain governed by their existing entry/exit payloads. */
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(p_history) AS h(value)
     WHERE lower(trim(coalesce(h.value->>'naturezaTransacao',''))) = 'correcao_fisica'
       AND h.value->>'estoque' = '1'
       AND (
         nullif(h.value->>'saldoAnterior','') IS NULL
         OR nullif(h.value->>'saldoFinal','') IS NULL
         OR nullif(h.value->>'quantidade','') IS NULL
         OR coalesce(h.value->>'correcaoId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
         OR nullif(h.value->>'saldoAnterior','')::bigint < 0
         OR nullif(h.value->>'saldoFinal','')::bigint < 0
         OR nullif(h.value->>'quantidade','')::bigint < 0
         OR nullif(h.value->>'quantidade','')::bigint <> abs(
              nullif(h.value->>'saldoFinal','')::bigint - nullif(h.value->>'saldoAnterior','')::bigint
            )
         OR CASE
              WHEN nullif(h.value->>'saldoFinal','')::bigint > nullif(h.value->>'saldoAnterior','')::bigint
                THEN coalesce(h.value->>'tipo','') <> 'Entrada'
              WHEN nullif(h.value->>'saldoFinal','')::bigint < nullif(h.value->>'saldoAnterior','')::bigint
                THEN coalesce(h.value->>'tipo','') <> 'Saída'
              ELSE coalesce(h.value->>'tipo','') <> ''
            END
         OR NOT EXISTS (
           SELECT 1
             FROM jsonb_array_elements(p_slots) AS final_row(value)
             LEFT JOIN jsonb_array_elements(p_expected_slots) AS old(value)
               ON old.value->>'id' = final_row.value->>'id'
            WHERE final_row.value->>'id' = h.value->>'slot_id'
              AND final_row.value->>'estoque' = '1'
              AND final_row.value->>'modulo' = h.value->>'modulo'
              AND coalesce(final_row.value->>'posicao','') = ''
              AND coalesce(nullif(final_row.value->>'saldo','')::bigint,0) = nullif(h.value->>'saldoFinal','')::bigint
              AND (
                /* New E1 SKU line: no prior row means its logical starting balance is zero. */
                (
                  old.value IS NULL
                  AND nullif(h.value->>'saldoAnterior','')::bigint = 0
                  AND nullif(h.value->>'saldoFinal','')::bigint > 0
                  AND upper(trim(coalesce(final_row.value->>'referencia',''))) = upper(trim(h.value->>'referencia'))
                  AND final_row.value->>'id' = ('1-' || (h.value->>'modulo') || '-' || upper(trim(h.value->>'referencia')))
                )
                OR
                /* Existing line: verify the exact prior state submitted for optimistic concurrency. */
                (
                  old.value IS NOT NULL
                  AND old.value->>'id' = h.value->>'slot_id'
                  AND old.value->>'estoque' = '1'
                  AND old.value->>'modulo' = h.value->>'modulo'
                  AND coalesce(old.value->>'posicao','') = ''
                  AND coalesce(nullif(old.value->>'saldo','')::bigint,0) = nullif(h.value->>'saldoAnterior','')::bigint
                )
              )
         )
       )
  ) THEN
    RAISE EXCEPTION 'INVALID_E1_PHYSICAL_CORRECTION_AUDIT: quantity, direction or balances do not match the slot snapshot'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.history(id,"dataLancamento","quemLancou",data,estoque,modulo,posicao,referencia,quantidade,tipo,"dataChacote",hora,responsavel,observacao,galpao,slot_id,restricao,"naturezaTransacao","saldoAnterior","saldoFinal","correcaoId")
  SELECT h.value->>'id',h.value->>'dataLancamento',h.value->>'quemLancou',h.value->>'data',h.value->>'estoque',h.value->>'modulo',h.value->>'posicao',h.value->>'referencia',(h.value->>'quantidade')::integer,h.value->>'tipo',h.value->>'dataChacote',h.value->>'hora',h.value->>'responsavel',h.value->>'observacao',h.value->>'galpao',h.value->>'slot_id',h.value->>'restricao',h.value->>'naturezaTransacao',nullif(h.value->>'saldoAnterior','')::integer,nullif(h.value->>'saldoFinal','')::integer,nullif(h.value->>'correcaoId','')::uuid
  FROM jsonb_array_elements(p_history) h(value)
  ORDER BY h.value->>'id';
  GET DIAGNOSTICS v_history_written = ROW_COUNT;

  RETURN jsonb_build_object('success',true,'slots_written',v_slots_written,'history_written',v_history_written,'divergencias_written',v_divergencias_written,'scopes_locked',coalesce(array_length(v_scope_keys,1),0));
EXCEPTION
  WHEN SQLSTATE '42501' THEN
    GET STACKED DIAGNOSTICS v_conflict_message = MESSAGE_TEXT, v_sqlstate = RETURNED_SQLSTATE;
    RETURN jsonb_build_object(
      'success', false,
      'conflict', false,
      'code', split_part(v_conflict_message, ':', 1),
      'sqlstate', v_sqlstate,
      'message', v_conflict_message
    );
  -- Any last-moment concurrency failure rolls back this entire function block
  -- and returns data instead of emitting an unhandled PostgreSQL exception.
  WHEN SQLSTATE '40001' THEN
    GET STACKED DIAGNOSTICS v_conflict_message = MESSAGE_TEXT;
    RETURN jsonb_build_object(
      'success', false,
      'conflict', true,
      'code', split_part(v_conflict_message, ':', 1),
      'message', v_conflict_message
    );
  WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_conflict_message = MESSAGE_TEXT;
    RETURN jsonb_build_object(
      'success', false,
      'conflict', true,
      'code', 'UNIQUE_CONSTRAINT_CONFLICT',
      'message', 'A identidade do estoque já foi alterada por outra operação. Recarregue o endereço antes de tentar novamente.'
    );
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    RETURN jsonb_build_object(
      'success', false,
      'conflict', false,
      'code', 'ATOMIC_WRITE_FAILED',
      'sqlstate', v_sqlstate,
      'message', 'A transação foi revertida e a gravação não foi confirmada. Não repita automaticamente; atualize e confira o endereço.'
    );
END;
$function$;

CREATE FUNCTION public.apply_stock_mutation_atomic_with_deletes(p_expected_slots jsonb, p_slots jsonb, p_expected_divergencias jsonb, p_divergencias jsonb, p_history jsonb, p_delete_slot_ids text[], p_operation_type text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_staged_slots jsonb;
  v_payload jsonb;
  v_expected jsonb;
  v_slot public.slots%ROWTYPE;
  v_current_slot public.slots%ROWTYPE;
  v_id text;
  v_sku text;
  v_restriction text;
  v_entries numeric;
  v_exits numeric;
  v_exit_count bigint;
  v_event_count bigint;
  v_deleted_count integer := 0;
  v_result jsonb;
  v_sqlstate text;
  v_message text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF p_operation_type IS NULL OR p_operation_type NOT IN ('launch', 'transfer', 'physical_correction') THEN
    RAISE EXCEPTION 'INVALID_STOCK_OPERATION_TYPE' USING ERRCODE = '22023';
  END IF;
  IF p_operation_type = 'launch' AND public.has_app_permission('stock.launch.create') IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'PERMISSION_DENIED:stock.launch.create' USING ERRCODE = '42501';
  ELSIF p_operation_type = 'transfer' AND public.has_app_permission('stock.transfer.create') IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'PERMISSION_DENIED:stock.transfer.create' USING ERRCODE = '42501';
  ELSIF p_operation_type = 'physical_correction' AND public.has_app_permission('stock.physical_correction') IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'PERMISSION_DENIED:stock.physical_correction' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_expected_slots) IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_slots) IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_expected_divergencias) IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_divergencias) IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_history) IS DISTINCT FROM 'array'
     OR p_delete_slot_ids IS NULL
     OR cardinality(p_delete_slot_ids) < 1
     OR cardinality(p_delete_slot_ids) > 10000 THEN
    RAISE EXCEPTION 'INVALID_SLOT_DELETE_PAYLOAD' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_delete_slot_ids) AS d(id) WHERE d.id IS NULL OR btrim(d.id) = '')
     OR cardinality(p_delete_slot_ids) <> (SELECT count(DISTINCT d.id) FROM unnest(p_delete_slot_ids) AS d(id)) THEN
    RAISE EXCEPTION 'DUPLICATE_OR_EMPTY_SLOT_DELETE_ID' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_expected_slots) e(value)
       WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_slots) n(value) WHERE n.value->>'id'=e.value->>'id')
         AND NOT (e.value->>'id' = ANY(p_delete_slot_ids))
     )
     OR EXISTS (
       SELECT 1 FROM unnest(p_delete_slot_ids) d(id)
       WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_expected_slots) e(value) WHERE e.value->>'id'=d.id)
     )
     OR EXISTS (
       SELECT 1 FROM unnest(p_delete_slot_ids) d(id)
       WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(p_slots) n(value) WHERE n.value->>'id'=d.id)
     ) THEN
    RAISE EXCEPTION 'SLOT_DELETE_SET_MISMATCH' USING ERRCODE = '22023';
  END IF;

  /* Validate immutable identity before invoking the existing optimistic writer. */
  FOREACH v_id IN ARRAY p_delete_slot_ids LOOP
    SELECT e.value INTO v_expected
      FROM jsonb_array_elements(p_expected_slots) e(value)
     WHERE e.value->>'id' = v_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'SLOT_DELETE_ID_NOT_IN_SNAPSHOT: %', v_id USING ERRCODE = '22023';
    END IF;
    SELECT r.* INTO v_slot FROM jsonb_populate_record(NULL::public.slots, v_expected) r;
    v_sku := upper(btrim(coalesce(v_slot.referencia,'')));
    v_restriction := lower(coalesce(nullif(btrim(v_slot.restricao),''),'nenhuma'));
    IF v_sku = '' OR v_sku = 'VAZIO' OR coalesce(v_slot.saldo,0) <= 0 THEN
      RAISE EXCEPTION 'SLOT_DELETE_REQUIRES_POSITIVE_STOCK: %', v_id USING ERRCODE = '22023';
    END IF;
    IF v_slot.estoque = '1' THEN
      IF coalesce(v_slot.posicao,'') <> ''
         OR v_slot.id <> '1-' || v_slot.modulo || '-' || v_sku THEN
        RAISE EXCEPTION 'SLOT_DELETE_NONCANONICAL_E1_ID: %', v_id USING ERRCODE = '22023';
      END IF;
    ELSIF v_slot.estoque IN ('2','3') THEN
      IF v_slot.id = v_slot.estoque || '-' || v_slot.modulo || '-' || v_slot.posicao
         OR v_slot.id <> v_slot.estoque || '-' || v_slot.modulo || '-' || v_slot.posicao || '::ITEM::' || v_sku || '::' || v_restriction THEN
        RAISE EXCEPTION 'SLOT_DELETE_NONCANONICAL_AUXILIARY_ID: %', v_id USING ERRCODE = '22023';
      END IF;
    ELSE
      RAISE EXCEPTION 'SLOT_DELETE_UNSUPPORTED_STOCK: %', v_id USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_history) h(value)
      WHERE h.value->>'slot_id'=v_id
        AND coalesce(h.value->>'tipo','')='Saída'
    ) THEN
      RAISE EXCEPTION 'SLOT_DELETE_REQUIRES_MATCHING_EXIT: %', v_id USING ERRCODE = '22023';
    END IF;
    /* Every audit event for a deleted identity must retain that exact old ID;
       an event for the same SKU/address under another slot_id is not acceptable. */
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_history) h(value)
      WHERE upper(btrim(coalesce(h.value->>'estoque',''))) = v_slot.estoque
        AND regexp_replace(upper(btrim(coalesce(h.value->>'modulo',''))),'^[MR]','') = v_slot.modulo
        AND upper(btrim(coalesce(h.value->>'posicao',''))) = coalesce(v_slot.posicao,'')
        AND upper(btrim(coalesce(h.value->>'referencia',''))) = v_sku
        AND lower(coalesce(nullif(btrim(h.value->>'restricao'),''),'nenhuma')) = v_restriction
        AND h.value->>'slot_id' IS DISTINCT FROM v_id
    ) THEN
      RAISE EXCEPTION 'SLOT_DELETE_HISTORY_SPLIT_IDENTITY: %', v_id USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_history) h(value)
      WHERE h.value->>'slot_id'=v_id
        AND (
          coalesce(h.value->>'estoque','') IS DISTINCT FROM v_slot.estoque
          OR coalesce(regexp_replace(upper(btrim(coalesce(h.value->>'modulo',''))),'^[MR]',''),'') IS DISTINCT FROM v_slot.modulo
          OR coalesce(upper(btrim(coalesce(h.value->>'posicao',''))),'') IS DISTINCT FROM coalesce(v_slot.posicao,'')
          OR upper(btrim(coalesce(h.value->>'referencia',''))) IS DISTINCT FROM v_sku
          OR lower(coalesce(nullif(btrim(h.value->>'restricao'),''),'nenhuma')) IS DISTINCT FROM v_restriction
          OR coalesce(h.value->>'tipo','') NOT IN ('Entrada','Saída')
          OR coalesce(h.value->>'quantidade','') !~ '^[1-9][0-9]*$'
        )
    ) THEN
      RAISE EXCEPTION 'SLOT_DELETE_HISTORY_IDENTITY_MISMATCH: %', v_id USING ERRCODE = '22023';
    END IF;
    SELECT count(*), count(*) FILTER (WHERE h.value->>'tipo'='Saída'),
           coalesce(sum(CASE WHEN h.value->>'tipo'='Entrada' THEN (h.value->>'quantidade')::numeric ELSE 0 END),0),
           coalesce(sum(CASE WHEN h.value->>'tipo'='Saída' THEN (h.value->>'quantidade')::numeric ELSE 0 END),0)
      INTO v_event_count, v_exit_count, v_entries, v_exits
      FROM jsonb_array_elements(p_history) h(value)
     WHERE h.value->>'slot_id'=v_id;
    IF v_event_count = 0 OR v_exit_count = 0 OR v_slot.saldo::numeric + v_entries - v_exits <> 0 THEN
      RAISE EXCEPTION 'SLOT_DELETE_BALANCE_NOT_ZERO: %', v_id USING ERRCODE = '22023';
    END IF;
  END LOOP;

  /* Supply blank transient rows to the existing writer so its snapshot and history
     checks still run unchanged. The wrapper deletes these rows before its own
     transaction succeeds; the intermediate blank state is never committed. */
  SELECT coalesce(jsonb_agg(staged.row_value ORDER BY staged.row_value->>'id'), '[]'::jsonb)
    INTO v_staged_slots
    FROM (
      SELECT n.value AS row_value
        FROM jsonb_array_elements(p_slots) n(value)
      UNION ALL
      SELECT
        jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(
                jsonb_set(
                  jsonb_set(
                    jsonb_set(
                      jsonb_set(
                        jsonb_set(e.value, '{referencia}', '""'::jsonb, true),
                        '{descricao}', '""'::jsonb, true),
                      '{saldo}', '0'::jsonb, true),
                    '{dataChacote}', '""'::jsonb, true),
                  '{galpao}', '"3"'::jsonb, true),
                '{restricao}', '"nenhuma"'::jsonb, true),
              '{observacao}', '""'::jsonb, true),
            '{ultimaData}', to_jsonb(coalesce(h.movement_date, e.value->>'ultimaData','')), true),
          '{ultimaHora}', to_jsonb(coalesce(h.movement_time, e.value->>'ultimaHora','')), true)
        || jsonb_build_object('ultimoResponsavel', coalesce(h.operator_name, e.value->>'ultimoResponsavel','')) AS row_value
        FROM jsonb_array_elements(p_expected_slots) e(value)
        JOIN unnest(p_delete_slot_ids) d(id) ON d.id=e.value->>'id'
        LEFT JOIN LATERAL (
          SELECT h.value->>'data' AS movement_date,
                 h.value->>'hora' AS movement_time,
                 coalesce(h.value->>'responsavel',h.value->>'quemLancou','') AS operator_name
            FROM jsonb_array_elements(p_history) h(value)
           WHERE h.value->>'slot_id'=d.id
           ORDER BY coalesce(h.value->>'data','') DESC, coalesce(h.value->>'hora','') DESC, h.value->>'id' DESC
           LIMIT 1
        ) h ON true
    ) staged;

  v_result := public.apply_stock_mutation_atomic(
    p_expected_slots, v_staged_slots, p_expected_divergencias, p_divergencias, p_history, p_operation_type
  );
  IF coalesce((v_result->>'success')::boolean,false) IS NOT TRUE THEN
    RETURN v_result;
  END IF;

  /* The underlying writer has locked and validated the full scope. Recheck the
     just-written blank rows, other live identities, and open divergence guards. */
  FOREACH v_id IN ARRAY p_delete_slot_ids LOOP
    SELECT e.value INTO v_expected FROM jsonb_array_elements(p_expected_slots) e(value) WHERE e.value->>'id'=v_id;
    SELECT r.* INTO v_slot FROM jsonb_populate_record(NULL::public.slots, v_expected) r;
    v_sku := upper(btrim(coalesce(v_slot.referencia,'')));
    v_restriction := lower(coalesce(nullif(btrim(v_slot.restricao),''),'nenhuma'));

    SELECT s.* INTO v_current_slot FROM public.slots s WHERE s.id=v_id FOR UPDATE;
    IF NOT FOUND OR coalesce(v_current_slot.referencia,'') <> '' OR coalesce(v_current_slot.saldo,0) <> 0 THEN
      RAISE EXCEPTION 'SLOT_DELETE_TRANSIENT_CLEAR_MISMATCH: %', v_id USING ERRCODE = '40001';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.slots other
      WHERE other.id <> v_id
        AND other.estoque = v_slot.estoque
        AND other.modulo = v_slot.modulo
        AND coalesce(other.posicao,'') = coalesce(v_slot.posicao,'')
        AND upper(btrim(coalesce(other.referencia,''))) = v_sku
        AND lower(coalesce(nullif(btrim(other.restricao),''),'nenhuma')) = v_restriction
        AND coalesce(other.saldo,0) > 0
    ) THEN
      RAISE EXCEPTION 'SLOT_DELETE_DUPLICATE_LIVE_IDENTITY: %', v_id USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.divergencias d
      WHERE d.estoque = v_slot.estoque AND d.modulo = v_slot.modulo
        AND coalesce(d.posicao,'') = coalesce(v_slot.posicao,'')
        AND lower(btrim(coalesce(d.status,''))) = 'aberta'
        AND (
          d.slot_id = v_id
          OR (
            lower(coalesce(nullif(btrim(d.restricao),''),'nenhuma')) = v_restriction
            AND (
              upper(btrim(coalesce(d."refAtual",''))) = v_sku
              OR upper(btrim(coalesce(d."refNova",''))) = v_sku
            )
          )
          OR (nullif(btrim(coalesce(d.slot_id,'')),'') IS NULL AND nullif(btrim(coalesce(d.restricao,'')),'') IS NULL)
        )
    ) THEN
      RAISE EXCEPTION 'SLOT_DELETE_BLOCKED_BY_OPEN_DIVERGENCE: %', v_id USING ERRCODE = '22023';
    END IF;
  END LOOP;

  DELETE FROM public.slots s WHERE s.id = ANY(p_delete_slot_ids);
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  IF v_deleted_count <> cardinality(p_delete_slot_ids) THEN
    RAISE EXCEPTION 'SLOT_DELETE_COUNT_MISMATCH' USING ERRCODE = '40001';
  END IF;

  v_result := jsonb_set(
    v_result,
    '{slots_written}',
    to_jsonb(greatest(coalesce((v_result->>'slots_written')::integer,0)-v_deleted_count,0)),
    true
  ) || jsonb_build_object('slots_deleted',v_deleted_count);
  RETURN v_result;
EXCEPTION
  WHEN SQLSTATE '42501' THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT, v_sqlstate = RETURNED_SQLSTATE;
    RETURN jsonb_build_object('success',false,'conflict',false,'code',split_part(v_message,':',1),'sqlstate',v_sqlstate,'message',v_message,'slots_deleted',0);
  WHEN SQLSTATE '40001' THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    RETURN jsonb_build_object('success',false,'conflict',true,'code',split_part(v_message,':',1),'message','O estado do endereço mudou durante a exclusão atômica. A transação foi revertida; recarregue o endereço.','slots_deleted',0);
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
    RETURN jsonb_build_object('success',false,'conflict',false,'code',split_part(v_message,':',1),'sqlstate',v_sqlstate,'message','A transação de estoque foi revertida. Nenhuma exclusão foi confirmada; recarregue e confira o endereço.','slots_deleted',0);
END;
$function$;

-- ===== SUBSTITUICAO DOS SETE CONTRATOS DE RASCUNHO EXISTENTES =====

CREATE OR REPLACE FUNCTION public.get_shared_lancamento_draft()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_control public.lancamento_draft_control%ROWTYPE;
  v_lines jsonb;
BEGIN
  -- Visualizador pode consultar o rascunho porque a tela de lançamento está
  -- liberada em modo somente leitura. As RPCs de escrita/processamento seguem
  -- restritas a administrador, liderança e apoio.
  IF auth.uid() IS NULL OR public.has_app_permission('stock.launch.view') IS DISTINCT FROM TRUE THEN
    RETURN jsonb_build_object('success', false, 'code', 'OPERATION_NOT_ALLOWED');
  END IF;

  -- Keep the generation/revision stable while the matching lines are read.
  -- All writers take FOR UPDATE on this row, so this snapshot cannot combine
  -- control metadata from before a batch with line data from after it.
  SELECT c.* INTO v_control
  FROM public.lancamento_draft_control AS c
  WHERE c.singleton IS TRUE
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SHARED_DRAFT_CONTROL_MISSING';
  END IF;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'line_id', l.line_id,
        'row_data', l.row_data,
        'line_revision', l.line_revision,
        'sequence', l.sequence
      ) ORDER BY l.sequence
    ), '[]'::jsonb
  ) INTO v_lines
  FROM public.lancamento_draft_lines AS l
  WHERE l.generation_id = v_control.generation_id;

  RETURN jsonb_build_object(
    'success', true,
    'generation_id', v_control.generation_id,
    'revision', v_control.revision,
    'lines', v_lines
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.upsert_shared_lancamento_draft_lines(
  p_generation_id uuid,
  p_lines jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_control public.lancamento_draft_control%ROWTYPE;
  v_target_generation_id uuid;
  v_line jsonb;
  v_line_id text;
  v_row_data jsonb;
  v_expected_revision bigint;
  v_existing public.lancamento_draft_lines%ROWTYPE;
  v_next_sequence bigint;
  v_new_revision bigint;
  v_current_line_count bigint;
  v_incoming_new_count bigint;
  v_changed boolean := false;
  v_line_results jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL OR public.has_app_permission('stock.launch.create') IS DISTINCT FROM TRUE THEN
    RETURN jsonb_build_object('success', false, 'code', 'OPERATION_NOT_ALLOWED');
  END IF;
  IF p_generation_id IS NULL OR jsonb_typeof(p_lines) IS DISTINCT FROM 'array' THEN
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_DRAFT_LINES_PAYLOAD');
  END IF;
  IF jsonb_array_length(p_lines) > 5000 THEN
    RETURN jsonb_build_object('success', false, 'code', 'DRAFT_LINES_PAYLOAD_TOO_LARGE');
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_lines) AS item(value)
    WHERE jsonb_typeof(item.value) IS DISTINCT FROM 'object'
       OR coalesce(item.value->>'line_id','') = ''
       OR jsonb_typeof(item.value->'row_data') IS DISTINCT FROM 'object'
       OR item.value->>'line_id' IS DISTINCT FROM item.value->'row_data'->>'id'
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_lines) AS item(value)
    GROUP BY item.value->>'line_id' HAVING count(*) > 1
  ) THEN
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_OR_DUPLICATE_DRAFT_LINE');
  END IF;

  SELECT c.* INTO v_control
  FROM public.lancamento_draft_control AS c
  WHERE c.singleton IS TRUE
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SHARED_DRAFT_CONTROL_MISSING';
  END IF;
  v_target_generation_id := v_control.generation_id;
  IF v_control.generation_id IS DISTINCT FROM p_generation_id THEN
    -- New lines that lost the race with batch finalization are safe to place in
    -- the next active draft. Edits to old lines remain conflicts, because the
    -- old row may already have been processed from a prior snapshot.
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_lines) AS item(value)
      WHERE nullif(item.value->>'expected_line_revision','') IS NOT NULL
    ) THEN
      RETURN jsonb_build_object('success', false, 'conflict', true, 'code', 'DRAFT_GENERATION_CONFLICT');
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_lines) AS item(value)
      JOIN public.lancamento_draft_archive_lines AS a ON a.line_id = item.value->>'line_id'
    ) THEN
      RETURN jsonb_build_object('success', false, 'conflict', true, 'code', 'DRAFT_LINE_ALREADY_ARCHIVED');
    END IF;
  END IF;

  -- Validate the complete request before writing any row.
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    v_line_id := v_line->>'line_id';
    v_row_data := v_line->'row_data';
    v_expected_revision := nullif(v_line->>'expected_line_revision','')::bigint;

    SELECT l.* INTO v_existing
    FROM public.lancamento_draft_lines AS l
    WHERE l.generation_id = v_target_generation_id AND l.line_id = v_line_id;

    IF FOUND THEN
      -- A new-line save may have committed even if its response was lost. If the
      -- same line ID and exact payload are already present, treat the repeat as
      -- idempotent success. Reusing the ID with different contents still conflicts.
      IF v_expected_revision IS NULL THEN
        IF v_existing.row_data IS DISTINCT FROM v_row_data THEN
          RETURN jsonb_build_object(
            'success', false, 'conflict', true, 'code', 'DRAFT_LINE_CONFLICT',
            'line_id', v_line_id, 'current_line_revision', v_existing.line_revision
          );
        END IF;
      ELSIF v_expected_revision <> v_existing.line_revision THEN
        RETURN jsonb_build_object(
          'success', false, 'conflict', true, 'code', 'DRAFT_LINE_CONFLICT',
          'line_id', v_line_id, 'current_line_revision', v_existing.line_revision
        );
      END IF;
    ELSE
      IF v_expected_revision IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'conflict', true, 'code', 'DRAFT_LINE_MISSING', 'line_id', v_line_id);
      END IF;
      IF EXISTS (SELECT 1 FROM public.lancamento_draft_archive_lines a WHERE a.line_id = v_line_id) THEN
        RETURN jsonb_build_object('success', false, 'conflict', true, 'code', 'DRAFT_LINE_ALREADY_ARCHIVED', 'line_id', v_line_id);
      END IF;
    END IF;
  END LOOP;

  -- The batch RPC has the same 5,000-line limit. Enforce that cap across all
  -- incremental save calls, otherwise the UI could create a draft that can no
  -- longer be processed by the batch RPC.
  SELECT count(*) INTO v_current_line_count
  FROM public.lancamento_draft_lines AS l
  WHERE l.generation_id = v_target_generation_id;
  SELECT count(*) INTO v_incoming_new_count
  FROM jsonb_array_elements(p_lines) AS item(value)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.lancamento_draft_lines AS l
    WHERE l.generation_id = v_target_generation_id
      AND l.line_id = item.value->>'line_id'
  );
  IF v_current_line_count + v_incoming_new_count > 5000 THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'DRAFT_TOTAL_CAPACITY_EXCEEDED',
      'message', 'O rascunho compartilhado atingiu o limite de 5.000 linhas ativas. Remova ou descarte linhas antes de acrescentar novas.',
      'max_lines', 5000,
      'current_lines', v_current_line_count,
      'requested_new_lines', v_incoming_new_count
    );
  END IF;

  v_next_sequence := v_control.next_sequence;
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    v_line_id := v_line->>'line_id';
    v_row_data := v_line->'row_data';
    v_expected_revision := nullif(v_line->>'expected_line_revision','')::bigint;

    SELECT l.* INTO v_existing
    FROM public.lancamento_draft_lines AS l
    WHERE l.generation_id = v_target_generation_id AND l.line_id = v_line_id;

    IF FOUND THEN
      IF v_existing.row_data IS DISTINCT FROM v_row_data THEN
        UPDATE public.lancamento_draft_lines AS l
        SET row_data = v_row_data,
            line_revision = l.line_revision + 1,
            updated_by = auth.uid(),
            updated_at = clock_timestamp()
        WHERE l.generation_id = v_target_generation_id AND l.line_id = v_line_id
        RETURNING l.* INTO v_existing;
        v_changed := true;
      END IF;
    ELSE
      INSERT INTO public.lancamento_draft_lines (
        generation_id, line_id, sequence, row_data, line_revision,
        created_by, updated_by, created_at, updated_at
      ) VALUES (
        v_target_generation_id, v_line_id, v_next_sequence, v_row_data, 1,
        auth.uid(), auth.uid(), clock_timestamp(), clock_timestamp()
      ) RETURNING * INTO v_existing;
      v_next_sequence := v_next_sequence + 1;
      v_changed := true;
    END IF;

    v_line_results := v_line_results || jsonb_build_array(jsonb_build_object(
      'line_id', v_existing.line_id,
      'line_revision', v_existing.line_revision,
      'sequence', v_existing.sequence,
      'row_data', v_existing.row_data
    ));
  END LOOP;

  v_new_revision := v_control.revision;
  IF v_changed THEN
    v_new_revision := v_control.revision + 1;
    UPDATE public.lancamento_draft_control AS c
    SET revision = v_new_revision,
        next_sequence = v_next_sequence,
        updated_by = auth.uid(),
        updated_at = clock_timestamp()
    WHERE c.singleton IS TRUE;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'generation_id', v_target_generation_id,
    'revision', v_new_revision,
    'line_revisions', v_line_results
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_shared_lancamento_draft_line(
  p_generation_id uuid,
  p_line_id text,
  p_expected_line_revision bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_control public.lancamento_draft_control%ROWTYPE;
  v_line public.lancamento_draft_lines%ROWTYPE;
  v_new_revision bigint;
BEGIN
  IF auth.uid() IS NULL OR public.has_app_permission('stock.launch.create') IS DISTINCT FROM TRUE THEN
    RETURN jsonb_build_object('success', false, 'code', 'OPERATION_NOT_ALLOWED');
  END IF;
  IF p_generation_id IS NULL OR coalesce(btrim(p_line_id),'') = '' OR p_expected_line_revision IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_DRAFT_LINE_DELETE');
  END IF;

  SELECT c.* INTO v_control
  FROM public.lancamento_draft_control AS c
  WHERE c.singleton IS TRUE FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHARED_DRAFT_CONTROL_MISSING'; END IF;
  IF v_control.generation_id IS DISTINCT FROM p_generation_id THEN
    RETURN jsonb_build_object('success', false, 'conflict', true, 'code', 'DRAFT_GENERATION_CONFLICT');
  END IF;

  SELECT l.* INTO v_line
  FROM public.lancamento_draft_lines AS l
  WHERE l.generation_id = p_generation_id AND l.line_id = p_line_id;
  IF NOT FOUND THEN
    -- If the delete committed but its response was lost, acknowledge the same
    -- discarded line instead of making the caller believe a new conflict exists.
    IF EXISTS (
      SELECT 1 FROM public.lancamento_draft_archive_lines AS a
      WHERE a.line_id = p_line_id
        AND a.generation_id = p_generation_id
        AND a.disposition = 'discarded'
    ) THEN
      RETURN jsonb_build_object(
        'success', true, 'already_deleted', true,
        'generation_id', p_generation_id, 'revision', v_control.revision,
        'line_id', p_line_id
      );
    END IF;
    RETURN jsonb_build_object('success', false, 'conflict', true, 'code', 'DRAFT_LINE_CONFLICT', 'line_id', p_line_id);
  END IF;
  IF v_line.line_revision <> p_expected_line_revision THEN
    RETURN jsonb_build_object('success', false, 'conflict', true, 'code', 'DRAFT_LINE_CONFLICT', 'line_id', p_line_id, 'current_line_revision', v_line.line_revision);
  END IF;

  INSERT INTO public.lancamento_draft_archive_lines (
    line_id, generation_id, sequence, row_data, disposition, batch_id,
    created_by, updated_by, archived_by, created_at, updated_at
  ) VALUES (
    v_line.line_id, v_line.generation_id, v_line.sequence, v_line.row_data, 'discarded', NULL,
    v_line.created_by, v_line.updated_by, auth.uid(), v_line.created_at, v_line.updated_at
  );
  DELETE FROM public.lancamento_draft_lines l
  WHERE l.generation_id = p_generation_id AND l.line_id = p_line_id;

  v_new_revision := v_control.revision + 1;
  UPDATE public.lancamento_draft_control AS c
  SET revision = v_new_revision, updated_by = auth.uid(), updated_at = clock_timestamp()
  WHERE c.singleton IS TRUE;

  RETURN jsonb_build_object('success', true, 'generation_id', p_generation_id, 'revision', v_new_revision, 'line_id', p_line_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.clear_shared_lancamento_draft(
  p_generation_id uuid,
  p_expected_revision bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_control public.lancamento_draft_control%ROWTYPE;
  v_next_generation uuid;
  v_archived_count bigint;
BEGIN
  IF auth.uid() IS NULL OR public.has_app_permission('stock.launch.create') IS DISTINCT FROM TRUE OR public.has_app_permission('stock.batch.process') IS DISTINCT FROM TRUE THEN
    RETURN jsonb_build_object('success', false, 'code', 'OPERATION_NOT_ALLOWED');
  END IF;
  IF p_generation_id IS NULL OR p_expected_revision IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_DRAFT_CLEAR');
  END IF;

  SELECT c.* INTO v_control
  FROM public.lancamento_draft_control AS c
  WHERE c.singleton IS TRUE FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHARED_DRAFT_CONTROL_MISSING'; END IF;
  IF v_control.generation_id IS DISTINCT FROM p_generation_id OR v_control.revision <> p_expected_revision THEN
    RETURN jsonb_build_object('success', false, 'conflict', true, 'code', 'DRAFT_REVISION_CONFLICT', 'current_revision', v_control.revision);
  END IF;

  INSERT INTO public.lancamento_draft_archive_lines (
    line_id, generation_id, sequence, row_data, disposition, batch_id,
    created_by, updated_by, archived_by, created_at, updated_at
  )
  SELECT l.line_id, l.generation_id, l.sequence, l.row_data, 'discarded', NULL,
         l.created_by, l.updated_by, auth.uid(), l.created_at, l.updated_at
  FROM public.lancamento_draft_lines AS l
  WHERE l.generation_id = p_generation_id;
  GET DIAGNOSTICS v_archived_count = ROW_COUNT;

  DELETE FROM public.lancamento_draft_lines AS l WHERE l.generation_id = p_generation_id;
  v_next_generation := gen_random_uuid();
  UPDATE public.lancamento_draft_control AS c
  SET generation_id = v_next_generation,
      revision = 0,
      next_sequence = 1,
      updated_by = auth.uid(),
      updated_at = clock_timestamp()
  WHERE c.singleton IS TRUE;

  RETURN jsonb_build_object('success', true, 'previous_generation_id', p_generation_id, 'generation_id', v_next_generation, 'revision', 0, 'archived_count', v_archived_count);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_shared_lancamento_batch_result(p_batch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_run public.lancamento_batch_runs%ROWTYPE;
  v_control public.lancamento_draft_control%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR public.has_app_permission('stock.batch.process') IS DISTINCT FROM TRUE THEN
    RETURN jsonb_build_object('success', false, 'code', 'OPERATION_NOT_ALLOWED');
  END IF;
  IF p_batch_id IS NULL THEN RETURN jsonb_build_object('success', false, 'code', 'INVALID_BATCH_ID'); END IF;

  -- Wait for any in-flight batch transaction. A plain SELECT could report
  -- BATCH_NOT_FOUND while that transaction is still uncommitted.
  SELECT c.* INTO v_control
  FROM public.lancamento_draft_control AS c
  WHERE c.singleton IS TRUE
  FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHARED_DRAFT_CONTROL_MISSING'; END IF;

  SELECT r.* INTO v_run FROM public.lancamento_batch_runs AS r WHERE r.batch_id = p_batch_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'code', 'BATCH_NOT_FOUND'); END IF;
  RETURN jsonb_build_object(
    'success', true,
    'already_processed', true,
    'batch_id', v_run.batch_id,
    'generation_id', v_run.generation_id,
    'draft_revision', v_run.draft_revision,
    'result_summary', v_run.result_summary,
    'created_at', v_run.created_at
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.shared_draft_slot_identity_is_inconsistent(p_slot public.slots)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $function$
DECLARE
  v_raw_stock text := btrim(coalesce(p_slot.estoque, ''));
  v_stock text;
  v_raw_module text := btrim(coalesce(p_slot.modulo, ''));
  v_clean_module text;
  v_module text;
  v_raw_position text := coalesce(p_slot.posicao, '');
  v_position text;
  v_base_id text;
  v_prefix text;
  v_marker integer;
  v_suffix text;
  v_encoded_sku text;
  v_encoded_restriction text;
  v_stored_sku text := upper(btrim(coalesce(p_slot.referencia, '')));
  v_stored_restriction text;
  v_occupied_or_referenced boolean;
BEGIN
  v_stock := upper(v_raw_stock);
  IF left(v_stock, 1) = 'E' THEN v_stock := substring(v_stock FROM 2); END IF;
  IF v_raw_stock IS DISTINCT FROM v_stock THEN RETURN true; END IF;

  v_clean_module := regexp_replace(upper(v_raw_module), '^[MR]', '');
  IF v_clean_module ~ '^\d+$' THEN
    v_module := ltrim(v_clean_module, '0');
    IF v_module = '' THEN v_module := '0'; END IF;
  ELSE
    v_module := v_clean_module;
  END IF;
  IF v_raw_module IS DISTINCT FROM v_module THEN RETURN true; END IF;

  v_position := upper(btrim(v_raw_position));
  IF v_stock = '1' THEN
    IF v_raw_position <> '' THEN RETURN true; END IF;
    v_prefix := '1-' || v_module || '-';
    IF left(coalesce(p_slot.id, ''), length(v_prefix)) IS DISTINCT FROM v_prefix
       OR length(coalesce(p_slot.id, '')) <= length(v_prefix) THEN
      RETURN true;
    END IF;
    v_encoded_sku := upper(btrim(substring(p_slot.id FROM length(v_prefix) + 1)));
    IF v_stored_sku <> '' AND v_stored_sku IS DISTINCT FROM v_encoded_sku THEN RETURN true; END IF;
    RETURN false;
  END IF;

  IF v_stock NOT IN ('2', '3') THEN RETURN false; END IF;
  IF v_raw_position IS DISTINCT FROM v_position THEN RETURN true; END IF;

  v_base_id := v_stock || '-' || v_module || '-' || v_position;
  v_marker := position('::ITEM::' IN coalesce(p_slot.id, ''));
  IF v_marker = 0 THEN
    RETURN p_slot.id IS DISTINCT FROM v_base_id;
  END IF;

  IF substring(p_slot.id FROM 1 FOR v_marker - 1) IS DISTINCT FROM v_base_id THEN RETURN true; END IF;
  v_suffix := substring(p_slot.id FROM v_marker + length('::ITEM::'));
  v_encoded_sku := split_part(v_suffix, '::', 1);
  v_encoded_restriction := lower(btrim(split_part(v_suffix, '::', 2)));
  IF btrim(v_encoded_sku) = '' OR v_encoded_restriction NOT IN ('nenhuma', 'teste', 'autorizacao', 'outra')
     OR length(v_suffix) - length(replace(v_suffix, '::', '')) <> 2 THEN
    RETURN true;
  END IF;

  v_occupied_or_referenced := coalesce(p_slot.saldo, 0) > 0 OR v_stored_sku <> '';
  v_stored_restriction := CASE
    WHEN p_slot.restricao IN ('teste', 'autorizacao', 'outra') THEN p_slot.restricao
    ELSE 'nenhuma'
  END;
  IF v_occupied_or_referenced AND (
    v_stored_sku IS DISTINCT FROM upper(btrim(v_encoded_sku))
    OR v_stored_restriction IS DISTINCT FROM v_encoded_restriction
  ) THEN
    RETURN true;
  END IF;
  RETURN false;
END;
$function$;

CREATE OR REPLACE FUNCTION public.process_shared_lancamento_draft_batch_atomic(
  p_batch_id uuid,
  p_generation_id uuid,
  p_expected_revision bigint,
  p_input_rows jsonb,
  p_result_summary jsonb,
  p_expected_slots jsonb,
  p_slots jsonb,
  p_expected_divergencias jsonb,
  p_divergencias jsonb,
  p_history jsonb,
  p_delete_slot_ids text[] DEFAULT '{}'::text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_control public.lancamento_draft_control%ROWTYPE;
  v_run public.lancamento_batch_runs%ROWTYPE;
  v_current_rows jsonb;
  v_stock_result jsonb;
  v_summary jsonb;
  v_line jsonb;
  v_row_data jsonb;
  v_row_id text;
  v_safe_row_id text;
  v_event_count bigint;
  v_divergence_count bigint;
  v_archived_count bigint;
  v_next_generation uuid;
  v_scope_key text;
  v_candidate_scope text;
  v_scope_parts jsonb;
  v_special_scope_keys text[] := ARRAY[]::text[];
  v_invalid_special_scope_keys text[] := ARRAY[]::text[];
  v_divergence jsonb;
  v_payload jsonb;
  v_slot_id text;
  v_current_count bigint;
  v_payload_count bigint;
  v_current_slot public.slots%ROWTYPE;
  v_expected_slot public.slots%ROWTYPE;
  v_current_div public.divergencias%ROWTYPE;
  v_expected_div public.divergencias%ROWTYPE;
  v_layout_row public.warehouse_layout%ROWTYPE;
  v_special_valid boolean;
  v_module_inactive boolean;
  v_bad_identity boolean;
  v_normal_expected_slots jsonb;
  v_normal_slots jsonb;
  v_normal_expected_divergencias jsonb;
  v_normal_divergencias jsonb;
  v_normal_history jsonb;
  v_normal_delete_slot_ids text[] := ARRAY[]::text[];
  v_special_divergences_written bigint := 0;
  v_actor_name text;
BEGIN
  IF auth.uid() IS NULL OR public.has_app_permission('stock.launch.create') IS DISTINCT FROM TRUE OR public.has_app_permission('stock.batch.process') IS DISTINCT FROM TRUE THEN
    RETURN jsonb_build_object('success', false, 'code', 'OPERATION_NOT_ALLOWED');
  END IF;
  SELECT p.name INTO v_actor_name FROM public.profiles AS p WHERE p.id = auth.uid();
  IF coalesce(btrim(v_actor_name), '') = '' THEN
    RETURN jsonb_build_object('success', false, 'code', 'OPERATOR_PROFILE_MISSING');
  END IF;
  IF p_batch_id IS NULL OR p_generation_id IS NULL OR p_expected_revision IS NULL
     OR jsonb_typeof(p_input_rows) IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_result_summary) IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_expected_slots) IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_slots) IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_expected_divergencias) IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_divergencias) IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_history) IS DISTINCT FROM 'array'
     OR p_delete_slot_ids IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_SHARED_DRAFT_BATCH_PAYLOAD');
  END IF;
  IF jsonb_array_length(p_input_rows) > 5000 THEN
    RETURN jsonb_build_object('success', false, 'code', 'SHARED_DRAFT_BATCH_TOO_LARGE');
  END IF;
  IF cardinality(p_delete_slot_ids) <> cardinality(ARRAY(SELECT DISTINCT unnest(p_delete_slot_ids)))
     OR EXISTS (
       SELECT 1 FROM unnest(p_delete_slot_ids) AS del(slot_id)
       WHERE del.slot_id IS NULL OR btrim(del.slot_id) = ''
          OR NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(p_expected_slots) AS expected(value)
            WHERE expected.value->>'id' = del.slot_id
          )
     ) THEN
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_SLOT_DELETE_PAYLOAD');
  END IF;

  -- Validate every submitted snapshot array before the special divergence-only
  -- route can bypass the ordinary stock RPC. The regular stock RPC already rejects
  -- duplicate IDs, but that protection must also cover scopes routed around it.
  IF EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_expected_slots) AS x(value)
       WHERE coalesce(x.value->>'id','') = ''
     ) OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_expected_slots) AS x(value)
       GROUP BY x.value->>'id' HAVING count(*) > 1
     ) OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_slots) AS x(value)
       WHERE coalesce(x.value->>'id','') = ''
     ) OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_slots) AS x(value)
       GROUP BY x.value->>'id' HAVING count(*) > 1
     ) OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_expected_divergencias) AS x(value)
       WHERE coalesce(x.value->>'id','') = ''
     ) OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_expected_divergencias) AS x(value)
       GROUP BY x.value->>'id' HAVING count(*) > 1
     ) OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_divergencias) AS x(value)
       WHERE coalesce(x.value->>'id','') = ''
     ) OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_divergencias) AS x(value)
       GROUP BY x.value->>'id' HAVING count(*) > 1
     ) OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_history) AS x(value)
       WHERE coalesce(x.value->>'id','') = ''
     ) OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_history) AS x(value)
       GROUP BY x.value->>'id' HAVING count(*) > 1
     ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'DUPLICATE_OR_EMPTY_STOCK_PAYLOAD_IDS',
      'message', 'O lote contém IDs vazios ou duplicados no snapshot de estoque, divergências ou histórico.'
    );
  END IF;

  -- Fast path for retries after a lost response. A second check is made after
  -- locking the control row so simultaneous requests with the same ID are safe.
  SELECT r.* INTO v_run FROM public.lancamento_batch_runs AS r WHERE r.batch_id = p_batch_id;
  IF FOUND THEN
    IF v_run.generation_id IS DISTINCT FROM p_generation_id
       OR v_run.draft_revision IS DISTINCT FROM p_expected_revision THEN
      RETURN jsonb_build_object('success', false, 'conflict', true, 'code', 'BATCH_IDEMPOTENCY_KEY_COLLISION');
    END IF;
    RETURN jsonb_build_object('success', true, 'already_processed', true, 'batch_id', v_run.batch_id,
      'generation_id', v_run.generation_id, 'draft_revision', v_run.draft_revision,
      'result_summary', v_run.result_summary, 'created_at', v_run.created_at);
  END IF;

  SELECT c.* INTO v_control
  FROM public.lancamento_draft_control AS c
  WHERE c.singleton IS TRUE FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHARED_DRAFT_CONTROL_MISSING'; END IF;

  SELECT r.* INTO v_run FROM public.lancamento_batch_runs AS r WHERE r.batch_id = p_batch_id;
  IF FOUND THEN
    IF v_run.generation_id IS DISTINCT FROM p_generation_id
       OR v_run.draft_revision IS DISTINCT FROM p_expected_revision THEN
      RETURN jsonb_build_object('success', false, 'conflict', true, 'code', 'BATCH_IDEMPOTENCY_KEY_COLLISION');
    END IF;
    RETURN jsonb_build_object('success', true, 'already_processed', true, 'batch_id', v_run.batch_id,
      'generation_id', v_run.generation_id, 'draft_revision', v_run.draft_revision,
      'result_summary', v_run.result_summary, 'created_at', v_run.created_at);
  END IF;

  IF v_control.generation_id IS DISTINCT FROM p_generation_id THEN
    RETURN jsonb_build_object('success', false, 'conflict', true, 'code', 'DRAFT_GENERATION_CONFLICT',
      'current_generation_id', v_control.generation_id);
  END IF;
  IF v_control.revision <> p_expected_revision THEN
    RETURN jsonb_build_object('success', false, 'conflict', true, 'code', 'DRAFT_REVISION_CONFLICT',
      'current_revision', v_control.revision);
  END IF;

  SELECT coalesce(
    jsonb_agg(jsonb_build_object(
      'line_id', l.line_id,
      'row_data', l.row_data,
      'line_revision', l.line_revision,
      'sequence', l.sequence
    ) ORDER BY l.sequence),
    '[]'::jsonb
  ) INTO v_current_rows
  FROM public.lancamento_draft_lines AS l
  WHERE l.generation_id = p_generation_id;

  IF v_current_rows IS DISTINCT FROM p_input_rows THEN
    RETURN jsonb_build_object('success', false, 'conflict', true, 'code', 'DRAFT_SNAPSHOT_MISMATCH');
  END IF;

  -- Never silently discard partially filled rows just because the SKU is blank.
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_input_rows)
  LOOP
    v_row_data := v_line->'row_data';
    IF jsonb_typeof(v_row_data) IS DISTINCT FROM 'object'
       OR coalesce(v_line->>'line_id','') IS DISTINCT FROM v_row_data->>'id' THEN
      RETURN jsonb_build_object('success', false, 'code', 'INVALID_DRAFT_ROW');
    END IF;

    IF coalesce(btrim(v_row_data->>'referencia'),'') = '' THEN
      IF coalesce(btrim(v_row_data->>'data'),'') <> ''
         OR coalesce(btrim(v_row_data->>'estoque'),'1') NOT IN ('', '1')
         OR coalesce(btrim(v_row_data->>'modulo'),'') <> ''
         OR coalesce(btrim(v_row_data->>'posicao'),'') <> ''
         OR coalesce(v_row_data->>'quantidade','') NOT IN ('', 'null')
         OR coalesce(btrim(v_row_data->>'tipo'),'') <> ''
         OR coalesce(btrim(v_row_data->>'dataChacote'),'') <> ''
         OR coalesce(btrim(v_row_data->>'hora'),'') <> ''
         OR coalesce(btrim(v_row_data->>'responsavel'),'') <> ''
         OR coalesce(btrim(v_row_data->>'observacao'),'') <> ''
         OR coalesce(btrim(v_row_data->>'galpao'),'3') NOT IN ('', '3')
         OR coalesce(btrim(v_row_data->>'restricao'),'nenhuma') NOT IN ('', 'nenhuma') THEN
        RETURN jsonb_build_object('success', false, 'code', 'DRAFT_LINE_INCOMPLETE', 'line_id', v_line->>'line_id');
      END IF;
      CONTINUE;
    END IF;

    v_row_id := v_row_data->>'id';
    v_safe_row_id := left(regexp_replace(v_row_id, '[^A-Za-z0-9_-]', '_', 'g'), 80);
    SELECT count(*) INTO v_event_count
    FROM jsonb_array_elements(p_history) AS h(value)
    WHERE left(coalesce(h.value->>'id',''), length('MOV-' || v_safe_row_id || '-')) = 'MOV-' || v_safe_row_id || '-';

    SELECT count(*) INTO v_divergence_count
    FROM jsonb_array_elements(p_divergencias) AS d(value)
    WHERE left(coalesce(d.value->>'id',''), length('DIV-' || v_safe_row_id || '-')) = 'DIV-' || v_safe_row_id || '-'
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_expected_divergencias) AS old(value)
        WHERE old.value->>'id' = d.value->>'id'
      );

    IF v_event_count + v_divergence_count <> 1 THEN
      RETURN jsonb_build_object('success', false, 'code', 'DRAFT_LINE_WITHOUT_SINGLE_RESULT', 'line_id', v_line->>'line_id');
    END IF;
  END LOOP;

  -- Lock all scopes in a deterministic order before checking snapshots or routing
  -- safe divergence-only scopes. Existing stock RPCs acquire the same locks again;
  -- transaction-level advisory locks are re-entrant for this backend.
  FOR v_scope_key IN
    SELECT DISTINCT public.stock_address_lock_key(
      payload.value->>'estoque', payload.value->>'modulo', coalesce(payload.value->>'posicao','')
    ) AS key
    FROM (
      SELECT value FROM jsonb_array_elements(p_expected_slots)
      UNION ALL SELECT value FROM jsonb_array_elements(p_slots)
      UNION ALL SELECT value FROM jsonb_array_elements(p_expected_divergencias)
      UNION ALL SELECT value FROM jsonb_array_elements(p_divergencias)
      UNION ALL SELECT value FROM jsonb_array_elements(p_history)
    ) AS payload(value)
    ORDER BY key
  LOOP
    PERFORM public.lock_stock_address_key(v_scope_key);
  END LOOP;

  -- The ordinary stock writer intentionally refuses inactive/unknown physical
  -- locations and malformed address identities. Those can still produce a valid
  -- business divergence when—and only when—the corresponding scope is completely
  -- unchanged, contains no movement/deletion, and the database independently
  -- confirms the exact operational conflict. Route such a scope around the stock
  -- writer; no slot or history data is changed by this exception.
  FOR v_line IN
    SELECT d.value
    FROM jsonb_array_elements(p_divergencias) AS d(value)
    WHERE d.value->>'tipoDivergencia' IN ('Módulo Inativo', 'ID de Endereço Inconsistente')
      AND coalesce(d.value->>'status','') = 'Aberta'
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_expected_divergencias) AS old(value)
        WHERE old.value->>'id' = d.value->>'id'
      )
    ORDER BY d.value->>'id'
  LOOP
    v_divergence := v_line;
    v_candidate_scope := public.stock_address_lock_key(
      v_divergence->>'estoque', v_divergence->>'modulo', coalesce(v_divergence->>'posicao','')
    );
    v_special_valid := true;

    -- All newly produced results at a special scope must be the root conflict
    -- or its explicit blocked-position follow-up, and all must remain open.
    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_divergencias) AS d(value)
      WHERE public.stock_address_lock_key(
          d.value->>'estoque', d.value->>'modulo', coalesce(d.value->>'posicao','')
        ) = v_candidate_scope
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(p_expected_divergencias) AS old(value)
          WHERE old.value->>'id' = d.value->>'id'
        )
        AND (
          coalesce(d.value->>'status','') <> 'Aberta'
          OR CASE v_divergence->>'tipoDivergencia'
               WHEN 'Módulo Inativo' THEN d.value->>'tipoDivergencia' <> 'Módulo Inativo'
               ELSE d.value->>'tipoDivergencia' NOT IN ('ID de Endereço Inconsistente','Posição Bloqueada por Divergência')
             END
        )
    ) THEN
      v_special_valid := false;
    END IF;

    -- A special scope may not change/add/remove a stock identity, write history,
    -- or delete a slot. Check the complete pre/post arrays, not just touched IDs.
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_history) AS h(value)
      WHERE public.stock_address_lock_key(h.value->>'estoque',h.value->>'modulo',coalesce(h.value->>'posicao','')) = v_candidate_scope
    ) OR EXISTS (
      SELECT 1 FROM unnest(p_delete_slot_ids) AS del(slot_id)
      JOIN jsonb_array_elements(p_expected_slots) AS e(value) ON e.value->>'id' = del.slot_id
      WHERE public.stock_address_lock_key(e.value->>'estoque',e.value->>'modulo',coalesce(e.value->>'posicao','')) = v_candidate_scope
    ) OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_expected_slots) AS e(value)
      WHERE public.stock_address_lock_key(e.value->>'estoque',e.value->>'modulo',coalesce(e.value->>'posicao','')) = v_candidate_scope
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(p_slots) AS n(value)
          WHERE n.value->>'id' = e.value->>'id' AND n.value = e.value
        )
    ) OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_slots) AS n(value)
      WHERE public.stock_address_lock_key(n.value->>'estoque',n.value->>'modulo',coalesce(n.value->>'posicao','')) = v_candidate_scope
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(p_expected_slots) AS e(value)
          WHERE e.value->>'id' = n.value->>'id' AND e.value = n.value
        )
    ) THEN
      v_special_valid := false;
    END IF;

    -- The expected divergence snapshot must still be complete and unchanged.
    SELECT count(*) INTO v_current_count
    FROM public.divergencias AS d
    WHERE public.stock_address_lock_key(d.estoque,d.modulo,coalesce(d.posicao,'')) = v_candidate_scope;
    SELECT count(*) INTO v_payload_count
    FROM jsonb_array_elements(p_expected_divergencias) AS d(value)
    WHERE public.stock_address_lock_key(d.value->>'estoque',d.value->>'modulo',coalesce(d.value->>'posicao','')) = v_candidate_scope;
    IF v_current_count <> v_payload_count OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_expected_divergencias) AS e(value)
      WHERE public.stock_address_lock_key(e.value->>'estoque',e.value->>'modulo',coalesce(e.value->>'posicao','')) = v_candidate_scope
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(p_divergencias) AS n(value)
          WHERE n.value->>'id' = e.value->>'id' AND n.value = e.value
        )
    ) THEN
      v_special_valid := false;
    END IF;
    FOR v_payload IN
      SELECT e.value FROM jsonb_array_elements(p_expected_divergencias) AS e(value)
      WHERE public.stock_address_lock_key(e.value->>'estoque',e.value->>'modulo',coalesce(e.value->>'posicao','')) = v_candidate_scope
      ORDER BY e.value->>'id'
    LOOP
      SELECT d.* INTO v_current_div
      FROM public.divergencias AS d WHERE d.id = v_payload->>'id' FOR UPDATE;
      IF NOT FOUND THEN
        v_special_valid := false;
        EXIT;
      END IF;
      SELECT r.* INTO v_expected_div FROM jsonb_populate_record(NULL::public.divergencias,v_payload) AS r;
      IF to_jsonb(v_current_div) IS DISTINCT FROM to_jsonb(v_expected_div) THEN
        v_special_valid := false;
        EXIT;
      END IF;
    END LOOP;

    -- Verify that the database slot snapshot for the scope has not changed.
    SELECT count(*) INTO v_current_count
    FROM public.slots AS s
    WHERE public.stock_address_lock_key(s.estoque,s.modulo,coalesce(s.posicao,'')) = v_candidate_scope;
    SELECT count(*) INTO v_payload_count
    FROM jsonb_array_elements(p_expected_slots) AS s(value)
    WHERE public.stock_address_lock_key(s.value->>'estoque',s.value->>'modulo',coalesce(s.value->>'posicao','')) = v_candidate_scope;
    IF v_current_count <> v_payload_count OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_expected_slots) AS e(value)
      WHERE public.stock_address_lock_key(e.value->>'estoque',e.value->>'modulo',coalesce(e.value->>'posicao','')) = v_candidate_scope
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(p_slots) AS n(value)
          WHERE n.value->>'id' = e.value->>'id' AND n.value = e.value
        )
    ) THEN
      v_special_valid := false;
    END IF;
    -- The special divergence-only route must prove the entire post-state is
    -- exactly the same slot set. Otherwise an unexpected new/duplicate slot in
    -- p_slots could be silently filtered out while the draft is archived.
    SELECT count(*) INTO v_payload_count
    FROM jsonb_array_elements(p_slots) AS s(value)
    WHERE public.stock_address_lock_key(s.value->>'estoque',s.value->>'modulo',coalesce(s.value->>'posicao','')) = v_candidate_scope;
    IF v_current_count <> v_payload_count THEN
      v_special_valid := false;
    END IF;
    FOR v_payload IN
      SELECT e.value FROM jsonb_array_elements(p_expected_slots) AS e(value)
      WHERE public.stock_address_lock_key(e.value->>'estoque',e.value->>'modulo',coalesce(e.value->>'posicao','')) = v_candidate_scope
      ORDER BY e.value->>'id'
    LOOP
      SELECT s.* INTO v_current_slot
      FROM public.slots AS s WHERE s.id = v_payload->>'id' FOR UPDATE;
      IF NOT FOUND THEN
        v_special_valid := false;
        EXIT;
      END IF;
      SELECT r.* INTO v_expected_slot FROM jsonb_populate_record(NULL::public.slots,v_payload) AS r;
      IF to_jsonb(v_current_slot) IS DISTINCT FROM to_jsonb(v_expected_slot) THEN
        v_special_valid := false;
        EXIT;
      END IF;
    END LOOP;

    IF v_divergence->>'tipoDivergencia' = 'Módulo Inativo' THEN
      v_scope_parts := v_candidate_scope::jsonb;
      SELECT l.* INTO v_layout_row
      FROM public.warehouse_layout AS l
      WHERE l.estoque = v_scope_parts->>0
        AND CASE
          WHEN btrim(l.modulo) ~ '^\d+$' THEN (btrim(l.modulo)::numeric)::text
          ELSE btrim(l.modulo)
        END = v_scope_parts->>1
      FOR SHARE;
      IF NOT FOUND OR v_layout_row.ativo IS DISTINCT FROM FALSE THEN
        v_special_valid := false;
      END IF;
    ELSE
      -- The divergence must identify a snapshot row whose immutable ID/data are
      -- unchanged, and the row must still fail the same identity predicate used
      -- by the UI. A fabricated divergence cannot bypass stock safeguards.
      v_slot_id := nullif(v_divergence->>'slot_id','');
      IF v_slot_id IS NULL THEN
        v_special_valid := false;
      ELSE
        SELECT e.value INTO v_payload
        FROM jsonb_array_elements(p_expected_slots) AS e(value)
        WHERE e.value->>'id' = v_slot_id
          AND public.stock_address_lock_key(e.value->>'estoque',e.value->>'modulo',coalesce(e.value->>'posicao','')) = v_candidate_scope;
        IF NOT FOUND THEN
          v_special_valid := false;
        ELSE
          SELECT s.* INTO v_current_slot FROM public.slots AS s WHERE s.id = v_slot_id FOR UPDATE;
          IF NOT FOUND THEN
            v_special_valid := false;
          ELSE
            SELECT r.* INTO v_expected_slot FROM jsonb_populate_record(NULL::public.slots,v_payload) AS r;
            IF to_jsonb(v_current_slot) IS DISTINCT FROM to_jsonb(v_expected_slot)
               OR NOT public.shared_draft_slot_identity_is_inconsistent(v_current_slot) THEN
              v_special_valid := false;
            END IF;
          END IF;
        END IF;
      END IF;
    END IF;

    IF v_special_valid THEN
      IF NOT (v_candidate_scope = ANY(v_special_scope_keys)) THEN
        v_special_scope_keys := array_append(v_special_scope_keys, v_candidate_scope);
      END IF;
    ELSE
      IF NOT (v_candidate_scope = ANY(v_invalid_special_scope_keys)) THEN
        v_invalid_special_scope_keys := array_append(v_invalid_special_scope_keys, v_candidate_scope);
      END IF;
    END IF;
  END LOOP;

  -- If any candidate at a scope failed database verification, process that scope
  -- through the typed launch writer (which rejects unsafe state) rather than granting
  -- a partial exception based on another row at the same address.
  SELECT coalesce(array_agg(k ORDER BY k), ARRAY[]::text[])
  INTO v_special_scope_keys
  FROM (SELECT DISTINCT k FROM unnest(v_special_scope_keys) AS x(k)
        WHERE NOT (k = ANY(v_invalid_special_scope_keys))) AS verified;

  SELECT coalesce(jsonb_agg(p.value ORDER BY p.value->>'id'), '[]'::jsonb) INTO v_normal_expected_slots
  FROM jsonb_array_elements(p_expected_slots) AS p(value)
  WHERE NOT (public.stock_address_lock_key(p.value->>'estoque',p.value->>'modulo',coalesce(p.value->>'posicao','')) = ANY(v_special_scope_keys));
  SELECT coalesce(jsonb_agg(p.value ORDER BY p.value->>'id'), '[]'::jsonb) INTO v_normal_slots
  FROM jsonb_array_elements(p_slots) AS p(value)
  WHERE NOT (public.stock_address_lock_key(p.value->>'estoque',p.value->>'modulo',coalesce(p.value->>'posicao','')) = ANY(v_special_scope_keys));
  SELECT coalesce(jsonb_agg(p.value ORDER BY p.value->>'id'), '[]'::jsonb) INTO v_normal_expected_divergencias
  FROM jsonb_array_elements(p_expected_divergencias) AS p(value)
  WHERE NOT (public.stock_address_lock_key(p.value->>'estoque',p.value->>'modulo',coalesce(p.value->>'posicao','')) = ANY(v_special_scope_keys));
  SELECT coalesce(jsonb_agg(p.value ORDER BY p.value->>'id'), '[]'::jsonb) INTO v_normal_divergencias
  FROM jsonb_array_elements(p_divergencias) AS p(value)
  WHERE NOT (public.stock_address_lock_key(p.value->>'estoque',p.value->>'modulo',coalesce(p.value->>'posicao','')) = ANY(v_special_scope_keys));
  SELECT coalesce(jsonb_agg(p.value ORDER BY p.value->>'id'), '[]'::jsonb) INTO v_normal_history
  FROM jsonb_array_elements(p_history) AS p(value)
  WHERE NOT (public.stock_address_lock_key(p.value->>'estoque',p.value->>'modulo',coalesce(p.value->>'posicao','')) = ANY(v_special_scope_keys));
  SELECT coalesce(array_agg(del.slot_id ORDER BY del.slot_id), ARRAY[]::text[]) INTO v_normal_delete_slot_ids
  FROM unnest(p_delete_slot_ids) AS del(slot_id)
  JOIN jsonb_array_elements(p_expected_slots) AS e(value) ON e.value->>'id' = del.slot_id
  WHERE NOT (public.stock_address_lock_key(e.value->>'estoque',e.value->>'modulo',coalesce(e.value->>'posicao','')) = ANY(v_special_scope_keys));

  IF jsonb_array_length(v_normal_expected_slots) = 0
     AND jsonb_array_length(v_normal_slots) = 0
     AND jsonb_array_length(v_normal_expected_divergencias) = 0
     AND jsonb_array_length(v_normal_divergencias) = 0
     AND jsonb_array_length(v_normal_history) = 0
     AND cardinality(v_normal_delete_slot_ids) = 0 THEN
    v_stock_result := jsonb_build_object('success', true, 'slots_written', 0, 'history_written', 0, 'divergencias_written', 0, 'scopes_locked', 0);
  ELSIF cardinality(v_normal_delete_slot_ids) > 0 THEN
    v_stock_result := public.apply_stock_mutation_atomic_with_deletes(
      v_normal_expected_slots, v_normal_slots, v_normal_expected_divergencias,
      v_normal_divergencias, v_normal_history, v_normal_delete_slot_ids, 'launch'
    );
  ELSE
    v_stock_result := public.apply_stock_mutation_atomic(
      v_normal_expected_slots, v_normal_slots, v_normal_expected_divergencias,
      v_normal_divergencias, v_normal_history, 'launch'
    );
  END IF;

  IF coalesce((v_stock_result->>'success')::boolean, false) IS NOT TRUE THEN
    RETURN v_stock_result;
  END IF;

  -- Special scopes were independently validated and locked above. Insert only
  -- their new open divergences here, after the normal stock transaction succeeded,
  -- so any earlier return cannot leave a partial divergence behind.
  INSERT INTO public.divergencias (
    id, "dataDivergencia", "tipoDivergencia", estoque, modulo, posicao,
    "refAtual", "refNova", "saldoAntes", movimentacao, "saldoFinal",
    responsavel, status, "dataChacote", "dataCorrecao", "corrigidoPor",
    observacao, slot_id, restricao, "correcaoId"
  )
  SELECT
    d.value->>'id', d.value->>'dataDivergencia', d.value->>'tipoDivergencia',
    d.value->>'estoque', d.value->>'modulo', d.value->>'posicao',
    d.value->>'refAtual', d.value->>'refNova',
    nullif(d.value->>'saldoAntes','')::integer,
    nullif(d.value->>'movimentacao','')::integer,
    nullif(d.value->>'saldoFinal','')::integer,
    d.value->>'responsavel', d.value->>'status', d.value->>'dataChacote',
    d.value->>'dataCorrecao', d.value->>'corrigidoPor', d.value->>'observacao',
    d.value->>'slot_id', d.value->>'restricao', nullif(d.value->>'correcaoId','')::uuid
  FROM jsonb_array_elements(p_divergencias) AS d(value)
  WHERE public.stock_address_lock_key(d.value->>'estoque',d.value->>'modulo',coalesce(d.value->>'posicao','')) = ANY(v_special_scope_keys)
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_expected_divergencias) AS old(value)
      WHERE old.value->>'id' = d.value->>'id'
    );
  GET DIAGNOSTICS v_special_divergences_written = ROW_COUNT;

  SELECT count(*) INTO v_divergence_count
  FROM jsonb_array_elements(p_divergencias) AS d(value)
  WHERE NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_expected_divergencias) AS old(value)
    WHERE old.value->>'id' = d.value->>'id'
  );

  v_summary := p_result_summary || jsonb_build_object(
    'draft_line_count', jsonb_array_length(p_input_rows),
    'history_count', jsonb_array_length(p_history),
    'new_divergence_count', v_divergence_count,
    'special_divergence_count', v_special_divergences_written
  );

  -- All changes below share the same PostgreSQL transaction as the stock RPC.
  -- An exception anywhere rolls back stock, history, divergences and draft close.
  INSERT INTO public.lancamento_batch_runs (
    batch_id, generation_id, draft_revision, executed_by, result_summary, created_at
  ) VALUES (
    p_batch_id, p_generation_id, p_expected_revision, auth.uid(), v_summary, clock_timestamp()
  );

  INSERT INTO public.lancamento_draft_archive_lines (
    line_id, generation_id, sequence, row_data, disposition, batch_id,
    created_by, updated_by, archived_by, created_at, updated_at
  )
  SELECT l.line_id, l.generation_id, l.sequence, l.row_data,
         CASE WHEN coalesce(btrim(l.row_data->>'referencia'),'') = '' THEN 'ignored' ELSE 'processed' END,
         p_batch_id, l.created_by, l.updated_by, auth.uid(), l.created_at, l.updated_at
  FROM public.lancamento_draft_lines AS l
  WHERE l.generation_id = p_generation_id;
  GET DIAGNOSTICS v_archived_count = ROW_COUNT;

  DELETE FROM public.lancamento_draft_lines AS l WHERE l.generation_id = p_generation_id;
  v_next_generation := gen_random_uuid();
  UPDATE public.lancamento_draft_control AS c
  SET generation_id = v_next_generation,
      revision = 0,
      next_sequence = 1,
      updated_by = auth.uid(),
      updated_at = clock_timestamp()
  WHERE c.singleton IS TRUE;

  RETURN jsonb_build_object(
    'success', true,
    'already_processed', false,
    'batch_id', p_batch_id,
    'generation_id', p_generation_id,
    'next_generation_id', v_next_generation,
    'result_summary', v_summary,
    'archived_count', v_archived_count,
    'stock_result', v_stock_result
  );
EXCEPTION WHEN OTHERS THEN
  -- PL/pgSQL rolls back all writes made in this function block before entering this handler.
  RETURN jsonb_build_object('success', false, 'conflict', false, 'code', 'SHARED_DRAFT_BATCH_ATOMIC_FAILED',
    'sqlstate', SQLSTATE, 'message', 'O lote não foi confirmado. O rascunho foi preservado; consulte o resultado antes de repetir.');
END;
$function$;

-- ACL das novas RPCs: apenas authenticated, sem PUBLIC/anon.
REVOKE ALL ON FUNCTION public.apply_stock_mutation_atomic(jsonb,jsonb,jsonb,jsonb,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_stock_mutation_atomic(jsonb,jsonb,jsonb,jsonb,jsonb,text) TO authenticated;
REVOKE ALL ON FUNCTION public.apply_stock_mutation_atomic_with_deletes(jsonb,jsonb,jsonb,jsonb,jsonb,text[],text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_stock_mutation_atomic_with_deletes(jsonb,jsonb,jsonb,jsonb,jsonb,text[],text) TO authenticated;

-- As sete funções de rascunho já existem. Preservar o mesmo contrato Auth-only
-- usado pela compatibilidade local; helper de identidade continua privado.
REVOKE ALL ON FUNCTION public.get_shared_lancamento_draft() FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.upsert_shared_lancamento_draft_lines(uuid,jsonb) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.delete_shared_lancamento_draft_line(uuid,text,bigint) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.clear_shared_lancamento_draft(uuid,bigint) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.get_shared_lancamento_batch_result(uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.process_shared_lancamento_draft_batch_atomic(uuid,uuid,bigint,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text[]) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.shared_draft_slot_identity_is_inconsistent(public.slots) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_shared_lancamento_draft() TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_shared_lancamento_draft_lines(uuid,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_shared_lancamento_draft_line(uuid,text,bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.clear_shared_lancamento_draft(uuid,bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_shared_lancamento_batch_result(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_shared_lancamento_draft_batch_atomic(uuid,uuid,bigint,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text[]) TO authenticated;

DO $production_bridge_postflight$
DECLARE
  v_fn record;
  v_old_1 oid := to_regprocedure('public.apply_stock_mutation_atomic(jsonb,jsonb,jsonb,jsonb,jsonb)');
  v_old_2 oid := to_regprocedure('public.apply_stock_mutation_atomic_with_deletes(jsonb,jsonb,jsonb,jsonb,jsonb,text[])');
  v_batch_source text;
BEGIN
  IF to_regprocedure('public.apply_stock_mutation_atomic(jsonb,jsonb,jsonb,jsonb,jsonb,text)') IS NULL
     OR to_regprocedure('public.apply_stock_mutation_atomic_with_deletes(jsonb,jsonb,jsonb,jsonb,jsonb,text[],text)') IS NULL THEN
    RAISE EXCEPTION 'PROD_BRIDGE_TYPED_WRITERS_NOT_CREATED';
  END IF;

  FOR v_fn IN
    SELECT p.oid, p.prosecdef, p.proconfig, p.prosrc, r.rolbypassrls,
           has_function_privilege('authenticated',p.oid,'EXECUTE') AS auth_exec,
           has_function_privilege('anon',p.oid,'EXECUTE') AS anon_exec
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    JOIN pg_roles r ON r.oid=p.proowner
    WHERE n.nspname='public'
      AND p.oid IN (
        to_regprocedure('public.apply_stock_mutation_atomic(jsonb,jsonb,jsonb,jsonb,jsonb,text)'),
        to_regprocedure('public.apply_stock_mutation_atomic_with_deletes(jsonb,jsonb,jsonb,jsonb,jsonb,text[],text)')
      )
  LOOP
    IF v_fn.prosecdef IS DISTINCT FROM TRUE
       OR v_fn.rolbypassrls IS DISTINCT FROM TRUE
       OR NOT (COALESCE(v_fn.proconfig,ARRAY[]::text[]) @> ARRAY['search_path=""']::text[])
       OR v_fn.auth_exec IS DISTINCT FROM TRUE
       OR v_fn.anon_exec IS DISTINCT FROM FALSE
       OR position('has_app_permission' IN lower(v_fn.prosrc))=0 THEN
      RAISE EXCEPTION 'PROD_BRIDGE_TYPED_WRITER_SECURITY_OR_ACL_POSTFLIGHT_FAILED';
    END IF;
  END LOOP;

  -- Compatibilidade temporária obrigatória: o bundle atual ainda chama estas assinaturas.
  IF v_old_1 IS NULL OR v_old_2 IS NULL
     OR NOT has_function_privilege('authenticated',v_old_1,'EXECUTE')
     OR NOT has_function_privilege('authenticated',v_old_2,'EXECUTE')
     OR has_function_privilege('anon',v_old_1,'EXECUTE')
     OR has_function_privilege('anon',v_old_2,'EXECUTE') THEN
    RAISE EXCEPTION 'PROD_BRIDGE_LEGACY_WRITER_COMPATIBILITY_NOT_PRESERVED';
  END IF;

  IF to_regprocedure('public.process_shared_lancamento_draft_batch_atomic(uuid,uuid,bigint,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text[])') IS NULL THEN
    RAISE EXCEPTION 'PROD_BRIDGE_SHARED_BATCH_RPC_MISSING_AFTER_REPLACE';
  END IF;

  SELECT p.prosrc INTO v_batch_source
  FROM pg_proc p
  WHERE p.oid=to_regprocedure('public.process_shared_lancamento_draft_batch_atomic(uuid,uuid,bigint,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text[])');

  IF position('v_normal_delete_slot_ids, ''launch''' IN v_batch_source)=0
     OR position('v_normal_history, ''launch''' IN v_batch_source)=0 THEN
    RAISE EXCEPTION 'PROD_BRIDGE_SHARED_BATCH_NOT_ROUTED_TO_TYPED_LAUNCH_WRITER';
  END IF;

  IF (SELECT count(*) FROM pg_proc p
      WHERE p.oid IN (
        to_regprocedure('public.get_shared_lancamento_draft()'),
        to_regprocedure('public.upsert_shared_lancamento_draft_lines(uuid,jsonb)'),
        to_regprocedure('public.delete_shared_lancamento_draft_line(uuid,text,bigint)'),
        to_regprocedure('public.clear_shared_lancamento_draft(uuid,bigint)'),
        to_regprocedure('public.get_shared_lancamento_batch_result(uuid)'),
        to_regprocedure('public.shared_draft_slot_identity_is_inconsistent(public.slots)'),
        to_regprocedure('public.process_shared_lancamento_draft_batch_atomic(uuid,uuid,bigint,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text[])')
      )) <> 7 THEN
    RAISE EXCEPTION 'PROD_BRIDGE_SHARED_FUNCTION_INVENTORY_CHANGED';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('public.get_shared_lancamento_draft()'::text, TRUE, TRUE),
      ('public.upsert_shared_lancamento_draft_lines(uuid,jsonb)'::text, TRUE, TRUE),
      ('public.delete_shared_lancamento_draft_line(uuid,text,bigint)'::text, TRUE, TRUE),
      ('public.clear_shared_lancamento_draft(uuid,bigint)'::text, TRUE, TRUE),
      ('public.get_shared_lancamento_batch_result(uuid)'::text, TRUE, TRUE),
      ('public.shared_draft_slot_identity_is_inconsistent(public.slots)'::text, FALSE, FALSE),
      ('public.process_shared_lancamento_draft_batch_atomic(uuid,uuid,bigint,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text[])'::text, TRUE, TRUE)
    ) AS expected(signature, security_definer, auth_exec)
    JOIN pg_proc p ON p.oid=to_regprocedure(expected.signature)
    WHERE p.prosecdef IS DISTINCT FROM expected.security_definer
       OR NOT (COALESCE(p.proconfig,ARRAY[]::text[]) @> ARRAY['search_path=""']::text[])
       OR has_function_privilege('authenticated',p.oid,'EXECUTE') IS DISTINCT FROM expected.auth_exec
       OR has_function_privilege('anon',p.oid,'EXECUTE') IS DISTINCT FROM FALSE
       OR has_function_privilege('service_role',p.oid,'EXECUTE') IS DISTINCT FROM FALSE
  ) THEN
    RAISE EXCEPTION 'PROD_BRIDGE_SHARED_FUNCTION_SECURITY_OR_ACL_POSTFLIGHT_FAILED';
  END IF;
END;
$production_bridge_postflight$;

NOTIFY pgrst, 'reload schema';
COMMIT;
