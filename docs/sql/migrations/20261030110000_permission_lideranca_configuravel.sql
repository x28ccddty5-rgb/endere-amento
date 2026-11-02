-- B9 — Tornar Liderança um perfil configurável sem conceder acessos implicitamente.
-- Executar somente no clone local de integração. Não aplicar no Supabase Cloud nesta etapa.
BEGIN;

DO $preflight$
DECLARE
  v_catalog_count integer;
  v_existing_role_rows integer;
  v_base_role_rows integer;
  v_required_functions integer;
BEGIN
  IF pg_catalog.to_regclass('public.permission_catalog') IS NULL
     OR pg_catalog.to_regclass('public.role_permissions') IS NULL
     OR pg_catalog.to_regclass('public.user_permission_overrides') IS NULL
     OR pg_catalog.to_regclass('public.permission_change_audit') IS NULL THEN
    RAISE EXCEPTION 'B9_PERMISSION_FOUNDATION_MISSING';
  END IF;

  SELECT pg_catalog.count(*) INTO v_catalog_count
    FROM public.permission_catalog WHERE is_active;
  SELECT pg_catalog.count(*) INTO v_existing_role_rows
    FROM public.role_permissions WHERE role = 'lideranca';
  SELECT pg_catalog.count(*) INTO v_base_role_rows
    FROM public.role_permissions WHERE role <> 'lideranca';

  IF v_catalog_count <> 29 OR v_base_role_rows <> 116 OR v_existing_role_rows <> 0 THEN
    RAISE EXCEPTION 'B9_MATRIX_PREFLIGHT_FAILED: catalog %, non-leadership rows %, leadership rows %',
      v_catalog_count, v_base_role_rows, v_existing_role_rows;
  END IF;

  SELECT pg_catalog.count(*) INTO v_required_functions
  FROM (VALUES
    ('public.has_app_permission(text)'::text),
    ('public.get_my_app_context()'::text),
    ('public.get_permission_admin_matrix()'::text),
    ('public.save_role_permission_changes(text,jsonb)'::text),
    ('public.save_user_permission_overrides(uuid,jsonb)'::text)
  ) AS expected(signature)
  WHERE pg_catalog.to_regprocedure(expected.signature) IS NOT NULL;

  IF v_required_functions <> 5 THEN
    RAISE EXCEPTION 'B9_PERMISSION_RPCS_MISSING: % of 5', v_required_functions;
  END IF;
END;
$preflight$;

-- Expand only the two role constraints that represent configurable matrix targets.
ALTER TABLE public.role_permissions
  DROP CONSTRAINT IF EXISTS role_permissions_role_check;
ALTER TABLE public.role_permissions
  ADD CONSTRAINT role_permissions_role_check
  CHECK (role IN ('administrador', 'apoio', 'producao', 'visualizador', 'lideranca'));

ALTER TABLE public.permission_change_audit
  DROP CONSTRAINT IF EXISTS permission_change_audit_target_role_check;
ALTER TABLE public.permission_change_audit
  ADD CONSTRAINT permission_change_audit_target_role_check
  CHECK (target_role IS NULL OR target_role IN ('administrador', 'apoio', 'producao', 'visualizador', 'lideranca'));

-- Liderança receives an explicit complete matrix, but every permission starts denied.
INSERT INTO public.role_permissions (role, permission_key, allowed)
SELECT 'lideranca', pc.permission_key, FALSE
FROM public.permission_catalog pc
WHERE pc.is_active;

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

  -- Emergency administrator access applies only to known, active catalog keys.
  IF v_role = 'administrador' THEN
    RETURN TRUE;
  END IF;

  -- Liderança is configurable; its base matrix is seeded denied and overrides remain subject to catalog rules.
  IF v_role IS NULL OR v_role NOT IN ('apoio', 'producao', 'visualizador', 'lideranca') THEN
    RETURN FALSE;
  END IF;

  -- Administrative-only permissions can never be overridden for non-admins.
  IF v_admin_only THEN
    RETURN FALSE;
  END IF;

  -- Fail closed for every non-admin permission if their full base matrix is incomplete.
  -- The catalog is small (29 keys); this stays inside one backend call and adds no API request.
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
    -- Any corrupt override on a non-delegable key fails closed.
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


