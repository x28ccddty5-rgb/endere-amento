-- Etapa 03 / Fase B2: RPCs administrativas para gravar permissões.
-- A migration é aditiva: não modifica políticas RLS nem RPCs de estoque.
-- Executar inicialmente somente na base local/teste enderecamento_test.
BEGIN;

-- Preflight: require the already-applied B1 foundation and a complete seed.
DO $preflight$
DECLARE
  v_catalog_count integer;
  v_role_rows integer;
  v_foundation_tables integer;
BEGIN
  SELECT pg_catalog.count(*) INTO v_foundation_tables
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname IN ('permission_catalog', 'role_permissions', 'user_permission_overrides', 'permission_change_audit')
    AND c.relkind = 'r';
  IF v_foundation_tables <> 4 THEN
    RAISE EXCEPTION 'PERMISSION_B2_REQUIRES_COMPLETE_B1_FOUNDATION';
  END IF;

  SELECT pg_catalog.count(*) INTO v_catalog_count
  FROM public.permission_catalog WHERE is_active;
  SELECT pg_catalog.count(*) INTO v_role_rows
  FROM public.role_permissions;
  IF v_catalog_count <> 29 OR v_role_rows <> 116 THEN
    RAISE EXCEPTION 'PERMISSION_B2_REQUIRES_COMPLETE_B1_MATRIX: keys %, grants %', v_catalog_count, v_role_rows;
  END IF;
  IF pg_catalog.to_regprocedure('public.has_app_permission(text)') IS NULL THEN
    RAISE EXCEPTION 'PERMISSION_B2_REQUIRES_B1_AUTHORIZATION_HELPER';
  END IF;
END;
$preflight$;

