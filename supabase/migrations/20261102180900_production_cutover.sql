-- RASCUNHO DE CORTE FINAL EM PRODUCAO - NAO APLICADO.
-- Consolida em UMA transacao:
--   B8 (guards) + revoke das sobrecargas antigas + B6.2B + B11 + B11.5.
--
-- PRÉ-REQUISITOS obrigatórios:
--   1. Fase A concluída (B1/B2/B5/B6.1/B6.2A, bridge B7.1+shared, B9, B10 e B12). B11.7 é posterior a este corte.
--   2. Novo frontend já publicado em Production com as duas flags de permissões em live.
--   3. Usuários avisados; todas as abas/PWAs antigas encerradas e reabertas na versão nova.
--   4. Janela de manutenção sem movimentações em andamento.
--   5. Snapshot direcionado de definições/ACLs/policies das funções e tabelas afetadas guardado fora do repositório público.
--
-- EFEITO: revoga o caminho antigo de escrita. Se qualquer preflight/postflight
-- falhar, a transação inteira sofre rollback. O app antigo deixa de ser compatível
-- após o commit; NÃO reverter só o Vercel sem restaurar antes grants/policies.
--
-- Não altera slots/history/divergencias como dados. B11.5 altera somente catálogo,
-- matriz de permissões/auditoria e policies SELECT. Products e occupancy_history
-- ficam fora da revogação DML central.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $production_cutover_preflight$
BEGIN
  IF to_regprocedure('public.apply_stock_mutation_atomic(jsonb,jsonb,jsonb,jsonb,jsonb,text)') IS NULL
     OR to_regprocedure('public.apply_stock_mutation_atomic_with_deletes(jsonb,jsonb,jsonb,jsonb,jsonb,text[],text)') IS NULL
     OR to_regprocedure('public.record_stock_conflict_divergences_atomic(text,jsonb)') IS NULL
     OR to_regprocedure('public.has_app_permission(text)') IS NULL
     OR to_regprocedure('public.has_app_permissions(text[])') IS NULL THEN
    RAISE EXCEPTION 'PROD_CUTOVER_PHASE_A_INCOMPLETE';
  END IF;

  IF to_regprocedure('public.apply_stock_mutation_atomic(jsonb,jsonb,jsonb,jsonb,jsonb)') IS NULL
     OR to_regprocedure('public.apply_stock_mutation_atomic_with_deletes(jsonb,jsonb,jsonb,jsonb,jsonb,text[])') IS NULL THEN
    RAISE EXCEPTION 'PROD_CUTOVER_LEGACY_OVERLOADS_NOT_FOUND_FOR_CONTROLLED_REVOKE';
  END IF;

  IF md5((SELECT p.prosrc FROM pg_proc p WHERE p.oid=to_regprocedure('public.apply_stock_mutation_atomic(jsonb,jsonb,jsonb,jsonb,jsonb)')))
       IS DISTINCT FROM '5fa2a17bb2862bdb32a71958ea9c9c09'
     OR md5((SELECT p.prosrc FROM pg_proc p WHERE p.oid=to_regprocedure('public.apply_stock_mutation_atomic_with_deletes(jsonb,jsonb,jsonb,jsonb,jsonb,text[])')))
       IS DISTINCT FROM '2406d91dcf628eb4b0c3be72ee0b95fb' THEN
    RAISE EXCEPTION 'PROD_CUTOVER_LEGACY_WRITER_SOURCE_DRIFT_RECAPTURE_REQUIRED';
  END IF;

  IF NOT has_function_privilege('authenticated','public.apply_stock_mutation_atomic(jsonb,jsonb,jsonb,jsonb,jsonb)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.apply_stock_mutation_atomic_with_deletes(jsonb,jsonb,jsonb,jsonb,jsonb,text[])','EXECUTE') THEN
    RAISE EXCEPTION 'PROD_CUTOVER_LEGACY_WRITERS_ALREADY_REVOKED_OR_ACL_CHANGED';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.role_permissions WHERE role='lideranca' AND permission_key='stock.search')
     OR (SELECT count(*) FROM public.permission_catalog WHERE is_active IS TRUE) <> 29
     OR (SELECT count(*) FROM public.role_permissions) <> 145 THEN
    RAISE EXCEPTION 'PROD_CUTOVER_FIVE_ROLE_MATRIX_NOT_READY';
  END IF;
END;
$production_cutover_preflight$;