CREATE OR REPLACE FUNCTION public.get_permission_admin_matrix()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_role text;
  v_catalog jsonb;
  v_role_permissions jsonb;
  v_overrides jsonb;
  v_active_count integer;
  v_role_permission_count integer;
BEGIN
  IF v_user_id IS NULL OR NOT public.has_app_permission('permissions.manage') THEN
    RAISE EXCEPTION 'PERMISSION_ADMIN_REQUIRED' USING ERRCODE = '42501';
  END IF;

  SELECT pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'permission_key', pc.permission_key,
      'module_name', pc.module_name,
      'label', pc.label,
      'description', pc.description,
      'risk_level', pc.risk_level,
      'is_admin_only', pc.is_admin_only,
      'user_override_allowed', pc.user_override_allowed,
      'sort_order', pc.sort_order
    ) ORDER BY pc.sort_order
  ) INTO v_catalog
  FROM public.permission_catalog pc WHERE pc.is_active;

  SELECT pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'role', rp.role,
      'permission_key', rp.permission_key,
      'allowed', rp.allowed,
      'updated_at', rp.updated_at,
      'updated_by', rp.updated_by
    ) ORDER BY rp.role, pc.sort_order
  ) INTO v_role_permissions
  FROM public.role_permissions rp
  JOIN public.permission_catalog pc ON pc.permission_key = rp.permission_key
  WHERE pc.is_active;

  SELECT pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'user_id', upo.user_id,
      'username', p.username,
      'name', p.name,
      'role', pg_catalog.lower(pg_catalog.btrim(p.role)),
      'permission_key', upo.permission_key,
      'decision', upo.decision,
      'updated_at', upo.updated_at,
      'updated_by', upo.updated_by
    ) ORDER BY p.username, pc.sort_order
  ) INTO v_overrides
  FROM public.user_permission_overrides upo
  JOIN public.profiles p ON p.id = upo.user_id
  JOIN public.permission_catalog pc ON pc.permission_key = upo.permission_key
  WHERE pc.is_active;

  SELECT pg_catalog.count(*) INTO v_active_count FROM public.permission_catalog pc WHERE pc.is_active;
  SELECT pg_catalog.count(*) INTO v_role_permission_count
    FROM public.role_permissions rp JOIN public.permission_catalog pc
      ON pc.permission_key = rp.permission_key AND pc.is_active;

  RETURN pg_catalog.jsonb_build_object(
    'catalog', COALESCE(v_catalog, '[]'::jsonb),
    'role_permissions', COALESCE(v_role_permissions, '[]'::jsonb),
    'user_overrides', COALESCE(v_overrides, '[]'::jsonb),
    'matrix_status', pg_catalog.jsonb_build_object(
      'active_permissions', v_active_count,
      'expected_role_permission_rows', v_active_count * 5,
      'actual_role_permission_rows', v_role_permission_count,
      'complete', v_role_permission_count = v_active_count * 5
    )
  );
END;
$function$;