CREATE FUNCTION public.save_role_permission_changes(
  p_target_role text,
  p_changes jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_username text;
  v_actor_role text;
  v_target_role text := pg_catalog.lower(pg_catalog.btrim(p_target_role));
  v_active_catalog_count integer;
  v_role_grant_count integer;
  v_input_count integer;
  v_unique_count integer;
  v_item jsonb;
  v_permission_key text;
  v_new_allowed boolean;
  v_old_allowed boolean;
  v_is_admin_only boolean;
  v_effective_changes jsonb := '[]'::jsonb;
  v_audit_id bigint;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'PERMISSION_ADMIN_NOT_AUTHENTICATED' USING ERRCODE = '42501';
  END IF;

  SELECT p.username, pg_catalog.lower(pg_catalog.btrim(p.role))
    INTO v_actor_username, v_actor_role
    FROM public.profiles p
   WHERE p.id = v_actor_id
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PERMISSION_ADMIN_PROFILE_MISSING' USING ERRCODE = '42501';
  END IF;
  IF v_actor_role <> 'administrador'
     OR NOT public.has_app_permission('permissions.manage') THEN
    RAISE EXCEPTION 'PERMISSION_ADMIN_REQUIRED' USING ERRCODE = '42501';
  END IF;

  -- Administrador keeps its full access; Liderança is legacy and cannot receive grants.
  IF v_target_role IS NULL OR v_target_role NOT IN ('apoio', 'producao', 'visualizador') THEN
    RAISE EXCEPTION 'PERMISSION_TARGET_ROLE_NOT_CONFIGURABLE';
  END IF;
  IF p_changes IS NULL OR pg_catalog.jsonb_typeof(p_changes) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'PERMISSION_CHANGES_MUST_BE_ARRAY';
  END IF;

  v_input_count := pg_catalog.jsonb_array_length(p_changes);
  IF v_input_count < 1 OR v_input_count > 29 THEN
    RAISE EXCEPTION 'PERMISSION_CHANGE_BATCH_SIZE_INVALID';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.jsonb_array_elements(p_changes) AS e(value)
     WHERE pg_catalog.jsonb_typeof(e.value) IS DISTINCT FROM 'object'
        OR pg_catalog.jsonb_typeof(e.value -> 'permission_key') IS DISTINCT FROM 'string'
        OR pg_catalog.jsonb_typeof(e.value -> 'allowed') IS DISTINCT FROM 'boolean'
        OR NULLIF(pg_catalog.btrim(e.value ->> 'permission_key'), '') IS NULL
        OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(e.value)) <> 2
  ) THEN
    RAISE EXCEPTION 'PERMISSION_CHANGE_ITEM_INVALID';
  END IF;

  SELECT pg_catalog.count(DISTINCT e.value ->> 'permission_key')
    INTO v_unique_count
    FROM pg_catalog.jsonb_array_elements(p_changes) AS e(value);
  IF v_unique_count <> v_input_count THEN
    RAISE EXCEPTION 'PERMISSION_DUPLICATE_KEYS_IN_BATCH';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.jsonb_array_elements(p_changes) AS e(value)
      LEFT JOIN public.permission_catalog pc
        ON pc.permission_key = e.value ->> 'permission_key'
       AND pc.is_active
     WHERE pc.permission_key IS NULL
  ) THEN
    RAISE EXCEPTION 'PERMISSION_KEY_UNKNOWN_OR_INACTIVE';
  END IF;

  SELECT pg_catalog.count(*) INTO v_active_catalog_count
    FROM public.permission_catalog pc WHERE pc.is_active;
  SELECT pg_catalog.count(*) INTO v_role_grant_count
    FROM public.role_permissions rp
    JOIN public.permission_catalog pc
      ON pc.permission_key = rp.permission_key AND pc.is_active
   WHERE rp.role = v_target_role;
  IF v_active_catalog_count <> 29 OR v_role_grant_count <> v_active_catalog_count THEN
    RAISE EXCEPTION 'PERMISSION_ROLE_MATRIX_INCOMPLETE';
  END IF;

  -- Lock submitted rows in a deterministic order to reduce the chance of lock inversion.
  PERFORM rp.permission_key
    FROM public.role_permissions rp
    JOIN (
      SELECT e.value ->> 'permission_key' AS permission_key
        FROM pg_catalog.jsonb_array_elements(p_changes) AS e(value)
    ) submitted USING (permission_key)
   WHERE rp.role = v_target_role
   ORDER BY rp.permission_key
   FOR UPDATE OF rp;

  FOR v_item IN
    SELECT e.value
      FROM pg_catalog.jsonb_array_elements(p_changes) AS e(value)
     ORDER BY e.value ->> 'permission_key'
  LOOP
    v_permission_key := v_item ->> 'permission_key';
    v_new_allowed := (v_item ->> 'allowed')::boolean;

    SELECT pc.is_admin_only INTO v_is_admin_only
      FROM public.permission_catalog pc
     WHERE pc.permission_key = v_permission_key AND pc.is_active;

    IF v_is_admin_only AND v_new_allowed THEN
      RAISE EXCEPTION 'PERMISSION_ADMIN_ONLY_CANNOT_BE_GRANTED_TO_ROLE: %', v_permission_key;
    END IF;

    SELECT rp.allowed INTO v_old_allowed
      FROM public.role_permissions rp
     WHERE rp.role = v_target_role AND rp.permission_key = v_permission_key
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'PERMISSION_ROLE_GRANT_ROW_MISSING: %', v_permission_key;
    END IF;

    IF v_old_allowed IS DISTINCT FROM v_new_allowed THEN
      UPDATE public.role_permissions rp
         SET allowed = v_new_allowed,
             updated_at = pg_catalog.transaction_timestamp(),
             updated_by = v_actor_id
       WHERE rp.role = v_target_role AND rp.permission_key = v_permission_key;

      v_effective_changes := v_effective_changes || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'permission_key', v_permission_key,
          'from', v_old_allowed,
          'to', v_new_allowed
        )
      );
    END IF;
  END LOOP;

  IF pg_catalog.jsonb_array_length(v_effective_changes) > 0 THEN
    INSERT INTO public.permission_change_audit
      (actor_id, actor_username, actor_role, target_type, target_role, target_snapshot, changes)
    VALUES
      (v_actor_id,
       COALESCE(NULLIF(pg_catalog.btrim(v_actor_username), ''), v_actor_id::text),
       v_actor_role,
       'role',
       v_target_role,
       NULL,
       v_effective_changes)
    RETURNING id INTO v_audit_id;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'ok', TRUE,
    'target_type', 'role',
    'target_role', v_target_role,
    'changed_count', pg_catalog.jsonb_array_length(v_effective_changes),
    'changes', v_effective_changes,
    'audit_id', v_audit_id
  );
END;
$function$;