-- Retira apenas a EXECUTE das sobrecargas antigas; as novas assinaturas tipadas permanecem.
REVOKE ALL ON FUNCTION public.apply_stock_mutation_atomic(jsonb,jsonb,jsonb,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_stock_mutation_atomic_with_deletes(jsonb,jsonb,jsonb,jsonb,jsonb,text[]) FROM PUBLIC, anon, authenticated;


-- ==================== B8: patch de autorização preservando corpos atuais ====================

-- B8 — PATCH CIRÚRGICO SOBRE AS QUATRO DEFINIÇÕES REAIS DE PRODUÇÃO.
-- Não substitui os corpos por versões locais divergentes. Recupera pg_get_functiondef,
-- troca somente o guard antigo has_app_role por has_app_permission e preserva todo
-- o restante da lógica transacional/identidade/histórico existente.
DO $b8_authorization_patch$
DECLARE
  v_item record;
  v_oid oid;
  v_definition text;
  v_patched_definition text;
  v_source_md5 text;
  v_is_definer boolean;
  v_config text[];
  v_auth_execute boolean;
  v_anon_execute boolean;
  v_match_count integer;
  v_after_source text;
BEGIN
  IF to_regprocedure('public.has_app_permission(text)') IS NULL THEN
    RAISE EXCEPTION 'B8_PERMISSION_HELPER_MISSING';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.permission_catalog WHERE permission_key='stock.physical_correction' AND is_active)
     OR NOT EXISTS (SELECT 1 FROM public.permission_catalog WHERE permission_key='divergences.resolve' AND is_active) THEN
    RAISE EXCEPTION 'B8_REQUIRED_PERMISSION_KEYS_MISSING';
  END IF;

  FOR v_item IN
    SELECT * FROM (VALUES
      (
        'public.reconcile_physical_address_atomic(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)'::text,
        'ab3693867e845c764218501e98688014'::text,
        TRUE,
        $re$IF NOT public\.has_app_role\s*\(\s*ARRAY\s*\[\s*'administrador'\s*,\s*'lideranca'\s*,\s*'apoio'\s*,\s*'producao'\s*\]\s*::text\[\]\s*\)\s*THEN\s*RAISE EXCEPTION 'OPERATION_NOT_ALLOWED'\s*USING ERRCODE\s*=\s*'42501'\s*;\s*END IF\s*;$re$,
        $replacement$
  IF public.has_app_permission('stock.physical_correction') IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'PERMISSION_DENIED:stock.physical_correction' USING ERRCODE = '42501';
  END IF;
  IF jsonb_array_length(p_expected_divergencias) > 0
     AND public.has_app_permission('divergences.resolve') IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'PERMISSION_DENIED:divergences.resolve' USING ERRCODE = '42501';
  END IF;
        $replacement$
      ),
      (
        'public.reconcile_physical_address_atomic_with_deletes(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text[])'::text,
        '48eb860af6afdcd143c6d872b978501f'::text,
        TRUE,
        $re$IF NOT public\.has_app_role\s*\(\s*ARRAY\s*\[\s*'administrador'\s*,\s*'lideranca'\s*,\s*'apoio'\s*,\s*'producao'\s*\]\s*::text\[\]\s*\)\s*THEN\s*RAISE EXCEPTION 'OPERATION_NOT_ALLOWED'\s*USING ERRCODE\s*=\s*'42501'\s*;\s*END IF\s*;$re$,
        $replacement$
  IF public.has_app_permission('stock.physical_correction') IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'PERMISSION_DENIED:stock.physical_correction' USING ERRCODE = '42501';
  END IF;
  IF jsonb_array_length(p_expected_divergencias) > 0
     AND public.has_app_permission('divergences.resolve') IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'PERMISSION_DENIED:divergences.resolve' USING ERRCODE = '42501';
  END IF;
        $replacement$
      ),
      (
        'public.resolve_stock_divergence_atomic(jsonb,jsonb,jsonb,jsonb,jsonb)'::text,
        'e11e0f393329863f5ebdeb026b108e23'::text,
        FALSE,
        $re$IF NOT public\.has_app_role\s*\(\s*ARRAY\s*\[\s*'administrador'\s*,\s*'lideranca'\s*,\s*'apoio'\s*,\s*'producao'\s*\]\s*::text\[\]\s*\)\s*THEN\s*RAISE EXCEPTION 'OPERATION_NOT_ALLOWED'\s*USING ERRCODE\s*=\s*'42501'\s*;\s*END IF\s*;$re$,
        $replacement$
  IF public.has_app_permission('divergences.resolve') IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'PERMISSION_DENIED:divergences.resolve' USING ERRCODE = '42501';
  END IF;
        $replacement$
      ),
      (
        'public.zero_physical_divergence_address_atomic(boolean,uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text[])'::text,
        'b2fc9fc0c3bce334f8133bd50113cf83'::text,
        TRUE,
        $re$IF NOT public\.has_app_role\s*\(\s*ARRAY\s*\[\s*'administrador'\s*,\s*'lideranca'\s*,\s*'apoio'\s*\]\s*::text\[\]\s*\)\s*THEN\s*RAISE EXCEPTION 'OPERATION_NOT_ALLOWED'\s*USING ERRCODE\s*=\s*'42501'\s*;\s*END IF\s*;$re$,
        $replacement$
  IF public.has_app_permission('stock.physical_correction') IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'PERMISSION_DENIED:stock.physical_correction' USING ERRCODE = '42501';
  END IF;
  IF public.has_app_permission('divergences.resolve') IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'PERMISSION_DENIED:divergences.resolve' USING ERRCODE = '42501';
  END IF;
        $replacement$
      )
    ) AS targets(signature, expected_source_md5, expected_security_definer, guard_pattern, replacement_guard)
  LOOP
    v_oid := to_regprocedure(v_item.signature);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'B8_FUNCTION_MISSING: %', v_item.signature;
    END IF;

    SELECT md5(p.prosrc), p.prosecdef, p.proconfig,
           has_function_privilege('authenticated', p.oid, 'EXECUTE'),
           has_function_privilege('anon', p.oid, 'EXECUTE')
      INTO v_source_md5, v_is_definer, v_config, v_auth_execute, v_anon_execute
      FROM pg_proc p WHERE p.oid = v_oid;

    IF v_source_md5 IS DISTINCT FROM v_item.expected_source_md5 THEN
      RAISE EXCEPTION 'B8_SOURCE_DRIFT: %; expected %, found %', v_item.signature, v_item.expected_source_md5, v_source_md5;
    END IF;
    IF v_is_definer IS DISTINCT FROM v_item.expected_security_definer
       OR NOT (COALESCE(v_config, ARRAY[]::text[]) @> ARRAY['search_path=""']::text[])
       OR v_auth_execute IS DISTINCT FROM TRUE
       OR v_anon_execute IS DISTINCT FROM FALSE THEN
      RAISE EXCEPTION 'B8_SECURITY_OR_ACL_DRIFT: %', v_item.signature;
    END IF;

    v_definition := pg_get_functiondef(v_oid);
    SELECT count(*)::integer INTO v_match_count
      FROM regexp_matches(v_definition, v_item.guard_pattern, 'g');
    IF v_match_count <> 1 THEN
      RAISE EXCEPTION 'B8_EXPECTED_EXACTLY_ONE_LEGACY_GUARD: %; found %', v_item.signature, v_match_count;
    END IF;

    v_patched_definition := regexp_replace(v_definition, v_item.guard_pattern, v_item.replacement_guard, 'g');
    EXECUTE v_patched_definition;

    SELECT p.prosrc INTO v_after_source FROM pg_proc p WHERE p.oid = v_oid;
    IF position('has_app_permission' IN v_after_source) = 0
       OR position('has_app_role' IN v_after_source) > 0 THEN
      RAISE EXCEPTION 'B8_PERMISSION_GUARD_POSTFLIGHT_FAILED: %', v_item.signature;
    END IF;
  END LOOP;

  -- resolve_stock_divergence_atomic era SECURITY INVOKER. Com o DML direto
  -- bloqueado no corte, passa a SECURITY DEFINER mantendo search_path vazio.
  ALTER FUNCTION public.resolve_stock_divergence_atomic(jsonb,jsonb,jsonb,jsonb,jsonb) SECURITY DEFINER;
  ALTER FUNCTION public.resolve_stock_divergence_atomic(jsonb,jsonb,jsonb,jsonb,jsonb) SET search_path TO '';
END;
$b8_authorization_patch$;

DO $b8_postflight$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*)::integer INTO v_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'reconcile_physical_address_atomic',
      'reconcile_physical_address_atomic_with_deletes',
      'resolve_stock_divergence_atomic',
      'zero_physical_divergence_address_atomic'
    )
    AND p.prosecdef IS TRUE
    AND COALESCE(p.proconfig, ARRAY[]::text[]) @> ARRAY['search_path=""']::text[]
    AND position('has_app_permission' IN p.prosrc) > 0
    AND position('has_app_role' IN p.prosrc) = 0
    AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('anon', p.oid, 'EXECUTE');

  IF v_count <> 4 THEN
    RAISE EXCEPTION 'B8_POSTFLIGHT_EXPECTED_FOUR_GRANULAR_SECURITY_DEFINER_FUNCTIONS; found %', v_count;
  END IF;
END;
$b8_postflight$;

-- ==================== B6.2B: policies configuráveis e DML layout/stock ====================

-- Auditoria 03 / B6.2B: alinhar RLS e ACL ao catálogo configurável.
-- Fonte B6.2B adaptada para a transação de corte em produção.
-- Não altera dados operacionais.
-- Escritas de estoque/estrutura passam pelas RPCs atômicas.
-- Escritores diretos de products são preservados sob RLS granular.


DO $preflight$
DECLARE
  v_missing_keys text;
  v_missing_tables text;
  v_select_policy_count integer;
  v_product_write_policy_count integer;
  v_function_oid oid;