CREATE OR REPLACE FUNCTION public.save_role_permission_changes(
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

  -- Administrator remains immutable; Liderança is configurable but seeded with every permission denied.
  IF v_target_role IS NULL OR v_target_role NOT IN ('apoio', 'producao', 'visualizador', 'lideranca') THEN
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


CREATE OR REPLACE FUNCTION public.save_user_permission_overrides(
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
  IF v_target_role IS NULL OR v_target_role NOT IN ('apoio', 'producao', 'visualizador', 'lideranca') THEN
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



-- Preserve/reassert the intended client-facing ACLs after CREATE OR REPLACE.
REVOKE ALL ON FUNCTION public.has_app_permission(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_app_permission(text) TO authenticated;
REVOKE ALL ON FUNCTION public.get_my_app_context() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_app_context() TO authenticated;
REVOKE ALL ON FUNCTION public.get_permission_admin_matrix() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_permission_admin_matrix() TO authenticated;
REVOKE ALL ON FUNCTION public.save_role_permission_changes(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_role_permission_changes(text, jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.save_user_permission_overrides(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_user_permission_overrides(uuid, jsonb) TO authenticated;

DO $verify_function_security$
DECLARE
  v_function_count integer;
  v_secure_function_count integer;
BEGIN
  SELECT
    pg_catalog.count(*),
    pg_catalog.count(*) FILTER (
      WHERE p.prosecdef
        AND p.proconfig @> ARRAY['search_path=""']::text[]
        AND pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
        AND NOT pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
    )
    INTO v_function_count, v_secure_function_count
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND (
      (p.proname = 'has_app_permission' AND pg_catalog.pg_get_function_identity_arguments(p.oid) = 'p_permission_key text')
      OR (p.proname = 'get_my_app_context' AND pg_catalog.pg_get_function_identity_arguments(p.oid) = '')
      OR (p.proname = 'get_permission_admin_matrix' AND pg_catalog.pg_get_function_identity_arguments(p.oid) = '')
      OR (p.proname = 'save_role_permission_changes' AND pg_catalog.pg_get_function_identity_arguments(p.oid) = 'p_target_role text, p_changes jsonb')
      OR (p.proname = 'save_user_permission_overrides' AND pg_catalog.pg_get_function_identity_arguments(p.oid) = 'p_target_user_id uuid, p_changes jsonb')
    );

  IF v_function_count <> 5 OR v_secure_function_count <> 5 THEN
    RAISE EXCEPTION 'B9_PERMISSION_FUNCTION_SECURITY_FAILED: functions %, secure %',
      v_function_count, v_secure_function_count;
  END IF;
END;
$verify_function_security$;

DO $verify$
DECLARE
  v_catalog_count integer;
  v_role_row_count integer;
  v_role_count integer;
  v_leadership_row_count integer;
  v_leadership_allowed_count integer;
  v_admin_only_leadership_count integer;
BEGIN
  SELECT pg_catalog.count(*) INTO v_catalog_count
    FROM public.permission_catalog WHERE is_active;
  SELECT pg_catalog.count(*) INTO v_role_row_count
    FROM public.role_permissions rp
    JOIN public.permission_catalog pc ON pc.permission_key = rp.permission_key AND pc.is_active;
  SELECT pg_catalog.count(DISTINCT rp.role) INTO v_role_count
    FROM public.role_permissions rp
    JOIN public.permission_catalog pc ON pc.permission_key = rp.permission_key AND pc.is_active;
  SELECT pg_catalog.count(*), pg_catalog.count(*) FILTER (WHERE rp.allowed)
    INTO v_leadership_row_count, v_leadership_allowed_count
    FROM public.role_permissions rp
    JOIN public.permission_catalog pc ON pc.permission_key = rp.permission_key AND pc.is_active
   WHERE rp.role = 'lideranca';
  SELECT pg_catalog.count(*) INTO v_admin_only_leadership_count
    FROM public.role_permissions rp
    JOIN public.permission_catalog pc ON pc.permission_key = rp.permission_key AND pc.is_active
   WHERE rp.role = 'lideranca' AND pc.is_admin_only AND rp.allowed;

  IF v_catalog_count <> 29 OR v_role_row_count <> 145 OR v_role_count <> 5
     OR v_leadership_row_count <> 29 OR v_leadership_allowed_count <> 0
     OR v_admin_only_leadership_count <> 0 THEN
    RAISE EXCEPTION 'B9_MATRIX_VERIFY_FAILED: catalog %, rows %, roles %, leadership rows %, leadership allowed %, admin-only grants %',
      v_catalog_count, v_role_row_count, v_role_count, v_leadership_row_count,
      v_leadership_allowed_count, v_admin_only_leadership_count;
  END IF;
END;
$verify$;

COMMIT;
