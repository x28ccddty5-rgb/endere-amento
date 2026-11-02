-- Auditoria 03 / alinhamento final de leitura, pesquisa e divergências.
-- Executar somente no clone local de integração após B9 e B6.2B.
-- Não altera registros operacionais, grants de tabela, publicação Realtime ou RPCs transacionais.
-- Atualiza apenas os helpers centrais de autorização para aplicar dependências de leitura.
-- Mantém SELECT completo (14 colunas) em slots, autorizado exclusivamente por stock.search.

BEGIN;

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
       'migration:20261031150000_permission_read_scope_alignment',
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

COMMIT;