BEGIN
  IF pg_catalog.to_regprocedure('public.has_app_permission(text)') IS NULL
     OR pg_catalog.to_regprocedure('public.update_slot_metadata_atomic(jsonb,jsonb)') IS NULL
     OR pg_catalog.to_regprocedure('public.save_warehouse_layout_atomic(jsonb,jsonb)') IS NULL
     OR pg_catalog.to_regprocedure('public.save_warehouse_positions_atomic(jsonb,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'B62B_PREFLIGHT_REQUIRED_FUNCTION_MISSING';
  END IF;

  SELECT pg_catalog.string_agg(x.permission_key, ', ' ORDER BY x.permission_key)
    INTO v_missing_keys
  FROM unnest(ARRAY[
    'dashboard.view','stock.search','stock.details.view','stock.launch.view',
    'stock.launch.create','stock.transfer.create','stock.batch.process',
    'stock.physical_correction','history.view','divergences.view',
    'divergences.resolve','products.view','products.create','products.edit',
    'products.import_bulk','products.delete_deactivate','map.view',
    'map.metadata.edit','warehouse.layout.view','warehouse.layout.manage',
    'consultor.use'
  ]::text[]) AS x(permission_key)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.permission_catalog pc
    WHERE pc.permission_key = x.permission_key AND pc.is_active IS TRUE
  );

  IF v_missing_keys IS NOT NULL THEN
    RAISE EXCEPTION 'B62B_PREFLIGHT_PERMISSION_KEYS_MISSING: %', v_missing_keys;
  END IF;

  SELECT pg_catalog.string_agg(x.table_name, ', ' ORDER BY x.table_name)
    INTO v_missing_tables
  FROM unnest(ARRAY[
    'slots','history','divergencias','products',
    'warehouse_layout','warehouse_layout_positions'
  ]::text[]) AS x(table_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = x.table_name
      AND c.relkind IN ('r','p') AND c.relrowsecurity IS TRUE
  );

  IF v_missing_tables IS NOT NULL THEN
    RAISE EXCEPTION 'B62B_PREFLIGHT_TABLES_OR_RLS_MISSING: %', v_missing_tables;
  END IF;

  SELECT count(*) INTO v_select_policy_count
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('slots','history','divergencias','products','warehouse_layout','warehouse_layout_positions')
    AND cmd = 'SELECT';

  IF v_select_policy_count <> 6 THEN
    RAISE EXCEPTION 'B62B_PREFLIGHT_UNEXPECTED_SELECT_POLICY_INVENTORY: %', v_select_policy_count;
  END IF;

  SELECT count(*) INTO v_product_write_policy_count
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'public' AND tablename = 'products'
    AND policyname IN ('products_insert_permission','products_update_permission','products_delete_permission');

  IF v_product_write_policy_count <> 3 THEN
    RAISE EXCEPTION 'B62B_PREFLIGHT_PRODUCT_PERMISSION_POLICIES_MISSING: %', v_product_write_policy_count;
  END IF;

  SELECT p.oid INTO v_function_oid
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'update_slot_metadata_atomic'
    AND pg_catalog.pg_get_function_identity_arguments(p.oid) =
        'p_expected_slot jsonb, p_metadata jsonb';

  IF v_function_oid IS NULL
     OR (SELECT p.prosecdef FROM pg_catalog.pg_proc p WHERE p.oid=v_function_oid) IS DISTINCT FROM TRUE
     OR NOT (COALESCE(
       (SELECT p.proconfig FROM pg_catalog.pg_proc p WHERE p.oid=v_function_oid),
       ARRAY[]::text[]
     ) @> ARRAY['search_path=""']::text[]) THEN
    RAISE EXCEPTION 'B62B_PREFLIGHT_METADATA_RPC_SECURITY_CONFIG_INVALID';
  END IF;
END;
$preflight$;

-- Bloqueia clientes anônimos; mantém SELECT autenticado.
REVOKE ALL ON TABLE
  public.slots, public.history, public.divergencias, public.products,
  public.warehouse_layout, public.warehouse_layout_positions
FROM PUBLIC, anon;

-- Estoque e estrutura física não aceitam mais DML direto do cliente.
REVOKE INSERT, UPDATE, DELETE ON TABLE
  public.slots, public.history, public.divergencias,
  public.warehouse_layout, public.warehouse_layout_positions
FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS slots_insert_operations ON public.slots;
DROP POLICY IF EXISTS slots_update_operations ON public.slots;
DROP POLICY IF EXISTS history_insert_operations ON public.history;
DROP POLICY IF EXISTS divergencias_insert_operations ON public.divergencias;
DROP POLICY IF EXISTS divergencias_update_operations ON public.divergencias;
DROP POLICY IF EXISTS warehouse_layout_insert_admin ON public.warehouse_layout;
DROP POLICY IF EXISTS warehouse_layout_update_admin ON public.warehouse_layout;
DROP POLICY IF EXISTS warehouse_layout_positions_insert_admin ON public.warehouse_layout_positions;
DROP POLICY IF EXISTS warehouse_layout_positions_update_admin ON public.warehouse_layout_positions;

-- slots atende Dashboard, Pesquisa, Mapa, Lançamentos, Correção Física
-- e resolução de divergências. RLS é por linha, não por coluna: qualquer
-- chave abaixo concede SELECT da linha completa; granularidade por coluna
-- exigiria views/RPCs de leitura específicas.
DROP POLICY IF EXISTS slots_select_authenticated ON public.slots;
DROP POLICY IF EXISTS slots_select_permission_catalog ON public.slots;
CREATE POLICY slots_select_permission_catalog ON public.slots
FOR SELECT TO authenticated
USING (
  (SELECT public.has_app_permission('dashboard.view'))
  OR (SELECT public.has_app_permission('stock.search'))
  OR (SELECT public.has_app_permission('stock.details.view'))
  OR (SELECT public.has_app_permission('stock.launch.view'))
  OR (SELECT public.has_app_permission('stock.launch.create'))
  OR (SELECT public.has_app_permission('stock.transfer.create'))
  OR (SELECT public.has_app_permission('stock.batch.process'))
  OR (SELECT public.has_app_permission('stock.physical_correction'))
  OR (SELECT public.has_app_permission('divergences.resolve'))
  OR (SELECT public.has_app_permission('map.view'))
  OR (SELECT public.has_app_permission('map.metadata.edit'))
  OR (SELECT public.has_app_permission('consultor.use'))
);

DROP POLICY IF EXISTS history_select_authenticated ON public.history;
DROP POLICY IF EXISTS history_select_permission_catalog ON public.history;
CREATE POLICY history_select_permission_catalog ON public.history
FOR SELECT TO authenticated
USING ((SELECT public.has_app_permission('history.view')));

DROP POLICY IF EXISTS divergencias_select_authenticated ON public.divergencias;
DROP POLICY IF EXISTS divergencias_select_permission_catalog ON public.divergencias;
CREATE POLICY divergencias_select_permission_catalog ON public.divergencias
FOR SELECT TO authenticated
USING (
  (SELECT public.has_app_permission('divergences.view'))
  OR (SELECT public.has_app_permission('divergences.resolve'))
);

-- products permanece com DML direto: os escritores da aplicação usam
-- INSERT/UPDATE/DELETE e são protegidos pelas três políticas abaixo.
-- A leitura inclui a permissão de produto e os fluxos que usam o catálogo.
DROP POLICY IF EXISTS products_select_authenticated ON public.products;
DROP POLICY IF EXISTS products_select_permission_catalog ON public.products;
CREATE POLICY products_select_permission_catalog ON public.products
FOR SELECT TO authenticated
USING (
  (SELECT public.has_app_permission('products.view'))
  OR (SELECT public.has_app_permission('products.create'))
  OR (SELECT public.has_app_permission('products.edit'))
  OR (SELECT public.has_app_permission('products.import_bulk'))
  OR (SELECT public.has_app_permission('products.delete_deactivate'))
  OR (SELECT public.has_app_permission('stock.search'))
  OR (SELECT public.has_app_permission('stock.details.view'))
  OR (SELECT public.has_app_permission('stock.launch.view'))
  OR (SELECT public.has_app_permission('stock.launch.create'))
  OR (SELECT public.has_app_permission('stock.transfer.create'))
  OR (SELECT public.has_app_permission('stock.batch.process'))
  OR (SELECT public.has_app_permission('consultor.use'))
);

DROP POLICY IF EXISTS warehouse_layout_select_authenticated ON public.warehouse_layout;
DROP POLICY IF EXISTS warehouse_layout_select_permission_catalog ON public.warehouse_layout;
CREATE POLICY warehouse_layout_select_permission_catalog ON public.warehouse_layout
FOR SELECT TO authenticated
USING (
  (SELECT public.has_app_permission('warehouse.layout.view'))
  OR (SELECT public.has_app_permission('warehouse.layout.manage'))
  OR (SELECT public.has_app_permission('map.view'))
  OR (SELECT public.has_app_permission('dashboard.view'))
  OR (SELECT public.has_app_permission('stock.physical_correction'))
);

