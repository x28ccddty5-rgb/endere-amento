-- Rollback da Auditoria 03 / alinhamento final de leitura.
-- Executar somente no clone local e somente se for necessário reverter esta migração.
-- Não altera dados operacionais, grants de tabela, funções RPC ou publicação Realtime.
BEGIN;

DO $preflight$
BEGIN
  IF pg_catalog.to_regclass('public.permission_catalog') IS NULL
     OR pg_catalog.to_regclass('public.role_permissions') IS NULL
     OR pg_catalog.to_regclass('public.slots') IS NULL
     OR pg_catalog.to_regclass('public.divergencias') IS NULL
     OR pg_catalog.to_regclass('public.products') IS NULL
     OR pg_catalog.to_regclass('public.permission_change_audit') IS NULL THEN
    RAISE EXCEPTION 'A03_READ_SCOPE_ROLLBACK_REQUIRED_OBJECT_MISSING';
  END IF;
END;
$preflight$;

-- Restaura somente o grant-base de Pesquisa da Liderança para o seed B9 original.
DO $restore_leadership$
DECLARE
  v_changed integer;
BEGIN
  UPDATE public.role_permissions
     SET allowed = FALSE,
         updated_at = pg_catalog.transaction_timestamp(),
         updated_by = NULL
   WHERE role = 'lideranca'
     AND permission_key = 'stock.search'
     AND allowed IS DISTINCT FROM FALSE;
  GET DIAGNOSTICS v_changed = ROW_COUNT;

  IF v_changed > 0 THEN
    INSERT INTO public.permission_change_audit
      (actor_id, actor_username, actor_role, target_type, target_role, target_snapshot, changes)
    VALUES
      (NULL,
       'rollback:20261031150000_permission_read_scope_alignment',
       'system',
       'role',
       'lideranca',
       NULL,
       pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
         'permission_key', 'stock.search',
         'from', TRUE,
         'to', FALSE
       )));
  END IF;
END;
$restore_leadership$;

UPDATE public.permission_catalog
   SET description = 'Pesquisar referência, descrição e localização dentro do escopo operacional.',
       updated_at = pg_catalog.transaction_timestamp()
 WHERE permission_key = 'stock.search';

UPDATE public.permission_catalog
   SET description = 'Consultar detalhes operacionais de saldo e posição além dos campos mínimos da pesquisa.',
       updated_at = pg_catalog.transaction_timestamp()
 WHERE permission_key = 'stock.details.view';

-- Restaura o helper central anterior, sem as dependências adicionais de leitura.
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
    IF v_override_decision = 'allow' THEN RETURN TRUE; END IF;
    IF v_override_decision = 'deny' THEN RETURN FALSE; END IF;
    RETURN FALSE;
  END IF;

  RETURN COALESCE(v_base_allowed, FALSE);
END;
$function$;

-- Restore the prior app context payload without derived read dependencies.
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

-- Restaura exatamente as condições de leitura B6.2B anteriores a esta migração.
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

DROP POLICY IF EXISTS divergencias_select_authenticated ON public.divergencias;
DROP POLICY IF EXISTS divergencias_select_permission_catalog ON public.divergencias;
CREATE POLICY divergencias_select_permission_catalog ON public.divergencias
FOR SELECT TO authenticated
USING (
  (SELECT public.has_app_permission('divergences.view'))
  OR (SELECT public.has_app_permission('divergences.resolve'))
);

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

DO $postflight$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.role_permissions WHERE role='lideranca' AND permission_key='stock.search' AND allowed IS FALSE) THEN
    RAISE EXCEPTION 'A03_READ_SCOPE_ROLLBACK_LEADERSHIP_SEED_NOT_RESTORED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policies WHERE schemaname='public' AND tablename='slots' AND cmd='SELECT' AND qual ILIKE '%stock.details.view%') THEN
    RAISE EXCEPTION 'A03_READ_SCOPE_ROLLBACK_SLOTS_POLICY_NOT_RESTORED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policies WHERE schemaname='public' AND tablename='divergencias' AND cmd='SELECT' AND qual ILIKE '%divergences.resolve%') THEN
    RAISE EXCEPTION 'A03_READ_SCOPE_ROLLBACK_DIVERGENCES_POLICY_NOT_RESTORED';
  END IF;
END;
$postflight$;

COMMIT;