CREATE FUNCTION public.save_user_permission_overrides(
  p_target_user_id uuid,
  p_changes jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_username text;
  v_actor_role text;
  v_target_username text;
  v_target_name text;
  v_target_role text;
  v_target_snapshot jsonb;
  v_active_catalog_count integer;
  v_target_role_grant_count integer;
  v_input_count integer;
  v_unique_count integer;
  v_item jsonb;
  v_permission_key text;
  v_new_decision text;
  v_old_decision text;
  v_is_admin_only boolean;
  v_override_allowed boolean;
  v_effective_changes jsonb := '[]'::jsonb;
  v_audit_id bigint;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'PERMISSION_ADMIN_NOT_AUTHENTICATED' USING ERRCODE = '42501';
  END IF;

  SELECT p.username, pg_catalog.lower(pg_catalog.btrim(p.role))
    INTO v_actor_username, v_actor_role
    FROM public.profiles p
   WHERE p.id = v_actor_id
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PERMISSION_ADMIN_PROFILE_MISSING' USING ERRCODE = '42501';
  END IF;
  IF v_actor_role <> 'administrador'
     OR NOT public.has_app_permission('permissions.manage') THEN
    RAISE EXCEPTION 'PERMISSION_ADMIN_REQUIRED' USING ERRCODE = '42501';
  END IF;

  IF p_target_user_id IS NULL THEN
    RAISE EXCEPTION 'PERMISSION_TARGET_USER_REQUIRED';
  END IF;
  IF p_changes IS NULL OR pg_catalog.jsonb_typeof(p_changes) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'PERMISSION_CHANGES_MUST_BE_ARRAY';
  END IF;

  v_input_count := pg_catalog.jsonb_array_length(p_changes);
  IF v_input_count < 1 OR v_input_count > 29 THEN
    RAISE EXCEPTION 'PERMISSION_CHANGE_BATCH_SIZE_INVALID';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.jsonb_array_elements(p_changes) AS e(value)
     WHERE pg_catalog.jsonb_typeof(e.value) IS DISTINCT FROM 'object'
        OR pg_catalog.jsonb_typeof(e.value -> 'permission_key') IS DISTINCT FROM 'string'
        OR pg_catalog.jsonb_typeof(e.value -> 'decision') IS DISTINCT FROM 'string'
        OR NULLIF(pg_catalog.btrim(e.value ->> 'permission_key'), '') IS NULL
        OR (e.value ->> 'decision') NOT IN ('allow', 'deny', 'inherit')
        OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(e.value)) <> 2
  ) THEN
    RAISE EXCEPTION 'PERMISSION_OVERRIDE_ITEM_INVALID';
  END IF;

  SELECT pg_catalog.count(DISTINCT e.value ->> 'permission_key')
    INTO v_unique_count
    FROM pg_catalog.jsonb_array_elements(p_changes) AS e(value);
  IF v_unique_count <> v_input_count THEN
    RAISE EXCEPTION 'PERMISSION_DUPLICATE_KEYS_IN_BATCH';
  END IF;

  SELECT p.username, p.name, pg_catalog.lower(pg_catalog.btrim(p.role))
    INTO v_target_username, v_target_name, v_target_role
    FROM public.profiles p
   WHERE p.id = p_target_user_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PERMISSION_TARGET_USER_NOT_FOUND';
  END IF;
  IF v_target_role IS NULL OR v_target_role NOT IN ('apoio', 'producao', 'visualizador') THEN
    RAISE EXCEPTION 'PERMISSION_TARGET_USER_ROLE_NOT_DELEGABLE';
  END IF;

  SELECT pg_catalog.count(*) INTO v_active_catalog_count
    FROM public.permission_catalog pc WHERE pc.is_active;
  SELECT pg_catalog.count(*) INTO v_target_role_grant_count
    FROM public.role_permissions rp
    JOIN public.permission_catalog pc
      ON pc.permission_key = rp.permission_key AND pc.is_active
   WHERE rp.role = v_target_role;
  IF v_active_catalog_count <> 29 OR v_target_role_grant_count <> v_active_catalog_count THEN
    RAISE EXCEPTION 'PERMISSION_TARGET_ROLE_MATRIX_INCOMPLETE';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.jsonb_array_elements(p_changes) AS e(value)
      LEFT JOIN public.permission_catalog pc
        ON pc.permission_key = e.value ->> 'permission_key'
       AND pc.is_active
     WHERE pc.permission_key IS NULL
  ) THEN
    RAISE EXCEPTION 'PERMISSION_KEY_UNKNOWN_OR_INACTIVE';
  END IF;

  v_target_snapshot := pg_catalog.jsonb_build_object(
    'id', p_target_user_id,
    'username', v_target_username,
    'name', v_target_name,
    'role', v_target_role
  );

  FOR v_item IN
    SELECT e.value
      FROM pg_catalog.jsonb_array_elements(p_changes) AS e(value)
     ORDER BY e.value ->> 'permission_key'
  LOOP
    v_permission_key := v_item ->> 'permission_key';
    v_new_decision := v_item ->> 'decision';

    SELECT pc.is_admin_only, pc.user_override_allowed
      INTO v_is_admin_only, v_override_allowed
      FROM public.permission_catalog pc
     WHERE pc.permission_key = v_permission_key AND pc.is_active;

    -- 'inherit' is allowed for cleanup; new allow/deny overrides require an explicitly delegable key.
    IF v_new_decision <> 'inherit' AND (v_is_admin_only OR NOT v_override_allowed) THEN
      RAISE EXCEPTION 'PERMISSION_OVERRIDE_NOT_DELEGABLE: %', v_permission_key;
    END IF;

    SELECT upo.decision INTO v_old_decision
      FROM public.user_permission_overrides upo
     WHERE upo.user_id = p_target_user_id
       AND upo.permission_key = v_permission_key
     FOR UPDATE;
    IF NOT FOUND THEN
      v_old_decision := 'inherit';
    END IF;

    IF v_old_decision IS DISTINCT FROM v_new_decision THEN
      IF v_new_decision = 'inherit' THEN
        DELETE FROM public.user_permission_overrides upo
         WHERE upo.user_id = p_target_user_id
           AND upo.permission_key = v_permission_key;
      ELSE
        INSERT INTO public.user_permission_overrides
          (user_id, permission_key, decision, updated_at, updated_by)
        VALUES
          (p_target_user_id, v_permission_key, v_new_decision,
           pg_catalog.transaction_timestamp(), v_actor_id)
        ON CONFLICT (user_id, permission_key) DO UPDATE
          SET decision = EXCLUDED.decision,
              updated_at = EXCLUDED.updated_at,
              updated_by = EXCLUDED.updated_by;
      END IF;

      v_effective_changes := v_effective_changes || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'permission_key', v_permission_key,
          'from', v_old_decision,
          'to', v_new_decision
        )
      );
    END IF;
  END LOOP;

  IF pg_catalog.jsonb_array_length(v_effective_changes) > 0 THEN
    INSERT INTO public.permission_change_audit
      (actor_id, actor_username, actor_role, target_type, target_role,
       target_user_id, target_snapshot, changes)
    VALUES
      (v_actor_id,
       COALESCE(NULLIF(pg_catalog.btrim(v_actor_username), ''), v_actor_id::text),
       v_actor_role,
       'user',
       NULL,
       p_target_user_id,
       v_target_snapshot,
       v_effective_changes)
    RETURNING id INTO v_audit_id;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'ok', TRUE,
    'target_type', 'user',
    'target_user_id', p_target_user_id,
    'target_role', v_target_role,
    'changed_count', pg_catalog.jsonb_array_length(v_effective_changes),
    'changes', v_effective_changes,
    'audit_id', v_audit_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.save_role_permission_changes(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_role_permission_changes(text, jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.save_user_permission_overrides(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_user_permission_overrides(uuid, jsonb) TO authenticated;

DO $verify_rpc_contract$
BEGIN
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN ('save_role_permission_changes', 'save_user_permission_overrides')
        AND p.prosecdef
        AND p.proconfig @> ARRAY['search_path=""']::text[]) <> 2 THEN
    RAISE EXCEPTION 'PERMISSION_WRITE_RPC_SECURITY_CONTRACT_FAILED';
  END IF;
  IF pg_catalog.has_function_privilege('anon', 'public.save_role_permission_changes(text,jsonb)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', 'public.save_user_permission_overrides(uuid,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'PERMISSION_WRITE_RPC_ANON_EXECUTE_MUST_BE_DENIED';
  END IF;
  IF NOT pg_catalog.has_function_privilege('authenticated', 'public.save_role_permission_changes(text,jsonb)', 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('authenticated', 'public.save_user_permission_overrides(uuid,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'PERMISSION_WRITE_RPC_AUTHENTICATED_EXECUTE_MISSING';
  END IF;
END;
$verify_rpc_contract$;

COMMIT;