DROP POLICY IF EXISTS warehouse_layout_positions_select_authenticated ON public.warehouse_layout_positions;
DROP POLICY IF EXISTS warehouse_layout_positions_select_permission_catalog ON public.warehouse_layout_positions;
CREATE POLICY warehouse_layout_positions_select_permission_catalog ON public.warehouse_layout_positions
FOR SELECT TO authenticated
USING (
  (SELECT public.has_app_permission('warehouse.layout.view'))
  OR (SELECT public.has_app_permission('warehouse.layout.manage'))
  OR (SELECT public.has_app_permission('map.view'))
  OR (SELECT public.has_app_permission('dashboard.view'))
  OR (SELECT public.has_app_permission('stock.physical_correction'))
);

-- B6.2A revogou PUBLIC, mas a ACL observada tinha concessão explícita a anon.
REVOKE ALL ON FUNCTION public.update_slot_metadata_atomic(jsonb,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_slot_metadata_atomic(jsonb,jsonb) TO authenticated;

DO $postflight$
DECLARE
  v_select_policy_count integer;
  v_product_write_policy_count integer;
  v_function_oid oid;
BEGIN
  SELECT count(*) INTO v_select_policy_count
  FROM pg_catalog.pg_policies
  WHERE schemaname='public'
    AND tablename IN ('slots','history','divergencias','products','warehouse_layout','warehouse_layout_positions')
    AND cmd='SELECT'
    AND policyname IN (
      'slots_select_permission_catalog','history_select_permission_catalog',
      'divergencias_select_permission_catalog','products_select_permission_catalog',
      'warehouse_layout_select_permission_catalog',
      'warehouse_layout_positions_select_permission_catalog'
    )
    AND COALESCE(qual,'') ILIKE '%has_app_permission%';

  IF v_select_policy_count <> 6 THEN
    RAISE EXCEPTION 'B62B_POSTFLIGHT_PERMISSION_SELECT_POLICIES_INVALID: %', v_select_policy_count;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname='public'
      AND tablename IN ('slots','history','divergencias','products','warehouse_layout','warehouse_layout_positions')
      AND cmd='SELECT' AND COALESCE(qual,'') ILIKE '%has_app_role%'
  ) THEN
    RAISE EXCEPTION 'B62B_POSTFLIGHT_ROLE_BASED_SELECT_POLICY_REMAINS';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname='public'
      AND tablename IN ('slots','history','divergencias','warehouse_layout','warehouse_layout_positions')
      AND cmd IN ('INSERT','UPDATE','DELETE','ALL')
  ) THEN
    RAISE EXCEPTION 'B62B_POSTFLIGHT_DIRECT_WRITE_POLICY_REMAINS';
  END IF;

  IF pg_catalog.has_table_privilege('authenticated','public.slots','INSERT')
     OR pg_catalog.has_table_privilege('authenticated','public.slots','UPDATE')
     OR pg_catalog.has_table_privilege('authenticated','public.slots','DELETE')
     OR pg_catalog.has_table_privilege('authenticated','public.history','INSERT')
     OR pg_catalog.has_table_privilege('authenticated','public.history','UPDATE')
     OR pg_catalog.has_table_privilege('authenticated','public.history','DELETE')
     OR pg_catalog.has_table_privilege('authenticated','public.divergencias','INSERT')
     OR pg_catalog.has_table_privilege('authenticated','public.divergencias','UPDATE')
     OR pg_catalog.has_table_privilege('authenticated','public.divergencias','DELETE')
     OR pg_catalog.has_table_privilege('authenticated','public.warehouse_layout','INSERT')
     OR pg_catalog.has_table_privilege('authenticated','public.warehouse_layout','UPDATE')
     OR pg_catalog.has_table_privilege('authenticated','public.warehouse_layout','DELETE')
     OR pg_catalog.has_table_privilege('authenticated','public.warehouse_layout_positions','INSERT')
     OR pg_catalog.has_table_privilege('authenticated','public.warehouse_layout_positions','UPDATE')
     OR pg_catalog.has_table_privilege('authenticated','public.warehouse_layout_positions','DELETE') THEN
    RAISE EXCEPTION 'B62B_POSTFLIGHT_AUTHENTICATED_DIRECT_DML_REMAINS';
  END IF;

  -- products é a exceção intencional, com DML protegido por has_app_permission.
  IF NOT pg_catalog.has_table_privilege('authenticated','public.products','SELECT')
     OR NOT pg_catalog.has_table_privilege('authenticated','public.products','INSERT')
     OR NOT pg_catalog.has_table_privilege('authenticated','public.products','UPDATE')
     OR NOT pg_catalog.has_table_privilege('authenticated','public.products','DELETE') THEN
    RAISE EXCEPTION 'B62B_POSTFLIGHT_PRODUCTS_DIRECT_WRITERS_CHANGED';
  END IF;

  SELECT count(*) INTO v_product_write_policy_count
  FROM pg_catalog.pg_policies
  WHERE schemaname='public' AND tablename='products'
    AND policyname IN ('products_insert_permission','products_update_permission','products_delete_permission')
    AND (COALESCE(qual,'') || ' ' || COALESCE(with_check,'')) ILIKE '%has_app_permission%';

  IF v_product_write_policy_count <> 3 THEN
    RAISE EXCEPTION 'B62B_POSTFLIGHT_PRODUCTS_PERMISSION_POLICIES_INVALID: %',
      v_product_write_policy_count;
  END IF;

  SELECT p.oid INTO v_function_oid
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='update_slot_metadata_atomic'
    AND pg_catalog.pg_get_function_identity_arguments(p.oid)='p_expected_slot jsonb, p_metadata jsonb';

  IF v_function_oid IS NULL
     OR pg_catalog.has_function_privilege('anon',v_function_oid,'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('authenticated',v_function_oid,'EXECUTE')
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.aclexplode(
         COALESCE(
           (SELECT p.proacl FROM pg_catalog.pg_proc p WHERE p.oid=v_function_oid),
           pg_catalog.acldefault('f',(SELECT p.proowner FROM pg_catalog.pg_proc p WHERE p.oid=v_function_oid))
         )
       ) acl
       WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE'
     ) THEN
    RAISE EXCEPTION 'B62B_POSTFLIGHT_METADATA_RPC_ACL_INVALID';
  END IF;
END;
$postflight$;

-- ==================== B11: revogação DML central e verificação de 8 RPCs ====================

-- Frente 01 - Segurança e Integridade
-- Revoga DML direto do papel authenticated nas tabelas centrais de estoque.
-- Mantém SELECT, service_role, postgres, RPCs SECURITY DEFINER e políticas RLS.
-- Fonte B11 adaptada para a transação de corte em produção.


-- Pré-condições: esquema e privilégios precisam corresponder à auditoria.
DO $migration_precheck$
DECLARE
  v_table text;
  v_rpc_count integer;
