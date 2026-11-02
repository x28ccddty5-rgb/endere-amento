BEGIN;

DO $preflight$
BEGIN
  IF to_regprocedure('public.has_app_permission(text)') IS NULL
     OR to_regprocedure('public.stock_address_lock_key(text,text,text)') IS NULL
     OR to_regprocedure('public.lock_stock_address_key(text)') IS NULL
     OR to_regprocedure('public.shared_draft_slot_identity_is_inconsistent(public.slots)') IS NULL THEN
    RAISE EXCEPTION 'B10_REQUIRED_PERMISSION_OR_STOCK_HELPER_MISSING';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.permission_catalog
     WHERE permission_key = 'stock.launch.create' AND is_active IS TRUE
  ) OR NOT EXISTS (
    SELECT 1 FROM public.permission_catalog
     WHERE permission_key = 'stock.transfer.create' AND is_active IS TRUE
  ) OR NOT EXISTS (
    SELECT 1 FROM public.permission_catalog
     WHERE permission_key = 'stock.physical_correction' AND is_active IS TRUE
  ) THEN
    RAISE EXCEPTION 'B10_REQUIRED_OPERATION_PERMISSION_MISSING_OR_INACTIVE';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.record_stock_conflict_divergences_atomic(
  p_operation_type text,
  p_divergencias jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_permission_key text;
  v_actor_name text;
  v_item jsonb;
  v_new_divergencia public.divergencias%ROWTYPE;
  v_existing_divergencia public.divergencias%ROWTYPE;
  v_scope_key text;
  v_scope_stock text;
  v_scope_module text;
  v_slot_id text;
  v_slot public.slots%ROWTYPE;
  v_module_active boolean;
  v_inserted integer := 0;
  v_already_present integer := 0;
  v_row_inserted integer := 0;
  v_expected_new_count integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501';
  END IF;

  v_permission_key := CASE p_operation_type
    WHEN 'launch' THEN 'stock.launch.create'
    WHEN 'transfer' THEN 'stock.transfer.create'
    WHEN 'physical_correction' THEN 'stock.physical_correction'
    ELSE NULL
  END;

  IF v_permission_key IS NULL THEN
    RAISE EXCEPTION 'INVALID_STOCK_OPERATION_TYPE' USING ERRCODE = '22023';
  END IF;

  IF public.has_app_permission(v_permission_key) IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'PERMISSION_DENIED:%', v_permission_key USING ERRCODE = '42501';
  END IF;

  SELECT p.name
    INTO v_actor_name
    FROM public.profiles AS p
   WHERE p.id = auth.uid();

  IF COALESCE(btrim(v_actor_name), '') = '' THEN
    RAISE EXCEPTION 'OPERATOR_PROFILE_MISSING' USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(p_divergencias) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'INVALID_CONFLICT_DIVERGENCE_PAYLOAD' USING ERRCODE = '22023';
  END IF;

  v_expected_new_count := jsonb_array_length(p_divergencias);
  IF v_expected_new_count < 1 OR v_expected_new_count > 10000 THEN
    RAISE EXCEPTION 'INVALID_CONFLICT_DIVERGENCE_PAYLOAD_SIZE' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(p_divergencias) AS d(value)
     WHERE jsonb_typeof(d.value) IS DISTINCT FROM 'object'
        OR COALESCE(btrim(d.value ->> 'id'), '') = ''
  ) OR EXISTS (
    SELECT 1
      FROM jsonb_array_elements(p_divergencias) AS d(value)
     GROUP BY d.value ->> 'id'
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'DUPLICATE_OR_EMPTY_CONFLICT_DIVERGENCE_ID' USING ERRCODE = '22023';
  END IF;

  -- Parse and validate every row before deriving lock keys. This also ensures
  -- malformed coordinates fail closed before any lock-helper side effect.
  FOR v_item IN
    SELECT d.value
      FROM jsonb_array_elements(p_divergencias) AS d(value)
     ORDER BY d.value ->> 'id'
  LOOP
    SELECT r.*
      INTO v_new_divergencia
      FROM jsonb_populate_record(NULL::public.divergencias, v_item) AS r;

    IF COALESCE(btrim(v_new_divergencia.id), '') = ''
       OR COALESCE(btrim(v_new_divergencia."dataDivergencia"), '') = ''
       OR COALESCE(btrim(v_new_divergencia."tipoDivergencia"), '') = ''
       OR v_new_divergencia.estoque IS NULL
       OR v_new_divergencia.estoque NOT IN ('1', '2', '3')
       OR v_new_divergencia.modulo IS NULL
       OR COALESCE(btrim(v_new_divergencia.modulo), '') !~ '^[1-9][0-9]*$'
       OR (v_new_divergencia.estoque = '1' AND COALESCE(v_new_divergencia.posicao, '') <> '')
       OR (v_new_divergencia.estoque IN ('2', '3') AND (
         COALESCE(btrim(v_new_divergencia.posicao), '') = ''
         OR v_new_divergencia.posicao <> upper(btrim(v_new_divergencia.posicao))
       ))
       OR COALESCE(btrim(v_new_divergencia.responsavel), '') = ''
       OR v_new_divergencia."saldoAntes" IS NULL
       OR v_new_divergencia."saldoAntes" < 0
       OR v_new_divergencia.movimentacao IS NULL
       OR v_new_divergencia.movimentacao = 0
       OR v_new_divergencia."saldoFinal" IS NULL
       OR v_new_divergencia."saldoFinal" < 0
       OR v_new_divergencia.status IS DISTINCT FROM 'Aberta'
       OR COALESCE(v_new_divergencia."dataCorrecao", '') <> ''
       OR COALESCE(v_new_divergencia."corrigidoPor", '') <> ''
       OR v_new_divergencia."correcaoId" IS NOT NULL
       OR (v_new_divergencia.restricao IS NOT NULL AND v_new_divergencia.restricao NOT IN (
         'nenhuma', 'teste', 'autorizacao', 'outra'
       )) THEN
      RAISE EXCEPTION 'INVALID_OPEN_CONFLICT_DIVERGENCE: %', v_new_divergencia.id USING ERRCODE = '22023';
    END IF;
  END LOOP;

  -- Lock affected address scopes in deterministic order. This uses the same
  -- lock registry as stock mutations, while this RPC itself never writes slots
  -- or history.
  FOR v_scope_key IN
    SELECT DISTINCT public.stock_address_lock_key(
      d.value ->> 'estoque', d.value ->> 'modulo', COALESCE(d.value ->> 'posicao', '')
    )
    FROM jsonb_array_elements(p_divergencias) AS d(value)
    ORDER BY 1
  LOOP
    PERFORM public.lock_stock_address_key(v_scope_key);
  END LOOP;

  -- Server-side proof for the two exceptional divergence families that bypass
  -- the ordinary stock writer. Their address-level grouping must remain pure.
  FOR v_scope_key IN
    SELECT DISTINCT public.stock_address_lock_key(
      d.value ->> 'estoque', d.value ->> 'modulo', COALESCE(d.value ->> 'posicao', '')
    )
    FROM jsonb_array_elements(p_divergencias) AS d(value)
    ORDER BY 1
  LOOP
    IF EXISTS (
      SELECT 1
        FROM jsonb_array_elements(p_divergencias) AS d(value)
       WHERE public.stock_address_lock_key(
         d.value ->> 'estoque', d.value ->> 'modulo', COALESCE(d.value ->> 'posicao', '')
       ) = v_scope_key
         AND d.value ->> 'tipoDivergencia' = 'Módulo Inativo'
    ) THEN
      IF EXISTS (
        SELECT 1
          FROM jsonb_array_elements(p_divergencias) AS d(value)
         WHERE public.stock_address_lock_key(
           d.value ->> 'estoque', d.value ->> 'modulo', COALESCE(d.value ->> 'posicao', '')
         ) = v_scope_key
           AND d.value ->> 'tipoDivergencia' <> 'Módulo Inativo'
      ) THEN
        RAISE EXCEPTION 'CONFLICT_SCOPE_TYPE_MIXED' USING ERRCODE = '22023';
      END IF;

      SELECT d.value ->> 'estoque', d.value ->> 'modulo'
        INTO v_scope_stock, v_scope_module
        FROM jsonb_array_elements(p_divergencias) AS d(value)
       WHERE public.stock_address_lock_key(
         d.value ->> 'estoque', d.value ->> 'modulo', COALESCE(d.value ->> 'posicao', '')
       ) = v_scope_key
       LIMIT 1;

      SELECT l.ativo
        INTO v_module_active
        FROM public.warehouse_layout AS l
       WHERE l.estoque = v_scope_stock
         AND CASE
           WHEN btrim(l.modulo) ~ '^\d+$' THEN (btrim(l.modulo)::numeric)::text
           ELSE btrim(l.modulo)
         END = v_scope_module
       FOR SHARE;

      IF NOT FOUND OR v_module_active IS DISTINCT FROM FALSE THEN
        RAISE EXCEPTION 'MODULE_INACTIVE_DIVERGENCE_NOT_CONFIRMED' USING ERRCODE = '40001';
      END IF;
    ELSIF EXISTS (
      SELECT 1
        FROM jsonb_array_elements(p_divergencias) AS d(value)
       WHERE public.stock_address_lock_key(
         d.value ->> 'estoque', d.value ->> 'modulo', COALESCE(d.value ->> 'posicao', '')
       ) = v_scope_key
         AND d.value ->> 'tipoDivergencia' = 'ID de Endereço Inconsistente'
    ) THEN
      IF EXISTS (
        SELECT 1
          FROM jsonb_array_elements(p_divergencias) AS d(value)
         WHERE public.stock_address_lock_key(
           d.value ->> 'estoque', d.value ->> 'modulo', COALESCE(d.value ->> 'posicao', '')
         ) = v_scope_key
           AND d.value ->> 'tipoDivergencia' NOT IN (
             'ID de Endereço Inconsistente', 'Posição Bloqueada por Divergência'
           )
      ) THEN
        RAISE EXCEPTION 'CONFLICT_SCOPE_TYPE_MIXED' USING ERRCODE = '22023';
      END IF;

      IF (
        SELECT count(*)
          FROM jsonb_array_elements(p_divergencias) AS d(value)
         WHERE public.stock_address_lock_key(
           d.value ->> 'estoque', d.value ->> 'modulo', COALESCE(d.value ->> 'posicao', '')
         ) = v_scope_key
           AND d.value ->> 'tipoDivergencia' = 'ID de Endereço Inconsistente'
      ) <> 1 THEN
        RAISE EXCEPTION 'CONFLICT_SCOPE_ROOT_IDENTITY_COUNT_INVALID' USING ERRCODE = '22023';
      END IF;
    ELSIF EXISTS (
      SELECT 1
        FROM jsonb_array_elements(p_divergencias) AS d(value)
       WHERE public.stock_address_lock_key(
         d.value ->> 'estoque', d.value ->> 'modulo', COALESCE(d.value ->> 'posicao', '')
       ) = v_scope_key
         AND d.value ->> 'tipoDivergencia' = 'Posição Bloqueada por Divergência'
    ) AND NOT EXISTS (
      SELECT 1
        FROM public.divergencias AS existing_root
       WHERE public.stock_address_lock_key(
         existing_root.estoque, existing_root.modulo, COALESCE(existing_root.posicao, '')
       ) = v_scope_key
         AND existing_root.status = 'Aberta'
         AND existing_root."tipoDivergencia" = 'ID de Endereço Inconsistente'
         AND EXISTS (
           SELECT 1
             FROM public.slots AS root_slot
            WHERE root_slot.id = (to_jsonb(existing_root) ->> 'slot_id')
              AND public.shared_draft_slot_identity_is_inconsistent(root_slot)
         )
    ) THEN
      RAISE EXCEPTION 'BLOCKED_POSITION_WITHOUT_ROOT_IDENTITY_DIVERGENCE' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  -- Recheck the database identity for each root mismatch. The slot_id key is
  -- read from JSON so this function remains compatible with schemas where that
  -- optional divergence column has not yet been introduced.
  FOR v_item IN
    SELECT d.value
      FROM jsonb_array_elements(p_divergencias) AS d(value)
     WHERE d.value ->> 'tipoDivergencia' = 'ID de Endereço Inconsistente'
     ORDER BY d.value ->> 'id'
  LOOP
    SELECT r.*
      INTO v_new_divergencia
      FROM jsonb_populate_record(NULL::public.divergencias, v_item) AS r;
    v_slot_id := NULLIF(btrim(v_item ->> 'slot_id'), '');
    IF v_slot_id IS NULL THEN
      RAISE EXCEPTION 'INCONSISTENT_ID_DIVERGENCE_SLOT_REQUIRED' USING ERRCODE = '22023';
    END IF;

    SELECT s.*
      INTO v_slot
      FROM public.slots AS s
     WHERE s.id = v_slot_id
       AND public.stock_address_lock_key(s.estoque, s.modulo, COALESCE(s.posicao, '')) =
           public.stock_address_lock_key(
             v_new_divergencia.estoque, v_new_divergencia.modulo, COALESCE(v_new_divergencia.posicao, '')
           )
     FOR SHARE;

    IF NOT FOUND OR NOT public.shared_draft_slot_identity_is_inconsistent(v_slot) THEN
      RAISE EXCEPTION 'INCONSISTENT_ID_DIVERGENCE_NOT_CONFIRMED: %', v_new_divergencia.id USING ERRCODE = '40001';
    END IF;
  END LOOP;

  -- Insert-only semantics: exact retries are idempotent; an existing ID with
  -- different content is a conflict and is never overwritten.
  FOR v_item IN
    SELECT d.value
      FROM jsonb_array_elements(p_divergencias) AS d(value)
     ORDER BY d.value ->> 'id'
  LOOP
    SELECT r.*
      INTO v_new_divergencia
      FROM jsonb_populate_record(NULL::public.divergencias, v_item) AS r;

    INSERT INTO public.divergencias
    SELECT (v_new_divergencia).*
    ON CONFLICT (id) DO NOTHING;
    GET DIAGNOSTICS v_row_inserted = ROW_COUNT;

    IF v_row_inserted = 1 THEN
      v_inserted := v_inserted + 1;
    ELSE
      SELECT d.*
        INTO v_existing_divergencia
        FROM public.divergencias AS d
       WHERE d.id = v_new_divergencia.id
       FOR UPDATE;

      IF NOT FOUND OR to_jsonb(v_existing_divergencia) IS DISTINCT FROM to_jsonb(v_new_divergencia) THEN
        RAISE EXCEPTION 'DIVERGENCE_ID_CONFLICT: %', v_new_divergencia.id USING ERRCODE = '23505';
      END IF;
      v_already_present := v_already_present + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'divergencias_written', v_inserted,
    'already_present', v_already_present
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.record_stock_conflict_divergences_atomic(text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_stock_conflict_divergences_atomic(text, jsonb)
  TO authenticated;

COMMENT ON FUNCTION public.record_stock_conflict_divergences_atomic(text, jsonb) IS
  'Registra somente divergencias novas e abertas de fluxos de estoque, validando a permissao por tipo de operacao no servidor. Nunca altera slots ou history; retries identicos sao idempotentes e IDs com conteudo diferente sao rejeitados.';

COMMIT;