BEGIN
  IF to_regclass('public.slots') IS NULL
     OR to_regclass('public.history') IS NULL
     OR to_regclass('public.divergencias') IS NULL THEN
    RAISE EXCEPTION 'STOCK_DML_REVOKE_ABORT: tabela central ausente';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    RAISE EXCEPTION 'STOCK_DML_REVOKE_ABORT: role esperada ausente';
  END IF;

  -- Não prosseguir se PUBLIC tiver DML direto em qualquer tabela-alvo.
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(
      COALESCE(c.relacl, acldefault('r', c.relowner))
    ) a
    WHERE n.nspname = 'public'
      AND c.relname IN ('slots', 'history', 'divergencias')
      AND a.grantee = 0
      AND a.privilege_type IN ('INSERT', 'UPDATE', 'DELETE')
  ) THEN
    RAISE EXCEPTION 'STOCK_DML_REVOKE_ABORT: PUBLIC possui DML direto';
  END IF;

  FOREACH v_table IN ARRAY ARRAY['slots', 'history', 'divergencias'] LOOP
    IF NOT has_table_privilege('authenticated', format('public.%I', v_table), 'SELECT') THEN
      RAISE EXCEPTION 'STOCK_DML_REVOKE_ABORT: authenticated não possui SELECT em %', v_table;
    END IF;

    IF NOT has_table_privilege('service_role', format('public.%I', v_table), 'INSERT,UPDATE,DELETE') THEN
      RAISE EXCEPTION 'STOCK_DML_REVOKE_ABORT: service_role não possui DML completo em %', v_table;
    END IF;

    IF NOT has_table_privilege('postgres', format('public.%I', v_table), 'INSERT,UPDATE,DELETE') THEN
      RAISE EXCEPTION 'STOCK_DML_REVOKE_ABORT: postgres não possui DML completo em %', v_table;
    END IF;
  END LOOP;

  -- Confirmar exatamente as oito RPCs operacionais protegidas já auditadas.
  SELECT count(*)
    INTO v_rpc_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'apply_stock_mutation_atomic',
      'apply_stock_mutation_atomic_with_deletes',
      'process_shared_lancamento_draft_batch_atomic',
      'reconcile_physical_address_atomic',
      'reconcile_physical_address_atomic_with_deletes',
      'record_stock_conflict_divergences_atomic',
      'resolve_stock_divergence_atomic',
      'zero_physical_divergence_address_atomic'
    )
    AND has_function_privilege('authenticated', p.oid, 'EXECUTE');

  IF v_rpc_count <> 8 THEN
    RAISE EXCEPTION 'STOCK_DML_REVOKE_ABORT: esperado 8 RPCs operacionais executáveis; encontrado %', v_rpc_count;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_roles r ON r.oid = p.proowner
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'apply_stock_mutation_atomic',
        'apply_stock_mutation_atomic_with_deletes',
        'process_shared_lancamento_draft_batch_atomic',
        'reconcile_physical_address_atomic',
        'reconcile_physical_address_atomic_with_deletes',
        'record_stock_conflict_divergences_atomic',
        'resolve_stock_divergence_atomic',
        'zero_physical_divergence_address_atomic'
      )
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND (
        NOT p.prosecdef
        OR NOT r.rolbypassrls
        OR NOT (p.proconfig @> ARRAY['search_path=""'])
        OR position('has_app_permission' IN lower(p.prosrc)) = 0
      )
  ) THEN
    RAISE EXCEPTION 'STOCK_DML_REVOKE_ABORT: RPC executável sem proteção SECURITY DEFINER/search_path/permissão esperada';
  END IF;

  -- As sobrecargas legadas sem p_operation_type devem continuar inacessíveis.
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('apply_stock_mutation_atomic', 'apply_stock_mutation_atomic_with_deletes')
      AND position('p_operation_type' IN pg_get_function_identity_arguments(p.oid)) = 0
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'STOCK_DML_REVOKE_ABORT: sobrecarga legada ainda executável por authenticated';
  END IF;
END;
$migration_precheck$;

-- Revoga somente escrita direta de authenticated nas tabelas centrais.
REVOKE INSERT, UPDATE, DELETE
ON TABLE public.slots, public.history, public.divergencias
FROM authenticated;

-- Pós-condições: qualquer divergência aborta e reverte toda a transação.
DO $migration_postcheck$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['slots', 'history', 'divergencias'] LOOP
    IF has_table_privilege('authenticated', format('public.%I', v_table), 'INSERT,UPDATE,DELETE') THEN
      RAISE EXCEPTION 'STOCK_DML_REVOKE_ABORT: DML direto ainda efetivo para authenticated em %', v_table;
    END IF;

    IF NOT has_table_privilege('authenticated', format('public.%I', v_table), 'SELECT') THEN
      RAISE EXCEPTION 'STOCK_DML_REVOKE_ABORT: SELECT de authenticated foi perdido em %', v_table;
    END IF;

    IF NOT has_table_privilege('service_role', format('public.%I', v_table), 'INSERT,UPDATE,DELETE') THEN
      RAISE EXCEPTION 'STOCK_DML_REVOKE_ABORT: DML de service_role foi alterado em %', v_table;
    END IF;

    IF NOT has_table_privilege('postgres', format('public.%I', v_table), 'INSERT,UPDATE,DELETE') THEN
      RAISE EXCEPTION 'STOCK_DML_REVOKE_ABORT: DML de postgres foi alterado em %', v_table;
    END IF;
  END LOOP;
END;
$migration_postcheck$;

-- ==================== B11.5: alinhamento final de leitura ====================

-- Auditoria 03 / alinhamento final de leitura, pesquisa e divergências.
-- Fonte B11.5 adaptada para o corte de produção após B9 e B6.2B.
-- Não altera registros operacionais, grants de tabela, publicação Realtime ou RPCs transacionais.
-- Atualiza apenas os helpers centrais de autorização para aplicar dependências de leitura.
-- Mantém SELECT completo (14 colunas) em slots, autorizado exclusivamente por stock.search.


DO $preflight$
DECLARE
  v_catalog_count integer;
  v_role_row_count integer;
  v_role_count integer;
  v_slots_select_policy_count integer;
  v_divergencias_select_policy_count integer;
  v_function_oid oid;
  v_context_function_oid oid;
BEGIN
  IF pg_catalog.to_regclass('public.permission_catalog') IS NULL
     OR pg_catalog.to_regclass('public.role_permissions') IS NULL
     OR pg_catalog.to_regclass('public.permission_change_audit') IS NULL
     OR pg_catalog.to_regclass('public.slots') IS NULL
     OR pg_catalog.to_regclass('public.divergencias') IS NULL
     OR pg_catalog.to_regclass('public.products') IS NULL
     OR pg_catalog.to_regprocedure('public.has_app_permission(text)') IS NULL THEN
    RAISE EXCEPTION 'A03_READ_SCOPE_PREFLIGHT_REQUIRED_OBJECT_MISSING';
  END IF;

  SELECT pg_catalog.count(*) INTO v_catalog_count
    FROM public.permission_catalog WHERE is_active IS TRUE;
  SELECT pg_catalog.count(*) INTO v_role_row_count
    FROM public.role_permissions rp
    JOIN public.permission_catalog pc ON pc.permission_key = rp.permission_key AND pc.is_active IS TRUE;
  SELECT pg_catalog.count(DISTINCT role) INTO v_role_count
    FROM public.role_permissions;

  IF v_catalog_count <> 29 OR v_role_row_count <> 145 OR v_role_count <> 5 THEN
    RAISE EXCEPTION 'A03_READ_SCOPE_PREFLIGHT_MATRIX_INVALID: catalog %, rows %, roles %',
      v_catalog_count, v_role_row_count, v_role_count;
  END IF;

  IF NOT EXISTS (
       SELECT 1 FROM public.permission_catalog
        WHERE permission_key = 'stock.search' AND is_active IS TRUE
     ) OR NOT EXISTS (
       SELECT 1 FROM public.permission_catalog
        WHERE permission_key = 'stock.details.view' AND is_active IS TRUE
     ) OR NOT EXISTS (
       SELECT 1 FROM public.permission_catalog
        WHERE permission_key = 'divergences.view' AND is_active IS TRUE
     ) THEN
    RAISE EXCEPTION 'A03_READ_SCOPE_PREFLIGHT_REQUIRED_PERMISSION_KEY_MISSING';
  END IF;

  IF NOT pg_catalog.has_table_privilege('authenticated', 'public.slots', 'SELECT') THEN
    RAISE EXCEPTION 'A03_READ_SCOPE_PREFLIGHT_AUTHENTICATED_SLOTS_SELECT_MISSING';
  END IF;

  SELECT pg_catalog.count(*) INTO v_slots_select_policy_count
    FROM pg_catalog.pg_policies
   WHERE schemaname = 'public' AND tablename = 'slots' AND cmd = 'SELECT';
  SELECT pg_catalog.count(*) INTO v_divergencias_select_policy_count
    FROM pg_catalog.pg_policies
   WHERE schemaname = 'public' AND tablename = 'divergencias' AND cmd = 'SELECT';

  IF v_slots_select_policy_count <> 1 OR v_divergencias_select_policy_count <> 1 THEN
    RAISE EXCEPTION 'A03_READ_SCOPE_PREFLIGHT_SELECT_POLICY_INVENTORY_INVALID: slots %, divergencias %',
      v_slots_select_policy_count, v_divergencias_select_policy_count;
  END IF;

  SELECT p.oid INTO v_function_oid
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'has_app_permission'
     AND pg_catalog.pg_get_function_identity_arguments(p.oid) = 'p_permission_key text';
  SELECT p.oid INTO v_context_function_oid
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'get_my_app_context'
     AND pg_catalog.pg_get_function_identity_arguments(p.oid) = '';

  IF v_function_oid IS NULL
     OR v_context_function_oid IS NULL
     OR (SELECT p.prosecdef FROM pg_catalog.pg_proc p WHERE p.oid = v_function_oid) IS DISTINCT FROM TRUE
     OR (SELECT p.prosecdef FROM pg_catalog.pg_proc p WHERE p.oid = v_context_function_oid) IS DISTINCT FROM TRUE
     OR NOT (COALESCE(
       (SELECT p.proconfig FROM pg_catalog.pg_proc p WHERE p.oid = v_function_oid),
       ARRAY[]::text[]
     ) @> ARRAY['search_path=""']::text[])
     OR NOT (COALESCE(
       (SELECT p.proconfig FROM pg_catalog.pg_proc p WHERE p.oid = v_context_function_oid),
       ARRAY[]::text[]
     ) @> ARRAY['search_path=""']::text[]) THEN
    RAISE EXCEPTION 'A03_READ_SCOPE_PREFLIGHT_PERMISSION_HELPER_SECURITY_INVALID';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.role_permissions
     WHERE role = 'lideranca' AND permission_key = 'stock.search'
  ) THEN
    RAISE EXCEPTION 'A03_READ_SCOPE_PREFLIGHT_LEADERSHIP_SEARCH_ROW_MISSING';
  END IF;
END;
$preflight$;

-- Ajusta a descrição pública do catálogo. A chave legacy permanece ativa
-- para manter a matriz completa de 29 chaves e compatibilidade de versões.
UPDATE public.permission_catalog
   SET description = 'Consultar a base operacional completa de estoque (14 campos) e utilizar os filtros da Pesquisa.',
       updated_at = pg_catalog.transaction_timestamp()
 WHERE permission_key = 'stock.search'
   AND description IS DISTINCT FROM 'Consultar a base operacional completa de estoque (14 campos) e utilizar os filtros da Pesquisa.';

UPDATE public.permission_catalog
   SET description = 'Chave legada descontinuada; não controla campos exibidos nem a leitura da Pesquisa.',
       updated_at = pg_catalog.transaction_timestamp()
 WHERE permission_key = 'stock.details.view'
   AND description IS DISTINCT FROM 'Chave legada descontinuada; não controla campos exibidos nem a leitura da Pesquisa.';

-- Todos os cinco perfis passam a ter Pesquisa como leitura-base da operação.
-- Liderança recebe somente esta permissão nova; as outras 28 regras permanecem intactas.
DO $leadership_search$
DECLARE
  v_changed integer;
BEGIN
  UPDATE public.role_permissions
     SET allowed = TRUE,
         updated_at = pg_catalog.transaction_timestamp(),
         updated_by = NULL
   WHERE role = 'lideranca'
     AND permission_key = 'stock.search'
     AND allowed IS DISTINCT FROM TRUE;
  GET DIAGNOSTICS v_changed = ROW_COUNT;

  IF v_changed > 0 THEN
    INSERT INTO public.permission_change_audit
      (actor_id, actor_username, actor_role, target_type, target_role, target_snapshot, changes)
    VALUES
      (NULL,
       'migration:20261102180900_production_cutover',
       'system',
       'role',
       'lideranca',
       NULL,
       pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
         'permission_key', 'stock.search',
         'from', FALSE,
         'to', TRUE
       )));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.role_permissions
     WHERE role = 'lideranca' AND permission_key = 'stock.search' AND allowed IS TRUE
  ) THEN
    RAISE EXCEPTION 'A03_READ_SCOPE_LEADERSHIP_SEARCH_NOT_ENABLED';
  END IF;
END;
$leadership_search$;

-- O helper central também aplica dependências de leitura para operações diretas.
-- Assim, chamadas SECURITY DEFINER não contornam o escopo de leitura do App.
CREATE OR REPLACE FUNCTION public.has_app_permission(p_permission_key text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_role text;
  v_admin_only boolean;
  v_override_allowed boolean;
  v_base_allowed boolean;
  v_catalog_count integer;
  v_role_row_count integer;
  v_override_decision text;
  v_effective_allowed boolean;
  v_dependency_keys text[] := ARRAY[]::text[];
  v_dependency_key text;
  v_dependency_override_allowed boolean;
  v_dependency_base_allowed boolean;
  v_dependency_override_decision text;
  v_dependency_effective_allowed boolean;
BEGIN
  IF v_user_id IS NULL OR NULLIF(pg_catalog.btrim(p_permission_key), '') IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT pc.is_admin_only, pc.user_override_allowed
    INTO v_admin_only, v_override_allowed
    FROM public.permission_catalog pc
   WHERE pc.permission_key = p_permission_key
     AND pc.is_active;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  SELECT pg_catalog.lower(pg_catalog.btrim(p.role))
    INTO v_role
    FROM public.profiles p
   WHERE p.id = v_user_id;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- Administrator remains the emergency full-access profile for active keys.
  IF v_role = 'administrador' THEN
    RETURN TRUE;
  END IF;

  IF v_role IS NULL OR v_role NOT IN ('apoio', 'producao', 'visualizador', 'lideranca') THEN
    RETURN FALSE;
  END IF;

  IF v_admin_only THEN
    RETURN FALSE;
  END IF;

  SELECT
    (SELECT pg_catalog.count(*) FROM public.permission_catalog pc2 WHERE pc2.is_active),
    (SELECT pg_catalog.count(*)
       FROM public.role_permissions rp2
       JOIN public.permission_catalog pc2 ON pc2.permission_key = rp2.permission_key AND pc2.is_active
      WHERE rp2.role = v_role),
    rp.allowed
    INTO v_catalog_count, v_role_row_count, v_base_allowed
    FROM public.permission_catalog pc
    LEFT JOIN public.role_permissions rp
      ON rp.role = v_role AND rp.permission_key = pc.permission_key
   WHERE pc.permission_key = p_permission_key AND pc.is_active;
  IF NOT FOUND OR v_role_row_count <> v_catalog_count THEN
    RETURN FALSE;
  END IF;

  SELECT upo.decision
    INTO v_override_decision
    FROM public.user_permission_overrides upo
   WHERE upo.user_id = v_user_id
     AND upo.permission_key = p_permission_key;

  IF FOUND THEN
    IF NOT v_override_allowed THEN
      RETURN FALSE;
    END IF;
    IF v_override_decision = 'allow' THEN
      v_effective_allowed := TRUE;
    ELSIF v_override_decision = 'deny' THEN
      v_effective_allowed := FALSE;
    ELSE
      RETURN FALSE;
    END IF;
  ELSE
    v_effective_allowed := COALESCE(v_base_allowed, FALSE);
  END IF;

  IF NOT v_effective_allowed THEN
    RETURN FALSE;
  END IF;

  -- Screens and actions that read the live stock snapshot require stock.search.
  -- Stock mutations/resolution also consume the client-side divergence snapshot.
  IF p_permission_key IN (
    'dashboard.view', 'stock.launch.view', 'divergences.view',
    'map.view', 'map.metadata.edit', 'consultor.use',
    'products.view', 'products.create', 'products.edit', 'warehouse.layout.view'
  ) THEN
    v_dependency_keys := ARRAY['stock.search'];
  ELSIF p_permission_key IN (
    'stock.launch.create', 'stock.transfer.create',
    'stock.batch.process', 'stock.physical_correction', 'divergences.resolve'
  ) THEN
    v_dependency_keys := ARRAY['stock.search', 'divergences.view'];
  END IF;

  FOREACH v_dependency_key IN ARRAY v_dependency_keys LOOP
    SELECT pc.user_override_allowed, rp.allowed, upo.decision
      INTO v_dependency_override_allowed,
           v_dependency_base_allowed,
           v_dependency_override_decision
      FROM public.permission_catalog pc
      LEFT JOIN public.role_permissions rp
        ON rp.role = v_role AND rp.permission_key = pc.permission_key
      LEFT JOIN public.user_permission_overrides upo
        ON upo.user_id = v_user_id AND upo.permission_key = pc.permission_key
     WHERE pc.permission_key = v_dependency_key
       AND pc.is_active;

    IF NOT FOUND OR v_role_row_count <> v_catalog_count THEN
      RETURN FALSE;
    END IF;

    IF v_dependency_override_decision IS NOT NULL THEN
      IF NOT v_dependency_override_allowed THEN
        RETURN FALSE;
      END IF;
      IF v_dependency_override_decision = 'allow' THEN
        v_dependency_effective_allowed := TRUE;
      ELSIF v_dependency_override_decision = 'deny' THEN
        v_dependency_effective_allowed := FALSE;
      ELSE
        RETURN FALSE;
      END IF;
    ELSE
      v_dependency_effective_allowed := COALESCE(v_dependency_base_allowed, FALSE);
    END IF;

    IF NOT v_dependency_effective_allowed THEN
      RETURN FALSE;
    END IF;
  END LOOP;

  RETURN TRUE;
END;
$function$;

-- O contexto enviado à interface aplica as mesmas dependências calculadas pelo helper.
-- Isso evita que a UI mostre uma ação liberada quando o backend a recusaria.
CREATE OR REPLACE FUNCTION public.get_my_app_context()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_username text;
  v_name text;
  v_role text;
  v_catalog_count integer;
  v_role_row_count integer;
  v_permissions jsonb;
  v_matrix_complete boolean;
  v_dependency_key text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'APP_CONTEXT_NOT_AUTHENTICATED' USING ERRCODE = '42501';
  END IF;

  SELECT p.username, p.name, pg_catalog.lower(pg_catalog.btrim(p.role))
    INTO v_username, v_name, v_role
    FROM public.profiles p
   WHERE p.id = v_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'APP_CONTEXT_PROFILE_MISSING' USING ERRCODE = '42501';
  END IF;

  IF v_role IS NULL OR v_role NOT IN ('administrador', 'apoio', 'producao', 'visualizador', 'lideranca') THEN
    RAISE EXCEPTION 'APP_CONTEXT_UNKNOWN_ROLE' USING ERRCODE = '42501';
  END IF;

  SELECT pg_catalog.count(*) INTO v_catalog_count
    FROM public.permission_catalog pc WHERE pc.is_active;

  SELECT pg_catalog.count(*) INTO v_role_row_count
    FROM public.role_permissions rp
    JOIN public.permission_catalog pc ON pc.permission_key = rp.permission_key AND pc.is_active
   WHERE rp.role = v_role;

  v_matrix_complete := (v_role_row_count = v_catalog_count);
  IF v_role <> 'administrador' AND NOT v_matrix_complete THEN
    RAISE EXCEPTION 'APP_CONTEXT_PERMISSION_MATRIX_INCOMPLETE' USING ERRCODE = '55000';
  END IF;

  SELECT pg_catalog.jsonb_object_agg(
    pc.permission_key,
    CASE
      WHEN v_role = 'administrador' THEN TRUE
      WHEN v_role NOT IN ('lideranca', 'apoio', 'producao', 'visualizador') THEN FALSE
      WHEN pc.is_admin_only THEN FALSE
      WHEN upo.user_id IS NOT NULL AND NOT pc.user_override_allowed THEN FALSE
      WHEN upo.decision = 'allow' AND pc.user_override_allowed THEN TRUE
      WHEN upo.decision = 'deny' AND pc.user_override_allowed THEN FALSE
      ELSE COALESCE(rp.allowed, FALSE)
    END
  )
  INTO v_permissions
  FROM public.permission_catalog pc
  LEFT JOIN public.role_permissions rp
    ON rp.role = v_role AND rp.permission_key = pc.permission_key
  LEFT JOIN public.user_permission_overrides upo
    ON upo.user_id = v_user_id AND upo.permission_key = pc.permission_key
  WHERE pc.is_active;

  IF v_role <> 'administrador'
     AND COALESCE((v_permissions ->> 'stock.search')::boolean, FALSE) IS NOT TRUE THEN
    FOREACH v_dependency_key IN ARRAY ARRAY[
      'dashboard.view', 'stock.launch.view', 'stock.launch.create',
      'stock.transfer.create', 'stock.batch.process', 'stock.physical_correction',
      'divergences.view', 'divergences.resolve', 'products.view', 'products.create',
      'products.edit', 'map.view', 'map.metadata.edit', 'warehouse.layout.view',
      'consultor.use'
    ] LOOP
      v_permissions := pg_catalog.jsonb_set(v_permissions, ARRAY[v_dependency_key], 'false'::jsonb, TRUE);
    END LOOP;
  END IF;

  IF v_role <> 'administrador'
     AND COALESCE((v_permissions ->> 'divergences.view')::boolean, FALSE) IS NOT TRUE THEN
    FOREACH v_dependency_key IN ARRAY ARRAY[
      'stock.launch.create', 'stock.transfer.create', 'stock.batch.process',
      'stock.physical_correction', 'divergences.resolve'
    ] LOOP
      v_permissions := pg_catalog.jsonb_set(v_permissions, ARRAY[v_dependency_key], 'false'::jsonb, TRUE);
    END LOOP;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'user', pg_catalog.jsonb_build_object(
      'id', v_user_id,
      'username', v_username,
      'name', v_name,
      'role', v_role
    ),
    'permissions', COALESCE(v_permissions, '{}'::jsonb),
    'matrix_complete', v_matrix_complete,
    'active_permission_count', v_catalog_count
  );
END;
$function$;

-- Pesquisa concede a leitura completa da linha (14 colunas). Nenhuma permissão
-- de tela, escrita, correção, Consultor ou legado concede SELECT isoladamente.
DROP POLICY IF EXISTS slots_select_authenticated ON public.slots;
DROP POLICY IF EXISTS slots_select_permission_catalog ON public.slots;
CREATE POLICY slots_select_permission_catalog ON public.slots
FOR SELECT TO authenticated
USING ((SELECT public.has_app_permission('stock.search')));

-- Acesso a divergências é independente da permissão de resolução.
DROP POLICY IF EXISTS divergencias_select_authenticated ON public.divergencias;
DROP POLICY IF EXISTS divergencias_select_permission_catalog ON public.divergencias;
CREATE POLICY divergencias_select_permission_catalog ON public.divergencias
FOR SELECT TO authenticated
USING ((SELECT public.has_app_permission('divergences.view')));

-- Remove a chave legada como concessão de leitura de produtos. stock.search
-- continua liberando o catálogo necessário aos filtros, descrições e cálculos.
DROP POLICY IF EXISTS products_select_authenticated ON public.products;
DROP POLICY IF EXISTS products_select_permission_catalog ON public.products;
CREATE POLICY products_select_permission_catalog ON public.products
FOR SELECT TO authenticated
USING (
  (SELECT public.has_app_permission('products.view'))
  OR (SELECT public.has_app_permission('products.create'))
  OR (SELECT public.has_app_permission('products.edit'))
  OR (SELECT public.has_app_permission('products.import_bulk'))
  OR (SELECT public.has_app_permission('products.delete_deactivate'))
  OR (SELECT public.has_app_permission('stock.search'))
  OR (SELECT public.has_app_permission('stock.launch.view'))
  OR (SELECT public.has_app_permission('stock.launch.create'))
  OR (SELECT public.has_app_permission('stock.transfer.create'))
  OR (SELECT public.has_app_permission('stock.batch.process'))
  OR (SELECT public.has_app_permission('consultor.use'))
);

DO $postflight$
DECLARE
  v_slots_policy_count integer;
  v_divergencias_policy_count integer;
  v_products_policy_count integer;
  v_slots_qual text;
  v_divergencias_qual text;
  v_products_qual text;
  v_role_row_count integer;
  v_column_count integer;
  v_permission_helper_definition text;
  v_context_helper_definition text;
BEGIN
  v_permission_helper_definition := pg_catalog.pg_get_functiondef('public.has_app_permission(text)'::pg_catalog.regprocedure);
  v_context_helper_definition := pg_catalog.pg_get_functiondef('public.get_my_app_context()'::pg_catalog.regprocedure);
  IF v_permission_helper_definition NOT ILIKE '%v_dependency_keys%'
     OR v_permission_helper_definition NOT ILIKE '%stock.search%'
     OR v_permission_helper_definition NOT ILIKE '%divergences.view%'
     OR v_context_helper_definition NOT ILIKE '%v_permissions ->> ''stock.search''%'
     OR v_context_helper_definition NOT ILIKE '%v_permissions ->> ''divergences.view''%' THEN
    RAISE EXCEPTION 'A03_READ_SCOPE_POSTFLIGHT_PERMISSION_DEPENDENCIES_INVALID';
  END IF;

  SELECT pg_catalog.count(*), pg_catalog.max(qual)
    INTO v_slots_policy_count, v_slots_qual
    FROM pg_catalog.pg_policies
   WHERE schemaname = 'public' AND tablename = 'slots' AND cmd = 'SELECT'
     AND policyname = 'slots_select_permission_catalog';
  SELECT pg_catalog.count(*), pg_catalog.max(qual)
    INTO v_divergencias_policy_count, v_divergencias_qual
    FROM pg_catalog.pg_policies
   WHERE schemaname = 'public' AND tablename = 'divergencias' AND cmd = 'SELECT'
     AND policyname = 'divergencias_select_permission_catalog';
  SELECT pg_catalog.count(*), pg_catalog.max(qual)
    INTO v_products_policy_count, v_products_qual
    FROM pg_catalog.pg_policies
   WHERE schemaname = 'public' AND tablename = 'products' AND cmd = 'SELECT'
     AND policyname = 'products_select_permission_catalog';

  IF v_slots_policy_count <> 1 OR v_slots_qual NOT ILIKE '%has_app_permission%stock.search%'
     OR v_slots_qual ILIKE '%stock.details.view%'
     OR v_slots_qual ILIKE '%dashboard.view%'
     OR v_slots_qual ILIKE '%divergences.resolve%' THEN
    RAISE EXCEPTION 'A03_READ_SCOPE_POSTFLIGHT_SLOTS_POLICY_INVALID: %', v_slots_qual;
  END IF;
  IF v_divergencias_policy_count <> 1 OR v_divergencias_qual NOT ILIKE '%has_app_permission%divergences.view%'
     OR v_divergencias_qual ILIKE '%divergences.resolve%' THEN
    RAISE EXCEPTION 'A03_READ_SCOPE_POSTFLIGHT_DIVERGENCIAS_POLICY_INVALID: %', v_divergencias_qual;
  END IF;
  IF v_products_policy_count <> 1 OR v_products_qual ILIKE '%stock.details.view%'
     OR v_products_qual NOT ILIKE '%stock.search%' THEN
    RAISE EXCEPTION 'A03_READ_SCOPE_POSTFLIGHT_PRODUCTS_POLICY_INVALID: %', v_products_qual;
  END IF;

  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_policies
       WHERE schemaname = 'public' AND tablename = 'slots' AND cmd = 'SELECT') <> 1
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_policies
       WHERE schemaname = 'public' AND tablename = 'divergencias' AND cmd = 'SELECT') <> 1
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_policies
       WHERE schemaname = 'public' AND tablename = 'products' AND cmd = 'SELECT') <> 1 THEN
    RAISE EXCEPTION 'A03_READ_SCOPE_POSTFLIGHT_DUPLICATE_SELECT_POLICY';
  END IF;

  SELECT pg_catalog.count(*) INTO v_role_row_count
    FROM public.role_permissions rp
    JOIN public.permission_catalog pc ON pc.permission_key = rp.permission_key AND pc.is_active IS TRUE;
  IF v_role_row_count <> 145
     OR NOT EXISTS (SELECT 1 FROM public.role_permissions WHERE role='lideranca' AND permission_key='stock.search' AND allowed IS TRUE)
     OR EXISTS (SELECT 1 FROM public.role_permissions WHERE role='lideranca' AND permission_key <> 'stock.search' AND allowed IS TRUE AND updated_at >= pg_catalog.transaction_timestamp()) THEN
    RAISE EXCEPTION 'A03_READ_SCOPE_POSTFLIGHT_ROLE_MATRIX_INVALID';
  END IF;

  SELECT pg_catalog.count(*) INTO v_column_count
    FROM pg_catalog.pg_attribute a
    JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'slots' AND a.attnum > 0 AND NOT a.attisdropped
     AND pg_catalog.has_column_privilege('authenticated', c.oid, a.attname, 'SELECT');
  IF v_column_count <> 14
     OR NOT pg_catalog.has_table_privilege('authenticated', 'public.slots', 'SELECT')
     OR pg_catalog.has_table_privilege('anon', 'public.slots', 'SELECT') THEN
    RAISE EXCEPTION 'A03_READ_SCOPE_POSTFLIGHT_SLOTS_COLUMN_ACCESS_INVALID: %', v_column_count;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('has_app_permission', 'get_my_app_context')
      AND (p.prosecdef IS DISTINCT FROM TRUE
           OR NOT (COALESCE(p.proconfig, ARRAY[]::text[]) @> ARRAY['search_path=""']::text[]))
  ) OR (SELECT pg_catalog.count(*)
          FROM pg_catalog.pg_proc p
          JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname='public' AND p.proname IN ('has_app_permission','get_my_app_context')) <> 2 THEN
    RAISE EXCEPTION 'A03_READ_SCOPE_POSTFLIGHT_PERMISSION_HELPER_SECURITY_INVALID';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.permission_catalog
     WHERE permission_key='stock.search'
       AND description='Consultar a base operacional completa de estoque (14 campos) e utilizar os filtros da Pesquisa.'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.permission_catalog
     WHERE permission_key='stock.details.view'
       AND description='Chave legada descontinuada; não controla campos exibidos nem a leitura da Pesquisa.'
  ) THEN
    RAISE EXCEPTION 'A03_READ_SCOPE_POSTFLIGHT_PERMISSION_CATALOG_DESCRIPTION_INVALID';
  END IF;
END;
$postflight$;

NOTIFY pgrst, 'reload schema';
COMMIT;
