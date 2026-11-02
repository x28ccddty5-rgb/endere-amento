-- Etapa 01 / autorização das rotinas de correção de estoque e divergências.
-- Preparada para aplicação somente no clone local; NÃO aplicar no Supabase Cloud
-- até o fechamento das seis frentes da auditoria e a publicação única final.
-- Esta etapa não revoga privilégios nem altera políticas RLS; cria a RPC dedicada de zeramento.

BEGIN;

DO $preflight$
BEGIN
  IF to_regprocedure('public.has_app_permission(text)') IS NULL THEN
    RAISE EXCEPTION 'PERMISSION_FOUNDATION_MISSING';
  END IF;
  IF to_regprocedure('public.reconcile_physical_address_atomic(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'RECONCILE_PHYSICAL_ADDRESS_ATOMIC_MISSING';
  END IF;
  IF to_regprocedure('public.reconcile_physical_address_atomic_with_deletes(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text[])') IS NULL THEN
    RAISE EXCEPTION 'RECONCILE_PHYSICAL_ADDRESS_ATOMIC_WITH_DELETES_MISSING';
  END IF;
  IF to_regprocedure('public.resolve_stock_divergence_atomic(jsonb,jsonb,jsonb,jsonb,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'RESOLVE_STOCK_DIVERGENCE_ATOMIC_MISSING';
  END IF;
  IF to_regprocedure('public.stock_address_lock_key(text,text,text)') IS NULL
     OR to_regprocedure('public.lock_stock_address_key(text)') IS NULL THEN
    RAISE EXCEPTION 'STOCK_ADDRESS_LOCK_DEPENDENCY_MISSING';
  END IF;
  IF to_regclass('public.physical_corrections') IS NULL
     OR to_regclass('public.warehouse_layout_positions') IS NULL
     OR to_regclass('public.warehouse_layout') IS NULL THEN
    RAISE EXCEPTION 'PHYSICAL_ZERO_TABLE_DEPENDENCY_MISSING';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.permission_catalog
    WHERE permission_key = 'stock.physical_correction' AND is_active IS TRUE
  ) OR NOT EXISTS (
    SELECT 1 FROM public.permission_catalog
    WHERE permission_key = 'divergences.resolve' AND is_active IS TRUE
  ) THEN
    RAISE EXCEPTION 'REQUIRED_PERMISSION_CATALOG_KEYS_MISSING_OR_INACTIVE';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.reconcile_physical_address_atomic(p_correction_id uuid, p_address jsonb, p_expected_slots jsonb, p_slots jsonb, p_expected_divergencias jsonb, p_divergencias jsonb, p_history jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_estoque text;
  v_modulo text;
  v_posicao text;
  v_base_id text;
  v_actor_name text;
  v_fingerprint text;
  v_existing_fingerprint text;
  v_existing_actor uuid;
  v_now timestamp without time zone;
  v_local_date text;
  v_local_time text;
  v_inserted integer := 0;
  v_position_active boolean;
  v_module_active boolean;

  v_current_slot public.slots%ROWTYPE;
  v_new_slot public.slots%ROWTYPE;
  v_current_divergencia public.divergencias%ROWTYPE;
  v_expected jsonb;
  v_payload jsonb;
  v_history_row jsonb;
  v_divergence_row jsonb;
  v_id text;
  v_sku text;
  v_restricao text;
  v_saldo_anterior bigint;
  v_saldo_final bigint;
  v_quantidade bigint;
  v_diferenca bigint;
  v_tipo text;
  v_current_identity_count bigint;
  v_current_saldo bigint;
  v_recovery_slot_count bigint;
  v_recovery_min bigint;
  v_recovery_max bigint;
  v_identity_found boolean;
  v_final_slot_count bigint;
  v_final_slot_saldo bigint;
  v_current_count bigint;
  v_rows_written integer := 0;
  v_history_written integer := 0;
  v_divergencias_written integer := 0;
  v_conflict_message text;
  v_sqlstate text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501';
  END IF;

  IF public.has_app_permission('stock.physical_correction') IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'PERMISSION_DENIED:stock.physical_correction' USING ERRCODE = '42501';
  END IF;

  SELECT p.name
    INTO v_actor_name
    FROM public.profiles AS p
   WHERE p.id = auth.uid();

  IF COALESCE(btrim(v_actor_name), '') = '' THEN
    RAISE EXCEPTION 'OPERATOR_PROFILE_MISSING' USING ERRCODE = '42501';
  END IF;

  IF p_correction_id IS NULL
     OR jsonb_typeof(p_address) IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_expected_slots) IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_slots) IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_expected_divergencias) IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_divergencias) IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_history) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'INVALID_TRANSACTION_PAYLOAD' USING ERRCODE = '22023';
  END IF;

  IF jsonb_array_length(p_expected_divergencias) > 0
     AND public.has_app_permission('divergences.resolve') IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'PERMISSION_DENIED:divergences.resolve' USING ERRCODE = '42501';
  END IF;

  v_estoque := upper(btrim(COALESCE(p_address ->> 'estoque', '')));
  IF left(v_estoque, 1) = 'E' THEN v_estoque := substring(v_estoque FROM 2); END IF;
  v_modulo := upper(btrim(COALESCE(p_address ->> 'modulo', '')));
  v_modulo := regexp_replace(v_modulo, '^[MR]', '');
  IF v_modulo ~ '^\d+$' THEN
    v_modulo := (v_modulo::numeric)::text;
  END IF;
  v_posicao := upper(btrim(COALESCE(p_address ->> 'posicao', '')));

  IF v_estoque NOT IN ('2', '3')
     OR v_modulo = ''
     OR v_posicao IS NULL
     OR v_posicao = '' THEN
    RAISE EXCEPTION 'INVALID_PHYSICAL_ADDRESS' USING ERRCODE = '22023';
  END IF;

  v_base_id := v_estoque || '-' || v_modulo || '-' || v_posicao;

  /* If no slot row exists yet, only initialize a confirmed-active physical position. */
  IF jsonb_array_length(p_expected_slots) = 0 AND NOT EXISTS (
    SELECT 1
      FROM public.warehouse_layout_positions AS p
     WHERE p.estoque = v_estoque
       AND p.modulo = v_modulo
       AND upper(btrim(p.posicao)) = v_posicao
       AND p.ativo IS TRUE
  ) THEN
    RAISE EXCEPTION 'PHYSICAL_POSITION_NOT_ACTIVE_OR_UNKNOWN' USING ERRCODE = '22023';
  END IF;

  v_now := clock_timestamp() AT TIME ZONE 'America/Sao_Paulo';
  v_local_date := to_char(v_now, 'YYYY-MM-DD');
  v_local_time := to_char(v_now, 'HH24:MI:SS');

  IF jsonb_array_length(p_slots) < 1
     OR jsonb_array_length(p_history) < 1
     OR jsonb_array_length(p_expected_slots) > 1000
     OR jsonb_array_length(p_slots) > 1000
     OR jsonb_array_length(p_expected_divergencias) > 1000
     OR jsonb_array_length(p_divergencias) > 1000
     OR jsonb_array_length(p_history) > 1000
     OR jsonb_array_length(p_expected_divergencias) <> jsonb_array_length(p_divergencias) THEN
    RAISE EXCEPTION 'INVALID_TRANSACTION_PAYLOAD_SIZE' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_expected_slots) AS x(value)
    WHERE jsonb_typeof(x.value) IS DISTINCT FROM 'object'
       OR COALESCE(x.value ->> 'id', '') = ''
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_expected_slots) AS x(value)
    GROUP BY x.value ->> 'id' HAVING count(*) > 1
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_slots) AS x(value)
    WHERE jsonb_typeof(x.value) IS DISTINCT FROM 'object'
       OR COALESCE(x.value ->> 'id', '') = ''
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_slots) AS x(value)
    GROUP BY x.value ->> 'id' HAVING count(*) > 1
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_expected_divergencias) AS x(value)
    WHERE jsonb_typeof(x.value) IS DISTINCT FROM 'object'
       OR COALESCE(x.value ->> 'id', '') = ''
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_expected_divergencias) AS x(value)
    GROUP BY x.value ->> 'id' HAVING count(*) > 1
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_divergencias) AS x(value)
    WHERE jsonb_typeof(x.value) IS DISTINCT FROM 'object'
       OR COALESCE(x.value ->> 'id', '') = ''
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_divergencias) AS x(value)
    GROUP BY x.value ->> 'id' HAVING count(*) > 1
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_history) AS x(value)
    WHERE jsonb_typeof(x.value) IS DISTINCT FROM 'object'
       OR COALESCE(x.value ->> 'id', '') = ''
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_history) AS x(value)
    GROUP BY x.value ->> 'id' HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'DUPLICATE_OR_EMPTY_RECORD_ID' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_expected_slots) AS x(value)
    WHERE COALESCE(x.value ->> 'estoque', '') <> v_estoque
       OR COALESCE(x.value ->> 'modulo', '') <> v_modulo
       OR COALESCE(x.value ->> 'posicao', '') <> v_posicao
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_slots) AS x(value)
    WHERE COALESCE(x.value ->> 'estoque', '') <> v_estoque
       OR COALESCE(x.value ->> 'modulo', '') <> v_modulo
       OR COALESCE(x.value ->> 'posicao', '') <> v_posicao
  ) THEN
    RAISE EXCEPTION 'ADDRESS_MISMATCH' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_expected_divergencias) AS x(value)
    WHERE COALESCE(x.value ->> 'estoque', '') <> v_estoque
       OR COALESCE(x.value ->> 'modulo', '') <> v_modulo
       OR COALESCE(x.value ->> 'posicao', '') <> v_posicao
       OR lower(trim(COALESCE(x.value ->> 'status', ''))) <> 'aberta'
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_divergencias) AS x(value)
    WHERE COALESCE(x.value ->> 'estoque', '') <> v_estoque
       OR COALESCE(x.value ->> 'modulo', '') <> v_modulo
       OR COALESCE(x.value ->> 'posicao', '') <> v_posicao
       OR lower(trim(COALESCE(x.value ->> 'status', ''))) <> 'corrigida'
       OR (x.value ->> 'correcaoId') IS DISTINCT FROM p_correction_id::text
  ) THEN
    RAISE EXCEPTION 'DIVERGENCIA_PAYLOAD_ADDRESS_OR_STATUS_INVALID' USING ERRCODE = '22023';
  END IF;

  /* Sort arrays by ID so a retry with the same payload in a different row order
     can still be recognized as the same completed request. */
  v_fingerprint := md5(jsonb_build_object(
    'address', jsonb_build_array(v_estoque, v_modulo, v_posicao),
    'expected_slots', (SELECT COALESCE(jsonb_agg(x.value ORDER BY x.value ->> 'id'), '[]'::jsonb)
                       FROM jsonb_array_elements(p_expected_slots) AS x(value)),
    'slots', (SELECT COALESCE(jsonb_agg(x.value ORDER BY x.value ->> 'id'), '[]'::jsonb)
              FROM jsonb_array_elements(p_slots) AS x(value)),
    'expected_divergencias', (SELECT COALESCE(jsonb_agg(x.value ORDER BY x.value ->> 'id'), '[]'::jsonb)
                              FROM jsonb_array_elements(p_expected_divergencias) AS x(value)),
    'divergencias', (SELECT COALESCE(jsonb_agg(x.value ORDER BY x.value ->> 'id'), '[]'::jsonb)
                     FROM jsonb_array_elements(p_divergencias) AS x(value)),
    'history', (SELECT COALESCE(jsonb_agg(x.value ORDER BY x.value ->> 'id'), '[]'::jsonb)
                FROM jsonb_array_elements(p_history) AS x(value))
  )::text);

  BEGIN
  INSERT INTO public.physical_corrections (
    id, estoque, modulo, posicao, request_fingerprint, created_by, created_by_name
  ) VALUES (
    p_correction_id, v_estoque, v_modulo, v_posicao, v_fingerprint, auth.uid(), v_actor_name
  ) ON CONFLICT (id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF v_inserted = 0 THEN
    SELECT c.request_fingerprint, c.created_by
      INTO v_existing_fingerprint, v_existing_actor
      FROM public.physical_corrections AS c
     WHERE c.id = p_correction_id;

    IF FOUND
       AND v_existing_fingerprint = v_fingerprint
       AND v_existing_actor = auth.uid() THEN
      RETURN jsonb_build_object(
        'success', true,
        'alreadyApplied', true,
        'correctionId', p_correction_id,
        'message', 'Esta corre├º├úo j├í foi confirmada anteriormente.'
      );
    END IF;

    RETURN jsonb_build_object(
      'success', false,
      'conflict', true,
      'code', 'CORRECTION_ID_REUSED',
      'message', 'O identificador da corre├º├úo j├í foi usado com outro conte├║do ou por outra sess├úo.',
      'correctionId', p_correction_id
    );
  END IF;

  /* All participating write RPCs must take this same address lock. This does not
     protect against legacy direct DML; deployment must migrate every writer and
     then revoke direct DML permissions before relying on the protocol. */
  PERFORM public.lock_stock_address_key(
    public.stock_address_lock_key(v_estoque, v_modulo, v_posicao)
  );

  /* Recheck the layout position after taking the shared address lock; this closes
     the race with position deactivation/deletion while the operator was counting. */
  SELECT p.ativo INTO v_position_active
    FROM public.warehouse_layout_positions AS p
   WHERE p.estoque = v_estoque
     AND p.modulo = v_modulo
     AND upper(btrim(p.posicao)) = v_posicao
   FOR SHARE;
  IF NOT FOUND OR v_position_active IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'PHYSICAL_POSITION_NOT_ACTIVE_OR_UNKNOWN' USING ERRCODE = '22023';
  END IF;

  /* Match the generic writer: inactive modules fail closed even if a position
     was left active by older UI state. */
  SELECT l.ativo INTO v_module_active
    FROM public.warehouse_layout AS l
   WHERE l.estoque = v_estoque
     AND l.modulo = v_modulo
   FOR SHARE;
  IF FOUND AND v_module_active IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'PHYSICAL_MODULE_INACTIVE: %-%', v_estoque, v_modulo USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_current_count
    FROM public.slots AS s
   WHERE s.estoque = v_estoque AND s.modulo = v_modulo AND s.posicao = v_posicao;
  IF v_current_count <> jsonb_array_length(p_expected_slots) THEN
    RAISE EXCEPTION 'SLOT_SET_CONFLICT: conjunto do endere├ºo foi alterado.' USING ERRCODE = '40001';
  END IF;

  FOR v_current_slot IN
    SELECT s.* FROM public.slots AS s
     WHERE s.estoque = v_estoque AND s.modulo = v_modulo AND s.posicao = v_posicao
     ORDER BY s.id FOR UPDATE
  LOOP
    SELECT x.value INTO v_expected
      FROM jsonb_array_elements(p_expected_slots) AS x(value)
     WHERE x.value ->> 'id' = v_current_slot.id;
    IF NOT FOUND OR to_jsonb(v_current_slot) IS DISTINCT FROM v_expected THEN
      RAISE EXCEPTION 'SLOT_CONFLICT: estado alterado (%).', v_current_slot.id USING ERRCODE = '40001';
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_expected_slots) AS e(value)
    WHERE NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_slots) AS u(value)
      WHERE u.value ->> 'id' = e.value ->> 'id'
    )
  ) THEN
    RAISE EXCEPTION 'SLOT_PAYLOAD_ID_MISMATCH' USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_current_count
    FROM public.divergencias AS d
   WHERE d.estoque = v_estoque AND d.modulo = v_modulo AND d.posicao = v_posicao
     AND lower(trim(COALESCE(d.status, ''))) = 'aberta';
  IF v_current_count <> jsonb_array_length(p_expected_divergencias) THEN
    RAISE EXCEPTION 'DIVERGENCIA_SET_CONFLICT: diverg├¬ncias abertas foram alteradas.' USING ERRCODE = '40001';
  END IF;

  FOR v_current_divergencia IN
    SELECT d.* FROM public.divergencias AS d
     WHERE d.estoque = v_estoque AND d.modulo = v_modulo AND d.posicao = v_posicao
       AND lower(trim(COALESCE(d.status, ''))) = 'aberta'
     ORDER BY d.id FOR UPDATE
  LOOP
    SELECT x.value INTO v_expected
      FROM jsonb_array_elements(p_expected_divergencias) AS x(value)
     WHERE x.value ->> 'id' = v_current_divergencia.id;
    IF NOT FOUND
       OR (to_jsonb(v_current_divergencia) - 'status') IS DISTINCT FROM (v_expected - 'status') THEN
      RAISE EXCEPTION 'DIVERGENCIA_CONFLICT: registro alterado (%).', v_current_divergencia.id USING ERRCODE = '40001';
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_divergencias) AS u(value)
    WHERE NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_expected_divergencias) AS e(value)
      WHERE e.value ->> 'id' = u.value ->> 'id'
        AND (u.value - ARRAY['status','dataCorrecao','corrigidoPor','correcaoId'])
            IS NOT DISTINCT FROM
            (e.value - ARRAY['status','dataCorrecao','corrigidoPor','correcaoId'])
    )
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_expected_divergencias) AS e(value)
    WHERE NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_divergencias) AS u(value)
      WHERE u.value ->> 'id' = e.value ->> 'id'
    )
  ) THEN
    RAISE EXCEPTION 'DIVERGENCIA_PAYLOAD_ID_MISMATCH' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_history) AS h(value)
    WHERE COALESCE(h.value ->> 'estoque', '') <> v_estoque
       OR COALESCE(h.value ->> 'modulo', '') <> v_modulo
       OR COALESCE(h.value ->> 'posicao', '') <> v_posicao
       OR COALESCE(h.value ->> 'naturezaTransacao', '') <> 'correcao_fisica'
       OR (h.value ->> 'correcaoId') IS DISTINCT FROM p_correction_id::text
       OR COALESCE(h.value ->> 'referencia', '') = ''
       OR upper(trim(COALESCE(h.value ->> 'referencia', ''))) = 'VAZIO'
       OR lower(coalesce(nullif(trim(h.value ->> 'restricao'), ''), 'nenhuma')) NOT IN ('nenhuma','teste','autorizacao','outra')
       OR COALESCE(h.value ->> 'quantidade', '') !~ '^\d+$'
       OR COALESCE(h.value ->> 'saldoAnterior', '') !~ '^\d+$'
       OR COALESCE(h.value ->> 'saldoFinal', '') !~ '^\d+$'
       OR COALESCE(h.value ->> 'quemLancou', '') = ''
       OR COALESCE(h.value ->> 'responsavel', '') = ''
  ) THEN
    RAISE EXCEPTION 'INVALID_HISTORY_PAYLOAD' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_history) AS h(value)
    GROUP BY upper(trim(h.value ->> 'referencia')),
             lower(coalesce(nullif(trim(h.value ->> 'restricao'), ''), 'nenhuma'))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'DUPLICATE_HISTORY_IDENTITY' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.slots AS s
    WHERE s.estoque = v_estoque AND s.modulo = v_modulo AND s.posicao = v_posicao
      AND upper(trim(COALESCE(s.referencia, ''))) = 'VAZIO'
  ) THEN
    RAISE EXCEPTION 'INVALID_SLOT_SENTINEL' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.slots AS s
    WHERE s.estoque = v_estoque AND s.modulo = v_modulo AND s.posicao = v_posicao
      AND (
        coalesce(s.saldo, 0) < 0
        OR (nullif(upper(trim(COALESCE(s.referencia, ''))), '') IS NOT NULL AND s.saldo IS NULL)
        OR (nullif(upper(trim(COALESCE(s.referencia, ''))), '') IS NULL AND coalesce(s.saldo, 0) > 0)
      )
  ) THEN
    RAISE EXCEPTION 'INVALID_CURRENT_SLOT_BALANCE' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.slots AS s
    WHERE s.estoque = v_estoque AND s.modulo = v_modulo AND s.posicao = v_posicao
      AND nullif(upper(trim(COALESCE(s.referencia, ''))), '') IS NOT NULL
    GROUP BY upper(trim(s.referencia)), lower(coalesce(nullif(trim(s.restricao), ''), 'nenhuma'))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'DUPLICATE_LOGICAL_IDENTITY_IN_SLOTS' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT d.slot_id
      FROM public.divergencias AS d
      JOIN public.slots AS s ON s.id = d.slot_id
     WHERE d.estoque = v_estoque AND d.modulo = v_modulo AND d.posicao = v_posicao
       AND lower(trim(COALESCE(d.status, ''))) = 'aberta'
       AND nullif(upper(trim(COALESCE(d."refAtual", ''))), '') IS NOT NULL
       AND upper(trim(d."refAtual")) <> 'VAZIO'
       AND s.estoque = v_estoque AND s.modulo = v_modulo AND s.posicao = v_posicao
       AND nullif(upper(trim(COALESCE(s.referencia, ''))), '') IS NULL
       AND coalesce(s.saldo, 0) = 0
     GROUP BY d.slot_id
    HAVING count(DISTINCT jsonb_build_array(
      upper(trim(d."refAtual")),
      lower(coalesce(nullif(trim(d.restricao), ''), 'nenhuma')),
      d."saldoAntes"
    )) > 1
  ) THEN
    RAISE EXCEPTION 'AMBIGUOUS_RECOVERED_SLOT_ORIGIN' USING ERRCODE = '22023';
  END IF;

  /* Derive every previous balance from the locked database snapshot. */
  FOR v_history_row IN SELECT h.value FROM jsonb_array_elements(p_history) AS h(value)
  LOOP
    v_sku := upper(trim(v_history_row ->> 'referencia'));
    v_restricao := lower(coalesce(nullif(trim(v_history_row ->> 'restricao'), ''), 'nenhuma'));
    v_saldo_anterior := (v_history_row ->> 'saldoAnterior')::bigint;
    v_saldo_final := (v_history_row ->> 'saldoFinal')::bigint;
    v_quantidade := (v_history_row ->> 'quantidade')::bigint;
    v_diferenca := v_saldo_final - v_saldo_anterior;
    v_tipo := coalesce(v_history_row ->> 'tipo', '');

    IF v_saldo_final < 0 OR v_saldo_anterior < 0
       OR v_saldo_final > 2147483647 OR v_saldo_anterior > 2147483647
       OR v_quantidade > 2147483647 THEN
      RAISE EXCEPTION 'INVALID_STOCK_QUANTITY' USING ERRCODE = '22023';
    END IF;

    IF (v_diferenca > 0 AND (v_tipo <> 'Entrada' OR v_quantidade <> v_diferenca))
       OR (v_diferenca < 0 AND (v_tipo <> 'Sa├¡da' OR v_quantidade <> -v_diferenca))
       OR (v_diferenca = 0 AND (v_tipo <> '' OR v_quantidade <> 0)) THEN
      RAISE EXCEPTION 'HISTORY_DELTA_MISMATCH: SKU % / restri├º├úo %.', v_sku, v_restricao USING ERRCODE = '22023';
    END IF;

    SELECT count(*), max(coalesce(s.saldo, 0))
      INTO v_current_identity_count, v_current_saldo
      FROM public.slots AS s
     WHERE s.estoque = v_estoque AND s.modulo = v_modulo AND s.posicao = v_posicao
       AND upper(trim(COALESCE(s.referencia, ''))) = v_sku
       AND lower(coalesce(nullif(trim(s.restricao), ''), 'nenhuma')) = v_restricao
       AND v_sku <> 'VAZIO';

    v_identity_found := false;
    IF v_current_identity_count > 1 THEN
      RAISE EXCEPTION 'DUPLICATE_LOGICAL_IDENTITY_IN_SLOTS: SKU %.', v_sku USING ERRCODE = '22023';
    ELSIF v_current_identity_count = 1 THEN
      IF EXISTS (
        SELECT 1 FROM public.slots AS s
        JOIN public.divergencias AS d ON d.slot_id = s.id
        WHERE s.estoque = v_estoque AND s.modulo = v_modulo AND s.posicao = v_posicao
          AND s.estoque = d.estoque AND s.modulo = d.modulo AND s.posicao = d.posicao
          AND upper(trim(COALESCE(s.referencia, ''))) = v_sku
          AND lower(coalesce(nullif(trim(s.restricao), ''), 'nenhuma')) = v_restricao
          AND upper(trim(COALESCE(d."refAtual", ''))) = v_sku
          AND lower(coalesce(nullif(trim(d.restricao), ''), 'nenhuma')) = v_restricao
          AND lower(trim(COALESCE(d.status, ''))) = 'aberta'
          AND d."saldoAntes" IS NOT NULL
          AND d."saldoAntes" <> coalesce(s.saldo, 0)
      ) THEN
        RAISE EXCEPTION 'STALE_DIVERGENCE_SOURCE_BALANCE: SKU %.', v_sku USING ERRCODE = '40001';
      END IF;
      v_identity_found := true;
      v_current_saldo := coalesce(v_current_saldo, 0);
    ELSE
      SELECT count(DISTINCT d.slot_id), min(d."saldoAntes"), max(d."saldoAntes")
        INTO v_recovery_slot_count, v_recovery_min, v_recovery_max
        FROM public.divergencias AS d
        JOIN public.slots AS s ON s.id = d.slot_id
       WHERE d.estoque = v_estoque AND d.modulo = v_modulo AND d.posicao = v_posicao
         AND lower(trim(COALESCE(d.status, ''))) = 'aberta'
         AND upper(trim(COALESCE(d."refAtual", ''))) = v_sku
         AND lower(coalesce(nullif(trim(d.restricao), ''), 'nenhuma')) = v_restricao
         AND s.estoque = v_estoque AND s.modulo = v_modulo AND s.posicao = v_posicao
         AND nullif(upper(trim(COALESCE(s.referencia, ''))), '') IS NULL
         AND coalesce(s.saldo, 0) = 0;

      IF v_recovery_slot_count > 1 THEN
        RAISE EXCEPTION 'AMBIGUOUS_RECOVERED_BALANCE: SKU %.', v_sku USING ERRCODE = '22023';
      ELSIF v_recovery_slot_count = 1 THEN
        IF v_recovery_min IS NULL OR v_recovery_min < 0 OR v_recovery_min <> v_recovery_max THEN
          RAISE EXCEPTION 'INVALID_RECOVERED_BALANCE: SKU %.', v_sku USING ERRCODE = '22023';
        END IF;
        v_current_saldo := v_recovery_min;
        v_identity_found := true;
      ELSE
        IF EXISTS (
          SELECT 1 FROM public.divergencias AS d
          LEFT JOIN public.slots AS s ON s.id = d.slot_id
          WHERE d.estoque = v_estoque AND d.modulo = v_modulo AND d.posicao = v_posicao
            AND lower(trim(COALESCE(d.status, ''))) = 'aberta'
            AND upper(trim(COALESCE(d."refAtual", ''))) = v_sku
            AND lower(coalesce(nullif(trim(d.restricao), ''), 'nenhuma')) = v_restricao
            AND (d.slot_id IS NULL OR s.id IS NULL OR s.estoque <> v_estoque
                 OR s.modulo <> v_modulo OR s.posicao <> v_posicao
                 OR nullif(upper(trim(COALESCE(s.referencia, ''))), '') IS NOT NULL
                 OR coalesce(s.saldo, 0) <> 0)
        ) THEN
          RAISE EXCEPTION 'UNRECOVERABLE_PREVIOUS_BALANCE: SKU %.', v_sku USING ERRCODE = '40001';
        END IF;
        v_current_saldo := 0;
      END IF;
    END IF;

    IF v_saldo_anterior <> v_current_saldo THEN
      RAISE EXCEPTION 'PREVIOUS_BALANCE_MISMATCH: SKU % expected %, got %.', v_sku, v_current_saldo, v_saldo_anterior USING ERRCODE = '40001';
    END IF;

    IF NOT v_identity_found AND v_saldo_final > 0 AND NOT EXISTS (
      SELECT 1 FROM public.products AS p WHERE upper(trim(p.referencia)) = v_sku
    ) THEN
      RAISE EXCEPTION 'UNKNOWN_PHYSICAL_SKU: %.', v_sku USING ERRCODE = '22023';
    END IF;
  END LOOP;

  /* A divergence whose original SKU cannot be traced to a clean slot must not
     disappear merely because the caller omitted that identity from the history payload. */
  IF EXISTS (
    SELECT 1
      FROM public.divergencias AS d
      LEFT JOIN public.slots AS s ON s.id = d.slot_id
     WHERE d.estoque = v_estoque AND d.modulo = v_modulo AND d.posicao = v_posicao
       AND lower(trim(COALESCE(d.status, ''))) = 'aberta'
       AND nullif(upper(trim(COALESCE(d."refAtual", ''))), '') IS NOT NULL
       AND upper(trim(d."refAtual")) <> 'VAZIO'
       AND (d.slot_id IS NULL OR s.id IS NULL
            OR s.estoque <> v_estoque OR s.modulo <> v_modulo OR s.posicao <> v_posicao
            OR (nullif(upper(trim(COALESCE(s.referencia, ''))), '') IS NOT NULL
                AND upper(trim(s.referencia)) <> upper(trim(d."refAtual"))))
       AND NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(p_history) AS h(value)
         WHERE upper(trim(h.value ->> 'referencia')) = upper(trim(d."refAtual"))
           AND lower(coalesce(nullif(trim(h.value ->> 'restricao'), ''), 'nenhuma'))
               = lower(coalesce(nullif(trim(d.restricao), ''), 'nenhuma'))
       )
  ) THEN
    RAISE EXCEPTION 'MISSING_DIVERGENCE_SOURCE_IDENTITY_IN_HISTORY' USING ERRCODE = '22023';
  END IF;

  /* Every current or recoverable old identity must appear in history exactly once. */
  IF EXISTS (
    SELECT 1
      FROM public.slots AS s
     WHERE s.estoque = v_estoque AND s.modulo = v_modulo AND s.posicao = v_posicao
       AND nullif(upper(trim(COALESCE(s.referencia, ''))), '') IS NOT NULL
       AND upper(trim(s.referencia)) <> 'VAZIO'
       AND NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(p_history) AS h(value)
         WHERE upper(trim(h.value ->> 'referencia')) = upper(trim(s.referencia))
           AND lower(coalesce(nullif(trim(h.value ->> 'restricao'), ''), 'nenhuma'))
               = lower(coalesce(nullif(trim(s.restricao), ''), 'nenhuma'))
       )
  ) THEN
    RAISE EXCEPTION 'MISSING_LOGICAL_IDENTITY_IN_HISTORY' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.divergencias AS d
      JOIN public.slots AS s ON s.id = d.slot_id
     WHERE d.estoque = v_estoque AND d.modulo = v_modulo AND d.posicao = v_posicao
       AND lower(trim(COALESCE(d.status, ''))) = 'aberta'
       AND nullif(upper(trim(COALESCE(d."refAtual", ''))), '') IS NOT NULL
       AND upper(trim(d."refAtual")) <> 'VAZIO'
       AND s.estoque = v_estoque AND s.modulo = v_modulo AND s.posicao = v_posicao
       AND nullif(upper(trim(COALESCE(s.referencia, ''))), '') IS NULL
       AND coalesce(s.saldo, 0) = 0
       AND NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(p_history) AS h(value)
         WHERE upper(trim(h.value ->> 'referencia')) = upper(trim(d."refAtual"))
           AND lower(coalesce(nullif(trim(h.value ->> 'restricao'), ''), 'nenhuma'))
               = lower(coalesce(nullif(trim(d.restricao), ''), 'nenhuma'))
       )
  ) THEN
    RAISE EXCEPTION 'MISSING_RECOVERED_IDENTITY_IN_HISTORY' USING ERRCODE = '22023';
  END IF;

  /* Validate all final slot assignments against the physical counts before any write. */
  FOR v_payload IN SELECT x.value FROM jsonb_array_elements(p_slots) AS x(value)
  LOOP
    v_new_slot := jsonb_populate_record(NULL::public.slots, v_payload);
    IF COALESCE(v_new_slot.id, '') = ''
       OR v_new_slot.saldo < 0
       OR (nullif(upper(trim(COALESCE(v_new_slot.referencia, ''))), '') IS NULL AND coalesce(v_new_slot.saldo, 0) <> 0)
       OR upper(trim(COALESCE(v_new_slot.referencia, ''))) = 'VAZIO' THEN
      RAISE EXCEPTION 'INVALID_SLOT_ASSIGNMENT: %.', COALESCE(v_new_slot.id, '(sem id)') USING ERRCODE = '22023';
    END IF;

    /*
      The base ID identifies the physical address and may represent its current
      logical item. An auxiliary ID permanently encodes one SKU + restriction
      identity. Never accept an active auxiliary row whose payload contradicts
      that identity, even if the row existed before this architecture.
      Empty legacy auxiliary rows may remain for compatibility, but are not
      reassigned by the client to a different identity.
    */
    IF v_new_slot.estoque IN ('2', '3')
       AND position('::ITEM::' IN v_new_slot.id) > 0
       AND nullif(upper(trim(COALESCE(v_new_slot.referencia, ''))), '') IS NOT NULL
       AND v_new_slot.id <> v_new_slot.estoque || '-' || v_new_slot.modulo || '-' || v_new_slot.posicao ||
         '::ITEM::' || upper(trim(v_new_slot.referencia)) || '::' ||
         lower(coalesce(nullif(trim(v_new_slot.restricao), ''), 'nenhuma')) THEN
      RAISE EXCEPTION 'AUXILIARY_SLOT_ID_IDENTITY_MISMATCH: % does not match SKU/restriction payload.', v_new_slot.id USING ERRCODE = '22023';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.slots AS s WHERE s.id = v_new_slot.id)
       AND NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(p_expected_slots) AS e(value)
         WHERE e.value ->> 'id' = v_new_slot.id
       ) THEN
      IF (v_estoque = '1' AND left(v_new_slot.id, length(v_estoque || '-' || v_modulo || '-')) <> v_estoque || '-' || v_modulo || '-')
         OR (v_estoque IN ('2', '3') AND v_new_slot.id <> v_base_id
             AND (nullif(upper(trim(COALESCE(v_new_slot.referencia, ''))), '') IS NULL
                  OR v_new_slot.id <> v_base_id || '::ITEM::' || upper(trim(v_new_slot.referencia)) || '::' ||
                    lower(coalesce(nullif(trim(v_new_slot.restricao), ''), 'nenhuma')))) THEN
        RAISE EXCEPTION 'INVALID_NEW_SLOT_ID: %.', v_new_slot.id USING ERRCODE = '22023';
      END IF;
    ELSIF NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_expected_slots) AS e(value)
      WHERE e.value ->> 'id' = v_new_slot.id
    ) THEN
      RAISE EXCEPTION 'SLOT_ID_EXISTS_OUTSIDE_ADDRESS: %.', v_new_slot.id USING ERRCODE = '40001';
    END IF;

    IF nullif(upper(trim(COALESCE(v_new_slot.referencia, ''))), '') IS NOT NULL THEN
      SELECT count(*), max(coalesce((h.value ->> 'saldoFinal')::integer, 0))
        INTO v_final_slot_count, v_final_slot_saldo
        FROM jsonb_array_elements(p_history) AS h(value)
       WHERE upper(trim(h.value ->> 'referencia')) = upper(trim(v_new_slot.referencia))
         AND lower(coalesce(nullif(trim(h.value ->> 'restricao'), ''), 'nenhuma'))
             = lower(coalesce(nullif(trim(v_new_slot.restricao), ''), 'nenhuma'));
      IF v_final_slot_count <> 1 OR v_final_slot_saldo <> coalesce(v_new_slot.saldo, 0) THEN
        RAISE EXCEPTION 'FINAL_SLOT_DOES_NOT_MATCH_COUNT: %.', v_new_slot.id USING ERRCODE = '22023';
      END IF;
    END IF;
  END LOOP;

  FOR v_history_row IN SELECT h.value FROM jsonb_array_elements(p_history) AS h(value)
  LOOP
    v_sku := upper(trim(v_history_row ->> 'referencia'));
    v_restricao := lower(coalesce(nullif(trim(v_history_row ->> 'restricao'), ''), 'nenhuma'));
    v_saldo_final := (v_history_row ->> 'saldoFinal')::bigint;
    SELECT count(*) INTO v_final_slot_count
      FROM jsonb_array_elements(p_slots) AS x(value)
     WHERE upper(trim(COALESCE(x.value ->> 'referencia', ''))) = v_sku
       AND lower(coalesce(nullif(trim(x.value ->> 'restricao'), ''), 'nenhuma')) = v_restricao;
    IF (v_saldo_final > 0 AND v_final_slot_count <> 1)
       OR (v_saldo_final = 0 AND v_final_slot_count <> 0) THEN
      RAISE EXCEPTION 'FINAL_SLOT_COUNT_MISMATCH: SKU %.', v_sku USING ERRCODE = '22023';
    END IF;
  END LOOP;
  EXCEPTION
    WHEN SQLSTATE '40001' THEN
      GET STACKED DIAGNOSTICS v_conflict_message = MESSAGE_TEXT;
      IF left(v_conflict_message, length('SLOT_SET_CONFLICT:')) = 'SLOT_SET_CONFLICT:'
         OR left(v_conflict_message, length('SLOT_CONFLICT:')) = 'SLOT_CONFLICT:'
         OR left(v_conflict_message, length('DIVERGENCIA_SET_CONFLICT:')) = 'DIVERGENCIA_SET_CONFLICT:'
         OR left(v_conflict_message, length('DIVERGENCIA_CONFLICT:')) = 'DIVERGENCIA_CONFLICT:'
      THEN
        RETURN jsonb_build_object(
          'success', false,
          'conflict', true,
          'code', split_part(v_conflict_message, ':', 1),
          'message', v_conflict_message,
          'correctionId', p_correction_id
        );
      END IF;
      RAISE;
  END;

  /* Only now mutate. Any later failure rolls back every table write and the idempotency row. */
  FOR v_payload IN SELECT x.value FROM jsonb_array_elements(p_slots) AS x(value) ORDER BY x.value ->> 'id'
  LOOP
    v_new_slot := jsonb_populate_record(NULL::public.slots, v_payload);

    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_expected_slots) AS e(value) WHERE e.value ->> 'id' = v_new_slot.id) THEN
      UPDATE public.slots AS s
         SET estoque = v_new_slot.estoque,
             modulo = v_new_slot.modulo,
             posicao = v_new_slot.posicao,
             referencia = v_new_slot.referencia,
             descricao = v_new_slot.descricao,
             saldo = v_new_slot.saldo,
             "dataChacote" = v_new_slot."dataChacote",
             "ultimaData" = v_new_slot."ultimaData",
             "ultimaHora" = v_new_slot."ultimaHora",
             "ultimoResponsavel" = v_new_slot."ultimoResponsavel",
             galpao = v_new_slot.galpao,
             restricao = v_new_slot.restricao,
             observacao = v_new_slot.observacao
       WHERE s.id = v_new_slot.id
         AND s.estoque = v_estoque AND s.modulo = v_modulo AND s.posicao = v_posicao;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'SLOT_CONFLICT_DURING_WRITE: %.', v_new_slot.id USING ERRCODE = '40001';
      END IF;
    ELSE
      IF EXISTS (SELECT 1 FROM public.slots AS s WHERE s.id = v_new_slot.id) THEN
        RAISE EXCEPTION 'SLOT_ID_EXISTS_DURING_INSERT: %.', v_new_slot.id USING ERRCODE = '40001';
      END IF;
      INSERT INTO public.slots (
        id, estoque, modulo, posicao, referencia, descricao, saldo,
        "dataChacote", "ultimaData", "ultimaHora", "ultimoResponsavel",
        galpao, restricao, observacao
      ) VALUES (
        v_new_slot.id, v_new_slot.estoque, v_new_slot.modulo, v_new_slot.posicao,
        v_new_slot.referencia, v_new_slot.descricao, v_new_slot.saldo,
        v_new_slot."dataChacote", v_new_slot."ultimaData", v_new_slot."ultimaHora",
        v_new_slot."ultimoResponsavel", v_new_slot.galpao, v_new_slot.restricao,
        v_new_slot.observacao
      );
    END IF;
    v_rows_written := v_rows_written + 1;
  END LOOP;

  INSERT INTO public.history (
    id, "dataLancamento", "quemLancou", data, estoque, modulo, posicao,
    referencia, quantidade, tipo, "dataChacote", hora, responsavel,
    observacao, galpao, slot_id, restricao,
    "naturezaTransacao", "saldoAnterior", "saldoFinal", "correcaoId"
  )
  SELECT
    h.value ->> 'id', v_local_date, v_actor_name, v_local_date,
    h.value ->> 'estoque', h.value ->> 'modulo', h.value ->> 'posicao',
    upper(trim(h.value ->> 'referencia')),
    (h.value ->> 'quantidade')::integer,
    COALESCE(nullif(h.value ->> 'tipo', ''), ''),
    h.value ->> 'dataChacote', v_local_time, v_actor_name,
    h.value ->> 'observacao', h.value ->> 'galpao', h.value ->> 'slot_id',
    lower(coalesce(nullif(trim(h.value ->> 'restricao'), ''), 'nenhuma')),
    'correcao_fisica', (h.value ->> 'saldoAnterior')::integer,
    (h.value ->> 'saldoFinal')::integer, p_correction_id
  FROM jsonb_array_elements(p_history) AS h(value)
  ORDER BY h.value ->> 'id';
  GET DIAGNOSTICS v_history_written = ROW_COUNT;

  UPDATE public.divergencias AS d
     SET status = 'Corrigida',
         "dataCorrecao" = v_local_date,
         "corrigidoPor" = v_actor_name,
         "correcaoId" = p_correction_id
   WHERE d.id IN (
     SELECT x.value ->> 'id' FROM jsonb_array_elements(p_expected_divergencias) AS x(value)
   )
     AND d.estoque = v_estoque AND d.modulo = v_modulo AND d.posicao = v_posicao
     AND lower(trim(COALESCE(d.status, ''))) = 'aberta';
  GET DIAGNOSTICS v_divergencias_written = ROW_COUNT;

  IF v_divergencias_written <> jsonb_array_length(p_expected_divergencias)
     OR v_history_written <> jsonb_array_length(p_history) THEN
    RAISE EXCEPTION 'ATOMIC_WRITE_COUNT_MISMATCH' USING ERRCODE = '40001';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'alreadyApplied', false,
    'correctionId', p_correction_id,
    'slots_written', v_rows_written,
    'history_written', v_history_written,
    'divergencias_written', v_divergencias_written
  );
EXCEPTION
  -- The outer exception block is a subtransaction. Any 40001 raised during
  -- the write phase rolls back every table write and the idempotency row.
  WHEN SQLSTATE '40001' THEN
    GET STACKED DIAGNOSTICS v_conflict_message = MESSAGE_TEXT;
    RETURN jsonb_build_object(
      'success', false,
      'conflict', v_conflict_message <> 'ATOMIC_WRITE_COUNT_MISMATCH',
      'code', split_part(v_conflict_message, ':', 1),
      'message', v_conflict_message,
      'correctionId', p_correction_id
    );
  WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_conflict_message = MESSAGE_TEXT;
    RETURN jsonb_build_object(
      'success', false,
      'conflict', true,
      'code', 'UNIQUE_CONSTRAINT_CONFLICT',
      'message', 'Outro registro ocupou um identificador durante a grava├º├úo. Recarregue o endere├ºo antes de tentar novamente.',
      'correctionId', p_correction_id
    );
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    RETURN jsonb_build_object(
      'success', false,
      'conflict', false,
      'code', 'ATOMIC_WRITE_FAILED',
      'sqlstate', v_sqlstate,
      'message', 'A transa├º├úo foi revertida e a corre├º├úo n├úo foi confirmada. N├úo repita automaticamente; atualize e confira o endere├ºo.',
      'correctionId', p_correction_id
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.reconcile_physical_address_atomic_with_deletes(p_correction_id uuid, p_address jsonb, p_expected_slots jsonb, p_slots jsonb, p_expected_divergencias jsonb, p_divergencias jsonb, p_history jsonb, p_delete_slot_ids text[])
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
  v_id text;
  v_sku text;
  v_restriction text;
  v_history jsonb;
  v_expected_balance bigint;
  v_final_balance bigint;
  v_quantity bigint;
  v_event_count bigint;
  v_result jsonb;
  v_deleted_count integer := 0;
  v_sqlstate text;
  v_message text;
  v_estoque text;
  v_modulo text;
  v_posicao text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF public.has_app_permission('stock.physical_correction') IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'PERMISSION_DENIED:stock.physical_correction' USING ERRCODE = '42501';
  END IF;
  IF p_correction_id IS NULL
     OR jsonb_typeof(p_address) IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_expected_slots) IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_slots) IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_expected_divergencias) IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_divergencias) IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_history) IS DISTINCT FROM 'array'
     OR p_delete_slot_ids IS NULL
     OR cardinality(p_delete_slot_ids) < 1
     OR cardinality(p_delete_slot_ids) > 1000 THEN
    RAISE EXCEPTION 'INVALID_PHYSICAL_SLOT_DELETE_PAYLOAD' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_delete_slot_ids) d(id) WHERE d.id IS NULL OR btrim(d.id)='')
     OR cardinality(p_delete_slot_ids) <> (SELECT count(DISTINCT d.id) FROM unnest(p_delete_slot_ids) d(id)) THEN
    RAISE EXCEPTION 'DUPLICATE_OR_EMPTY_PHYSICAL_DELETE_ID' USING ERRCODE = '22023';
  END IF;

  IF jsonb_array_length(p_expected_divergencias) > 0
     AND public.has_app_permission('divergences.resolve') IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'PERMISSION_DENIED:divergences.resolve' USING ERRCODE = '42501';
  END IF;

  v_estoque := upper(btrim(coalesce(p_address->>'estoque','')));
  IF left(v_estoque,1)='E' THEN v_estoque := substring(v_estoque FROM 2); END IF;
  v_modulo := regexp_replace(upper(btrim(coalesce(p_address->>'modulo',''))),'^[MR]','');
  IF v_modulo ~ '^\d+$' THEN v_modulo := (v_modulo::numeric)::text; END IF;
  v_posicao := upper(btrim(coalesce(p_address->>'posicao','')));
  IF v_estoque NOT IN ('2','3') OR v_modulo='' OR v_posicao='' THEN
    RAISE EXCEPTION 'INVALID_PHYSICAL_ADDRESS_FOR_DELETE' USING ERRCODE = '22023';
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
    RAISE EXCEPTION 'PHYSICAL_DELETE_SET_MISMATCH' USING ERRCODE = '22023';
  END IF;

  /* Only canonical E2/E3 auxiliary IDs may be deleted by full-address correction.
     The old slot can already be blank if its prior balance was recovered from a
     divergence, so identity/balance validation uses the one audit event and the
     existing reconciliation RPC's locked recovery checks. */
  FOREACH v_id IN ARRAY p_delete_slot_ids LOOP
    SELECT e.value INTO v_expected FROM jsonb_array_elements(p_expected_slots) e(value) WHERE e.value->>'id'=v_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'PHYSICAL_DELETE_ID_NOT_IN_SNAPSHOT: %', v_id USING ERRCODE = '22023'; END IF;
    SELECT r.* INTO v_slot FROM jsonb_populate_record(NULL::public.slots, v_expected) r;
    IF v_slot.estoque <> v_estoque OR v_slot.modulo <> v_modulo OR v_slot.posicao <> v_posicao
       OR v_slot.id = v_estoque || '-' || v_modulo || '-' || v_posicao
       OR position('::ITEM::' IN v_slot.id)=0 THEN
      RAISE EXCEPTION 'PHYSICAL_DELETE_ONLY_CANONICAL_AUXILIARY: %', v_id USING ERRCODE = '22023';
    END IF;
    SELECT h.value INTO v_history
      FROM jsonb_array_elements(p_history) h(value)
     WHERE h.value->>'slot_id'=v_id;
    IF NOT FOUND OR (
      SELECT count(*) FROM jsonb_array_elements(p_history) h(value) WHERE h.value->>'slot_id'=v_id
    ) <> 1 THEN
      RAISE EXCEPTION 'PHYSICAL_DELETE_REQUIRES_EXACTLY_ONE_AUDIT_EVENT: %', v_id USING ERRCODE = '22023';
    END IF;
    v_sku := upper(btrim(coalesce(v_history->>'referencia','')));
    v_restriction := lower(coalesce(nullif(btrim(v_history->>'restricao'),''),'nenhuma'));
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_history) h(value)
      WHERE upper(btrim(coalesce(h.value->>'estoque',''))) = v_estoque
        AND regexp_replace(upper(btrim(coalesce(h.value->>'modulo',''))),'^[MR]','') = v_modulo
        AND upper(btrim(coalesce(h.value->>'posicao',''))) = v_posicao
        AND upper(btrim(coalesce(h.value->>'referencia',''))) = v_sku
        AND lower(coalesce(nullif(btrim(h.value->>'restricao'),''),'nenhuma')) = v_restriction
        AND h.value->>'slot_id' IS DISTINCT FROM v_id
    ) THEN
      RAISE EXCEPTION 'PHYSICAL_DELETE_HISTORY_SPLIT_IDENTITY: %', v_id USING ERRCODE = '22023';
    END IF;
    IF v_sku='' OR v_sku='VAZIO'
       OR v_slot.id <> v_estoque || '-' || v_modulo || '-' || v_posicao || '::ITEM::' || v_sku || '::' || v_restriction
       OR v_history->>'naturezaTransacao' IS DISTINCT FROM 'correcao_fisica'
       OR v_history->>'correcaoId' IS DISTINCT FROM p_correction_id::text
       OR coalesce(v_history->>'saldoAnterior','') !~ '^[1-9][0-9]*$'
       OR coalesce(v_history->>'saldoFinal','') !~ '^0+$'
       OR coalesce(v_history->>'quantidade','') !~ '^[1-9][0-9]*$'
       OR coalesce(v_history->>'tipo','') <> 'Sa├¡da'
       OR (v_history->>'quantidade')::bigint <> (v_history->>'saldoAnterior')::bigint THEN
      RAISE EXCEPTION 'PHYSICAL_DELETE_AUDIT_IDENTITY_OR_ZERO_BALANCE_MISMATCH: %', v_id USING ERRCODE = '22023';
    END IF;
    v_expected_balance := (v_history->>'saldoAnterior')::bigint;
    v_final_balance := (v_history->>'saldoFinal')::bigint;
    v_quantity := (v_history->>'quantidade')::bigint;
    IF v_expected_balance <= 0 OR v_final_balance <> 0 OR v_quantity <> v_expected_balance THEN
      RAISE EXCEPTION 'PHYSICAL_DELETE_AUDIT_DELTA_MISMATCH: %', v_id USING ERRCODE = '22023';
    END IF;
    IF nullif(upper(btrim(coalesce(v_slot.referencia,''))),'') IS NOT NULL THEN
      IF upper(btrim(v_slot.referencia)) <> v_sku
         OR lower(coalesce(nullif(btrim(v_slot.restricao),''),'nenhuma')) <> v_restriction
         OR coalesce(v_slot.saldo,0)::bigint <> v_expected_balance THEN
        RAISE EXCEPTION 'PHYSICAL_DELETE_PREVIOUS_SLOT_IDENTITY_MISMATCH: %', v_id USING ERRCODE = '22023';
      END IF;
    ELSE
      IF coalesce(v_slot.saldo,0) <> 0 OR NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_expected_divergencias) d(value)
        WHERE lower(coalesce(d.value->>'status',''))='aberta'
          AND (d.value->>'slot_id'=v_id OR (
            upper(btrim(coalesce(d.value->>'refAtual',''))) = v_sku
            AND lower(coalesce(nullif(btrim(d.value->>'restricao'),''),'nenhuma'))=v_restriction
          ))
      ) THEN
        RAISE EXCEPTION 'PHYSICAL_DELETE_EMPTY_SLOT_WITHOUT_RECOVERABLE_DIVERGENCE: %', v_id USING ERRCODE = '22023';
      END IF;
    END IF;
  END LOOP;

  SELECT coalesce(jsonb_agg(staged.row_value ORDER BY staged.row_value->>'id'), '[]'::jsonb)
    INTO v_staged_slots
    FROM (
      SELECT n.value AS row_value FROM jsonb_array_elements(p_slots) n(value)
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

  v_result := public.reconcile_physical_address_atomic(
    p_correction_id, p_address, p_expected_slots, v_staged_slots,
    p_expected_divergencias, p_divergencias, p_history
  );
  IF coalesce((v_result->>'success')::boolean,false) IS NOT TRUE THEN
    RETURN v_result;
  END IF;

  /* Same correction ID + same payload is idempotent. A retry is successful only
     if the auxiliary rows are already absent and their correction events exist. */
  IF coalesce((v_result->>'alreadyApplied')::boolean,false) THEN
    IF EXISTS (SELECT 1 FROM public.slots s WHERE s.id = ANY(p_delete_slot_ids))
       OR EXISTS (
         SELECT 1 FROM unnest(p_delete_slot_ids) d(id)
         WHERE NOT EXISTS (
           SELECT 1 FROM public.history h
           WHERE h.slot_id=d.id AND h."correcaoId"=p_correction_id
             AND h."naturezaTransacao"='correcao_fisica'
         )
       ) THEN
      RAISE EXCEPTION 'PHYSICAL_DELETE_IDEMPOTENT_RETRY_STATE_MISMATCH' USING ERRCODE = '40001';
    END IF;
    RETURN v_result || jsonb_build_object('slots_deleted',0);
  END IF;

  FOREACH v_id IN ARRAY p_delete_slot_ids LOOP
    SELECT e.value INTO v_expected FROM jsonb_array_elements(p_expected_slots) e(value) WHERE e.value->>'id'=v_id;
    SELECT r.* INTO v_slot FROM jsonb_populate_record(NULL::public.slots, v_expected) r;
    v_sku := upper(btrim(coalesce((SELECT h.value->>'referencia' FROM jsonb_array_elements(p_history) h(value) WHERE h.value->>'slot_id'=v_id),'')));
    v_restriction := lower(coalesce(nullif(btrim((SELECT h.value->>'restricao' FROM jsonb_array_elements(p_history) h(value) WHERE h.value->>'slot_id'=v_id)),''),'nenhuma'));
    IF NOT EXISTS (
      SELECT 1 FROM public.slots s WHERE s.id=v_id AND coalesce(s.referencia,'')='' AND coalesce(s.saldo,0)=0
    ) THEN
      RAISE EXCEPTION 'PHYSICAL_DELETE_TRANSIENT_CLEAR_MISMATCH: %', v_id USING ERRCODE = '40001';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.slots other
      WHERE other.id<>v_id AND other.estoque=v_estoque AND other.modulo=v_modulo AND other.posicao=v_posicao
        AND upper(btrim(coalesce(other.referencia,'')))=v_sku
        AND lower(coalesce(nullif(btrim(other.restricao),''),'nenhuma'))=v_restriction
        AND coalesce(other.saldo,0)>0
    ) THEN
      RAISE EXCEPTION 'PHYSICAL_DELETE_DUPLICATE_LIVE_IDENTITY: %',v_id USING ERRCODE='22023';
    END IF;
  END LOOP;

  DELETE FROM public.slots s WHERE s.id=ANY(p_delete_slot_ids);
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  IF v_deleted_count <> cardinality(p_delete_slot_ids) THEN
    RAISE EXCEPTION 'PHYSICAL_DELETE_COUNT_MISMATCH' USING ERRCODE = '40001';
  END IF;

  v_result := jsonb_set(
    v_result,
    '{slots_written}',
    to_jsonb(greatest(coalesce((v_result->>'slots_written')::integer,0)-v_deleted_count,0)),
    true
  ) || jsonb_build_object('slots_deleted',v_deleted_count);
  RETURN v_result;
EXCEPTION
  WHEN SQLSTATE '40001' THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    RETURN jsonb_build_object('success',false,'conflict',true,'code',split_part(v_message,':',1),'message','A fotografia do endere├ºo mudou durante a corre├º├úo f├¡sica. A transa├º├úo foi revertida; atualize o endere├ºo.','correctionId',p_correction_id,'slots_deleted',0);
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
    RETURN jsonb_build_object('success',false,'conflict',false,'code',split_part(v_message,':',1),'sqlstate',v_sqlstate,'message','A corre├º├úo f├¡sica foi revertida integralmente. Nenhuma exclus├úo foi confirmada; atualize e confira o endere├ºo.','correctionId',p_correction_id,'slots_deleted',0);
END;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_stock_divergence_atomic(p_expected_slots jsonb, p_slots jsonb, p_history jsonb, p_expected_divergencias jsonb, p_divergencias jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_expected_json jsonb;
  v_payload jsonb;
  v_current_slot public.slots%ROWTYPE;
  v_new_slot public.slots%ROWTYPE;
  v_current_divergencia public.divergencias%ROWTYPE;
  v_new_divergencia public.divergencias%ROWTYPE;
  v_id text;
  v_expected_slot_ids text[] := ARRAY[]::text[];
  v_expected_divergencia_ids text[] := ARRAY[]::text[];
  v_slots_written integer := 0;
  v_history_written integer := 0;
  v_divergencias_written integer := 0;
BEGIN
  -- Requer sess├úo v├ílida e perfil operacional. RLS permanece habilitado.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  IF public.has_app_permission('divergences.resolve') IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'PERMISSION_DENIED:divergences.resolve'
      USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(p_expected_slots) IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_slots) IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_history) IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_expected_divergencias) IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_divergencias) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'INVALID_TRANSACTION_PAYLOAD'
      USING ERRCODE = '22023';
  END IF;

  -- Uma corre├º├úo fecha ao menos uma diverg├¬ncia existente. Limites protegem
  -- contra chamadas com payloads anormais sem restringir o uso normal.
  IF jsonb_array_length(p_history) = 0
     OR jsonb_array_length(p_expected_divergencias) = 0
     OR jsonb_array_length(p_divergencias) = 0
     OR jsonb_array_length(p_expected_slots) > 100
     OR jsonb_array_length(p_slots) > 100
     OR jsonb_array_length(p_history) > 100
     OR jsonb_array_length(p_expected_divergencias) > 100
     OR jsonb_array_length(p_divergencias) > 100
     OR jsonb_array_length(p_expected_divergencias) <> jsonb_array_length(p_divergencias) THEN
    RAISE EXCEPTION 'INVALID_TRANSACTION_PAYLOAD'
      USING ERRCODE = '22023';
  END IF;

  -- IDs vazios ou repetidos no payload s├úo rejeitados, nunca consolidados silenciosamente.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_expected_slots) AS e(value)
    WHERE COALESCE(e.value ->> 'id', '') = ''
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_expected_slots) AS e(value)
    GROUP BY e.value ->> 'id' HAVING count(*) > 1
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_slots) AS e(value)
    WHERE COALESCE(e.value ->> 'id', '') = ''
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_slots) AS e(value)
    GROUP BY e.value ->> 'id' HAVING count(*) > 1
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_expected_divergencias) AS e(value)
    WHERE COALESCE(e.value ->> 'id', '') = ''
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_expected_divergencias) AS e(value)
    GROUP BY e.value ->> 'id' HAVING count(*) > 1
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_divergencias) AS e(value)
    WHERE COALESCE(e.value ->> 'id', '') = ''
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_divergencias) AS e(value)
    GROUP BY e.value ->> 'id' HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'DUPLICATE_OR_EMPTY_RECORD_ID'
      USING ERRCODE = '22023';
  END IF;

  -- Toda posi├º├úo antiga validada precisa aparecer tamb├®m no payload novo.
  -- Isso evita confirmar diverg├¬ncias/hist├│rico sem gravar a posi├º├úo validada.
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_expected_slots) AS e(value)
    WHERE NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_slots) AS p(value)
      WHERE p.value ->> 'id' = e.value ->> 'id'
    )
  ) THEN
    RAISE EXCEPTION 'SLOT_PAYLOAD_ID_MISMATCH'
      USING ERRCODE = '22023';
  END IF;

  -- O hist├│rico ├® append-only: IDs vazios ou repetidos s├úo inv├ílidos.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_history) AS h(value)
    WHERE COALESCE(h.value ->> 'id', '') = ''
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_history) AS h(value)
    GROUP BY h.value ->> 'id' HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'DUPLICATE_OR_EMPTY_HISTORY_ID'
      USING ERRCODE = '22023';
  END IF;

  -- Diverg├¬ncias recebidas para atualiza├º├úo devem corresponder exatamente
  -- ├ás diverg├¬ncias originais enviadas para valida├º├úo.
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_expected_divergencias) AS e(value)
    WHERE NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_divergencias) AS p(value)
      WHERE p.value ->> 'id' = e.value ->> 'id'
    )
  ) OR EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_divergencias) AS p(value)
    WHERE NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_expected_divergencias) AS e(value)
      WHERE e.value ->> 'id' = p.value ->> 'id'
    )
  ) THEN
    RAISE EXCEPTION 'DIVERGENCIA_PAYLOAD_ID_MISMATCH'
      USING ERRCODE = '22023';
  END IF;

  -- Trava e compara cada posi├º├úo original. Se um saldo/registro mudou desde
  -- a leitura do operador, toda a opera├º├úo ├® abortada sem gravar nenhuma parte.
  FOR v_expected_json IN
    SELECT e.value
    FROM jsonb_array_elements(p_expected_slots) AS e(value)
    ORDER BY e.value ->> 'id'
  LOOP
    v_id := v_expected_json ->> 'id';

    SELECT s.*
      INTO v_current_slot
      FROM public.slots AS s
     WHERE s.id = v_id
     FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object(
        'success', false,
        'conflict', true,
        'code', 'SLOT_CONFLICT',
        'message', format('SLOT_CONFLICT: posi├º├úo removida ou n├úo encontrada (%s).', v_id),
        'slot_id', v_id
      );
    END IF;

    IF to_jsonb(v_current_slot) IS DISTINCT FROM v_expected_json THEN
      RETURN jsonb_build_object(
        'success', false,
        'conflict', true,
        'code', 'SLOT_CONFLICT',
        'message', format('SLOT_CONFLICT: posi├º├úo alterada por outro usu├írio (%s).', v_id),
        'slot_id', v_id
      );
    END IF;

    v_expected_slot_ids := array_append(v_expected_slot_ids, v_id);
  END LOOP;

  -- Trava diverg├¬ncias em ordem determin├¡stica. Elas precisam continuar abertas
  -- e iguais ao estado que o operador consultou (exceto caixa do campo status).
  FOR v_expected_json IN
    SELECT e.value
    FROM jsonb_array_elements(p_expected_divergencias) AS e(value)
    ORDER BY e.value ->> 'id'
  LOOP
    v_id := v_expected_json ->> 'id';

    IF lower(trim(COALESCE(v_expected_json ->> 'status', ''))) <> 'aberta' THEN
      RAISE EXCEPTION 'DIVERGENCIA_CONFLICT: a tela n├úo enviou uma diverg├¬ncia aberta (%).', v_id
        USING ERRCODE = 'P0001';
    END IF;

    SELECT d.*
      INTO v_current_divergencia
      FROM public.divergencias AS d
     WHERE d.id = v_id
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'DIVERGENCIA_CONFLICT: diverg├¬ncia removida (%).', v_id
        USING ERRCODE = 'P0001';
    END IF;

    IF lower(trim(COALESCE(v_current_divergencia.status, ''))) <> 'aberta' THEN
      RAISE EXCEPTION 'DIVERGENCIA_CONFLICT: diverg├¬ncia j├í resolvida (%).', v_id
        USING ERRCODE = 'P0001';
    END IF;

    IF (to_jsonb(v_current_divergencia) - 'status')
         IS DISTINCT FROM (v_expected_json - 'status') THEN
      RAISE EXCEPTION 'DIVERGENCIA_CONFLICT: registro alterado por outro usu├írio (%).', v_id
        USING ERRCODE = 'P0001';
    END IF;

    v_expected_divergencia_ids := array_append(v_expected_divergencia_ids, v_id);
  END LOOP;

  -- Atualiza/cria apenas os slots enviados. Um novo ID precisa continuar
  -- inexistente; IDs existentes precisam ter sido validados acima.
  FOR v_payload IN
    SELECT e.value
    FROM jsonb_array_elements(p_slots) AS e(value)
    ORDER BY e.value ->> 'id'
  LOOP
    SELECT r.*
      INTO v_new_slot
      FROM jsonb_populate_record(NULL::public.slots, v_payload) AS r;

    IF COALESCE(v_new_slot.id, '') = '' THEN
      RAISE EXCEPTION 'INVALID_SLOT_ID'
        USING ERRCODE = '22023';
    END IF;

    IF v_new_slot.id = ANY(v_expected_slot_ids) THEN
      UPDATE public.slots AS s
         SET estoque = v_new_slot.estoque,
             modulo = v_new_slot.modulo,
             posicao = v_new_slot.posicao,
             referencia = v_new_slot.referencia,
             descricao = v_new_slot.descricao,
             saldo = v_new_slot.saldo,
             "dataChacote" = v_new_slot."dataChacote",
             "ultimaData" = v_new_slot."ultimaData",
             "ultimaHora" = v_new_slot."ultimaHora",
             "ultimoResponsavel" = v_new_slot."ultimoResponsavel",
             galpao = v_new_slot.galpao,
             restricao = v_new_slot.restricao,
             observacao = v_new_slot.observacao
       WHERE s.id = v_new_slot.id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'SLOT_CONFLICT: falha ao atualizar posi├º├úo (%).', v_new_slot.id
          USING ERRCODE = 'P0001';
      END IF;
    ELSE
      IF EXISTS (SELECT 1 FROM public.slots AS s WHERE s.id = v_new_slot.id) THEN
        RAISE EXCEPTION 'SLOT_CONFLICT: novo ID j├í existe (%).', v_new_slot.id
          USING ERRCODE = 'P0001';
      END IF;

      INSERT INTO public.slots (
        id, estoque, modulo, posicao, referencia, descricao, saldo,
        "dataChacote", "ultimaData", "ultimaHora", "ultimoResponsavel",
        galpao, restricao, observacao
      ) VALUES (
        v_new_slot.id, v_new_slot.estoque, v_new_slot.modulo, v_new_slot.posicao,
        v_new_slot.referencia, v_new_slot.descricao, v_new_slot.saldo,
        v_new_slot."dataChacote", v_new_slot."ultimaData", v_new_slot."ultimaHora",
        v_new_slot."ultimoResponsavel", v_new_slot.galpao, v_new_slot.restricao,
        v_new_slot.observacao
      );
    END IF;

    v_slots_written := v_slots_written + 1;
  END LOOP;

  -- O hist├│rico ├® append-only. Falha em qualquer registro reverte tamb├®m
  -- as atualiza├º├Áes de slots e diverg├¬ncias desta mesma chamada RPC.
  INSERT INTO public.history (
    id, "dataLancamento", "quemLancou", data, estoque, modulo, posicao,
    referencia, quantidade, tipo, "dataChacote", hora, responsavel,
    observacao, galpao, slot_id, restricao
  )
  SELECT
    h.id, h."dataLancamento", h."quemLancou", h.data, h.estoque, h.modulo,
    h.posicao, h.referencia, h.quantidade, h.tipo, h."dataChacote", h.hora,
    h.responsavel, h.observacao, h.galpao, h.slot_id, h.restricao
  FROM jsonb_populate_recordset(NULL::public.history, p_history) AS h;
  GET DIAGNOSTICS v_history_written = ROW_COUNT;

  -- Esta RPC ├® exclusiva para resolver diverg├¬ncias existentes. N├úo insere
  -- nem reabre diverg├¬ncias; cada uma deve mudar de Aberta para Corrigida.
  FOR v_payload IN
    SELECT e.value
    FROM jsonb_array_elements(p_divergencias) AS e(value)
    ORDER BY e.value ->> 'id'
  LOOP
    SELECT r.*
      INTO v_new_divergencia
      FROM jsonb_populate_record(NULL::public.divergencias, v_payload) AS r;

    IF NOT (v_new_divergencia.id = ANY(v_expected_divergencia_ids))
       OR lower(trim(COALESCE(v_new_divergencia.status, ''))) <> 'corrigida' THEN
      RAISE EXCEPTION 'INVALID_DIVERGENCIA_TRANSITION (%)', v_new_divergencia.id
        USING ERRCODE = '22023';
    END IF;

    SELECT e.value
      INTO v_expected_json
      FROM jsonb_array_elements(p_expected_divergencias) AS e(value)
     WHERE e.value ->> 'id' = v_new_divergencia.id;

    -- Campos que definem a origem da diverg├¬ncia n├úo podem ser reescritos
    -- por uma corre├º├úo com dados antigos. S├│ s├úo edit├íveis os campos de
    -- resolu├º├úo: status, refNova, saldoFinal, dataCorrecao, corrigidoPor,
    -- slot_id, observacao e restricao.
    IF (v_payload ->> 'dataDivergencia') IS DISTINCT FROM (v_expected_json ->> 'dataDivergencia')
       OR (v_payload ->> 'tipoDivergencia') IS DISTINCT FROM (v_expected_json ->> 'tipoDivergencia')
       OR (v_payload ->> 'estoque') IS DISTINCT FROM (v_expected_json ->> 'estoque')
       OR (v_payload ->> 'modulo') IS DISTINCT FROM (v_expected_json ->> 'modulo')
       OR (v_payload ->> 'posicao') IS DISTINCT FROM (v_expected_json ->> 'posicao')
       OR (v_payload ->> 'refAtual') IS DISTINCT FROM (v_expected_json ->> 'refAtual')
       OR (v_payload ->> 'saldoAntes') IS DISTINCT FROM (v_expected_json ->> 'saldoAntes')
       OR (v_payload ->> 'movimentacao') IS DISTINCT FROM (v_expected_json ->> 'movimentacao')
       OR (v_payload ->> 'responsavel') IS DISTINCT FROM (v_expected_json ->> 'responsavel')
       OR (v_payload ->> 'dataChacote') IS DISTINCT FROM (v_expected_json ->> 'dataChacote') THEN
      RAISE EXCEPTION 'STALE_DIVERGENCIA_PAYLOAD (%)', v_new_divergencia.id
        USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.divergencias AS d
       SET "dataDivergencia" = v_new_divergencia."dataDivergencia",
           "tipoDivergencia" = v_new_divergencia."tipoDivergencia",
           estoque = v_new_divergencia.estoque,
           modulo = v_new_divergencia.modulo,
           posicao = v_new_divergencia.posicao,
           "refAtual" = v_new_divergencia."refAtual",
           "refNova" = v_new_divergencia."refNova",
           "saldoAntes" = v_new_divergencia."saldoAntes",
           movimentacao = v_new_divergencia.movimentacao,
           "saldoFinal" = v_new_divergencia."saldoFinal",
           responsavel = v_new_divergencia.responsavel,
           status = v_new_divergencia.status,
           "dataChacote" = v_new_divergencia."dataChacote",
           "dataCorrecao" = v_new_divergencia."dataCorrecao",
           "corrigidoPor" = v_new_divergencia."corrigidoPor",
           observacao = v_new_divergencia.observacao,
           slot_id = v_new_divergencia.slot_id,
           restricao = v_new_divergencia.restricao
     WHERE d.id = v_new_divergencia.id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'DIVERGENCIA_CONFLICT: falha ao atualizar (%).', v_new_divergencia.id
        USING ERRCODE = 'P0001';
    END IF;

    v_divergencias_written := v_divergencias_written + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'slots_written', v_slots_written,
    'history_written', v_history_written,
    'divergencias_written', v_divergencias_written
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.zero_physical_divergence_address_atomic(
  p_physical_zero_confirmed boolean,
  p_correction_id uuid,
  p_address jsonb,
  p_expected_slots jsonb,
  p_slots jsonb,
  p_expected_divergencias jsonb,
  p_divergencias jsonb,
  p_history jsonb,
  p_delete_slot_ids text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_estoque text;
  v_modulo text;
  v_posicao text;
  v_base_id text;
  v_actor_name text;
  v_now timestamp without time zone;
  v_local_date text;
  v_local_time text;
  v_fingerprint text;
  v_existing_fingerprint text;
  v_existing_actor uuid;
  v_existing_created_at timestamptz;
  v_inserted integer := 0;
  v_position_active boolean;
  v_module_active boolean;
  v_expected_slot jsonb;
  v_expected_divergencia jsonb;
  v_history_item jsonb;
  v_new_divergencia public.divergencias%ROWTYPE;
  v_current_slot public.slots%ROWTYPE;
  v_current_divergencia public.divergencias%ROWTYPE;
  v_base_slot public.slots%ROWTYPE;
  v_final_slot public.slots%ROWTYPE;
  v_id text;
  v_suffix text;
  v_parts text[];
  v_sku text;
  v_restricao text;
  v_raw_referencia text;
  v_raw_restricao text;
  v_current_count bigint;
  v_expected_count bigint;
  v_divergence_count bigint;
  v_history_identity_count bigint := 0;
  v_history_match_count bigint;
  v_history_written integer := 0;
  v_divergencias_written integer := 0;
  v_slots_deleted integer := 0;
  v_date_chacote text;
  v_date_chacote_count bigint;
  v_quantity bigint;
  v_base_galpao text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF public.has_app_permission('stock.physical_correction') IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'PERMISSION_DENIED:stock.physical_correction' USING ERRCODE = '42501';
  END IF;
  IF public.has_app_permission('divergences.resolve') IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'PERMISSION_DENIED:divergences.resolve' USING ERRCODE = '42501';
  END IF;
  IF p_physical_zero_confirmed IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'PHYSICAL_ZERO_CONFIRMATION_REQUIRED' USING ERRCODE = '42501';
  END IF;

  SELECT p.name INTO v_actor_name
    FROM public.profiles AS p
   WHERE p.id = auth.uid();
  IF COALESCE(btrim(v_actor_name), '') = '' THEN
    RAISE EXCEPTION 'OPERATOR_PROFILE_MISSING' USING ERRCODE = '42501';
  END IF;
  v_now := clock_timestamp() AT TIME ZONE 'America/Sao_Paulo';
  v_local_date := to_char(v_now, 'YYYY-MM-DD');
  v_local_time := to_char(v_now, 'HH24:MI:SS');

  IF p_correction_id IS NULL
     OR jsonb_typeof(p_address) IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_expected_slots) IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_slots) IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_expected_divergencias) IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_divergencias) IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_history) IS DISTINCT FROM 'array'
     OR p_delete_slot_ids IS NULL THEN
    RAISE EXCEPTION 'INVALID_PHYSICAL_ZERO_PAYLOAD' USING ERRCODE = '22023';
  END IF;

  v_estoque := upper(btrim(COALESCE(p_address ->> 'estoque', '')));
  IF left(v_estoque, 1) = 'E' THEN
    v_estoque := substring(v_estoque FROM 2);
  END IF;
  v_modulo := upper(btrim(COALESCE(p_address ->> 'modulo', '')));
  v_modulo := regexp_replace(v_modulo, '^[MR]', '');
  IF v_modulo ~ '^\d+$' THEN
    v_modulo := (v_modulo::numeric)::text;
  END IF;
  v_posicao := upper(btrim(COALESCE(p_address ->> 'posicao', '')));

  IF v_estoque NOT IN ('2', '3')
     OR v_modulo = '' OR v_modulo !~ '^[1-9][0-9]*$'
     OR v_posicao = ''
     OR (p_address ->> 'modulo') IS DISTINCT FROM v_modulo THEN
    RAISE EXCEPTION 'INVALID_OR_NON_CANONICAL_PHYSICAL_ADDRESS' USING ERRCODE = '22023';
  END IF;
  v_base_id := v_estoque || '-' || v_modulo || '-' || v_posicao;

  IF jsonb_array_length(p_expected_slots) < 1
     OR jsonb_array_length(p_expected_slots) > 1000
     OR jsonb_array_length(p_slots) <> 1
     OR jsonb_array_length(p_expected_divergencias) < 1
     OR jsonb_array_length(p_expected_divergencias) > 1000
     OR jsonb_array_length(p_divergencias) <> jsonb_array_length(p_expected_divergencias)
     OR jsonb_array_length(p_history) > 1000
     OR cardinality(p_delete_slot_ids) > 999
     OR cardinality(p_delete_slot_ids) <> jsonb_array_length(p_expected_slots) - 1 THEN
    RAISE EXCEPTION 'INVALID_PHYSICAL_ZERO_PAYLOAD_SIZE' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_expected_slots) AS e(value)
    WHERE jsonb_typeof(e.value) IS DISTINCT FROM 'object'
       OR COALESCE(e.value ->> 'id', '') = ''
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_expected_slots) AS e(value)
    GROUP BY e.value ->> 'id' HAVING count(*) > 1
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_expected_divergencias) AS e(value)
    WHERE jsonb_typeof(e.value) IS DISTINCT FROM 'object'
       OR COALESCE(e.value ->> 'id', '') = ''
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_expected_divergencias) AS e(value)
    GROUP BY e.value ->> 'id' HAVING count(*) > 1
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_divergencias) AS e(value)
    WHERE jsonb_typeof(e.value) IS DISTINCT FROM 'object'
       OR COALESCE(e.value ->> 'id', '') = ''
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_divergencias) AS e(value)
    GROUP BY e.value ->> 'id' HAVING count(*) > 1
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_history) AS e(value)
    WHERE jsonb_typeof(e.value) IS DISTINCT FROM 'object'
       OR COALESCE(e.value ->> 'id', '') = ''
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_history) AS e(value)
    GROUP BY e.value ->> 'id' HAVING count(*) > 1
  ) OR EXISTS (
    SELECT 1 FROM unnest(p_delete_slot_ids) AS d(id)
    WHERE d.id IS NULL OR btrim(d.id) = ''
  ) OR cardinality(p_delete_slot_ids) <> (
    SELECT count(DISTINCT d.id) FROM unnest(p_delete_slot_ids) AS d(id)
  ) THEN
    RAISE EXCEPTION 'DUPLICATE_OR_EMPTY_PHYSICAL_ZERO_ID' USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(p_slots -> 0) IS DISTINCT FROM 'object'
     OR (SELECT count(*) FROM jsonb_array_elements(p_expected_slots) AS e(value)
       WHERE e.value ->> 'id' = v_base_id) <> 1
     OR (p_slots -> 0 ->> 'id') IS DISTINCT FROM v_base_id
     OR (p_slots -> 0 ->> 'estoque') IS DISTINCT FROM v_estoque
     OR (p_slots -> 0 ->> 'modulo') IS DISTINCT FROM v_modulo
     OR (p_slots -> 0 ->> 'posicao') IS DISTINCT FROM v_posicao THEN
    RAISE EXCEPTION 'PHYSICAL_ZERO_BASE_SLOT_MISMATCH' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_expected_slots) AS e(value)
    WHERE COALESCE(e.value ->> 'estoque', '') <> v_estoque
       OR COALESCE(e.value ->> 'modulo', '') <> v_modulo
       OR COALESCE(e.value ->> 'posicao', '') <> v_posicao
  ) OR EXISTS (
    SELECT 1 FROM unnest(p_delete_slot_ids) AS d(id)
    WHERE d.id = v_base_id
       OR NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(p_expected_slots) AS e(value)
         WHERE e.value ->> 'id' = d.id
       )
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_expected_slots) AS e(value)
    WHERE e.value ->> 'id' <> v_base_id
      AND NOT (e.value ->> 'id' = ANY(p_delete_slot_ids))
  ) THEN
    RAISE EXCEPTION 'PHYSICAL_ZERO_DELETE_SET_MISMATCH' USING ERRCODE = '22023';
  END IF;

  -- Each auxiliary ID must encode the same SKU/restriction as its row. Empty
  -- auxiliaries are allowed only at zero balance; no inactive layout rows are touched.
  FOR v_expected_slot IN
    SELECT e.value FROM jsonb_array_elements(p_expected_slots) AS e(value)
    ORDER BY e.value ->> 'id'
  LOOP
    SELECT r.* INTO v_current_slot
      FROM jsonb_populate_record(NULL::public.slots, v_expected_slot) AS r;
    v_raw_referencia := COALESCE(v_current_slot.referencia, '');
    v_raw_restricao := lower(btrim(COALESCE(v_current_slot.restricao, '')));
    IF COALESCE(v_current_slot.id, '') = ''
       OR v_current_slot.estoque <> v_estoque
       OR v_current_slot.modulo <> v_modulo
       OR v_current_slot.posicao <> v_posicao
       OR COALESCE(v_current_slot.saldo, 0) < 0
       OR COALESCE(v_current_slot.saldo, 0)::bigint > 2147483647
       OR upper(btrim(v_raw_referencia)) = 'VAZIO'
       OR (upper(btrim(v_raw_referencia)) = '' AND COALESCE(v_current_slot.saldo, 0) > 0)
       OR v_current_slot.galpao NOT IN ('3', '12')
       OR v_raw_restricao NOT IN ('nenhuma', 'teste', 'autorizacao', 'outra')
       OR (v_current_slot.galpao = '12' AND v_raw_restricao <> 'autorizacao') THEN
      RAISE EXCEPTION 'INVALID_PHYSICAL_ZERO_SLOT: %', v_current_slot.id USING ERRCODE = '22023';
    END IF;

    IF v_current_slot.id <> v_base_id THEN
      IF left(v_current_slot.id, length(v_base_id) + 8) <> (v_base_id || '::ITEM::') THEN
        RAISE EXCEPTION 'NON_CANONICAL_PHYSICAL_ZERO_AUXILIARY_ID: %', v_current_slot.id USING ERRCODE = '22023';
      END IF;
      v_suffix := substring(v_current_slot.id FROM length(v_base_id) + 9);
      v_parts := string_to_array(v_suffix, '::');
      IF cardinality(v_parts) <> 2
         OR COALESCE(v_parts[1], '') = ''
         OR v_parts[1] <> upper(v_parts[1])
         OR v_parts[1] = 'VAZIO'
         OR COALESCE(v_parts[2], '') NOT IN ('nenhuma', 'teste', 'autorizacao', 'outra')
         OR lower(btrim(COALESCE(v_current_slot.restricao, ''))) <> v_parts[2]
         OR (upper(btrim(v_raw_referencia)) <> '' AND upper(btrim(v_raw_referencia)) <> v_parts[1])
         OR (upper(btrim(v_raw_referencia)) = '' AND COALESCE(v_current_slot.saldo, 0) <> 0) THEN
        RAISE EXCEPTION 'PHYSICAL_ZERO_AUXILIARY_IDENTITY_MISMATCH: %', v_current_slot.id USING ERRCODE = '22023';
      END IF;
    END IF;
  END LOOP;

  SELECT r.* INTO v_base_slot
    FROM jsonb_populate_record(
      NULL::public.slots,
      (SELECT e.value FROM jsonb_array_elements(p_expected_slots) AS e(value)
        WHERE e.value ->> 'id' = v_base_id)
    ) AS r;
  v_base_galpao := v_base_slot.galpao;

  SELECT r.* INTO v_final_slot
    FROM jsonb_populate_record(NULL::public.slots, p_slots -> 0) AS r;
  IF COALESCE(v_final_slot.referencia, '') <> ''
     OR COALESCE(v_final_slot.descricao, '') <> ''
     OR COALESCE(v_final_slot.saldo, 0) <> 0
     OR COALESCE(v_final_slot."dataChacote", '') <> ''
     OR COALESCE(v_final_slot.observacao, '') <> ''
     OR v_final_slot.galpao IS DISTINCT FROM v_base_galpao
     OR v_final_slot.restricao IS DISTINCT FROM (CASE WHEN v_base_galpao = '12' THEN 'autorizacao' ELSE 'nenhuma' END)
     OR COALESCE(v_final_slot."ultimaData", '') !~ '^\d{4}-\d{2}-\d{2}$'
     OR COALESCE(v_final_slot."ultimaHora", '') !~ '^\d{2}:\d{2}$'
     OR COALESCE(btrim(v_final_slot."ultimoResponsavel"), '') = '' THEN
    RAISE EXCEPTION 'PHYSICAL_ZERO_FINAL_BASE_INVALID' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_expected_divergencias) AS e(value)
    WHERE COALESCE(e.value ->> 'estoque', '') <> v_estoque
       OR COALESCE(e.value ->> 'modulo', '') <> v_modulo
       OR COALESCE(e.value ->> 'posicao', '') <> v_posicao
       OR lower(COALESCE(e.value ->> 'status', '')) <> 'aberta'
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_divergencias) AS e(value)
    WHERE COALESCE(e.value ->> 'estoque', '') <> v_estoque
       OR COALESCE(e.value ->> 'modulo', '') <> v_modulo
       OR COALESCE(e.value ->> 'posicao', '') <> v_posicao
       OR lower(COALESCE(e.value ->> 'status', '')) <> 'corrigida'
       OR lower(COALESCE(e.value ->> 'correcaoId', '')) <> lower(p_correction_id::text)
       OR COALESCE(e.value ->> 'refNova', '') <> ''
       OR COALESCE(e.value ->> 'saldoFinal', '') !~ '^0+$'
       OR COALESCE(e.value ->> 'dataCorrecao', '') !~ '^\d{4}-\d{2}-\d{2}$'
  ) THEN
    RAISE EXCEPTION 'PHYSICAL_ZERO_DIVERGENCE_PAYLOAD_INVALID' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_expected_divergencias) AS e(value)
    WHERE NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_divergencias) AS n(value)
      WHERE n.value ->> 'id' = e.value ->> 'id'
    )
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_divergencias) AS n(value)
    WHERE NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_expected_divergencias) AS e(value)
      WHERE e.value ->> 'id' = n.value ->> 'id'
    )
  ) THEN
    RAISE EXCEPTION 'PHYSICAL_ZERO_DIVERGENCE_ID_SET_MISMATCH' USING ERRCODE = '22023';
  END IF;


  -- Fingerprint all business-relevant inputs for safe idempotency. The history
  -- array may be empty when the confirmed position has no positive balances.
  v_fingerprint := md5(jsonb_build_object(
    'confirmed', p_physical_zero_confirmed,
    'address', jsonb_build_array(v_estoque, v_modulo, v_posicao),
    'expected_slots', (SELECT COALESCE(jsonb_agg(e.value ORDER BY e.value ->> 'id'), '[]'::jsonb)
                       FROM jsonb_array_elements(p_expected_slots) AS e(value)),
    'slots', (SELECT COALESCE(jsonb_agg(e.value ORDER BY e.value ->> 'id'), '[]'::jsonb)
              FROM jsonb_array_elements(p_slots) AS e(value)),
    'expected_divergencias', (SELECT COALESCE(jsonb_agg(e.value ORDER BY e.value ->> 'id'), '[]'::jsonb)
                              FROM jsonb_array_elements(p_expected_divergencias) AS e(value)),
    'divergencias', (SELECT COALESCE(jsonb_agg(e.value ORDER BY e.value ->> 'id'), '[]'::jsonb)
                     FROM jsonb_array_elements(p_divergencias) AS e(value)),
    'history', (SELECT COALESCE(jsonb_agg(e.value ORDER BY e.value ->> 'id'), '[]'::jsonb)
                FROM jsonb_array_elements(p_history) AS e(value)),
    'delete_slot_ids', (SELECT COALESCE(jsonb_agg(d.id ORDER BY d.id), '[]'::jsonb)
                        FROM unnest(p_delete_slot_ids) AS d(id))
  )::text);

  INSERT INTO public.physical_corrections (
    id, estoque, modulo, posicao, request_fingerprint, created_by, created_by_name
  ) VALUES (
    p_correction_id, v_estoque, v_modulo, v_posicao, v_fingerprint, auth.uid(), v_actor_name
  ) ON CONFLICT (id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF v_inserted = 0 THEN
    SELECT c.request_fingerprint, c.created_by, c.created_at
      INTO v_existing_fingerprint, v_existing_actor, v_existing_created_at
      FROM public.physical_corrections AS c
     WHERE c.id = p_correction_id;
    IF FOUND AND v_existing_fingerprint = v_fingerprint AND v_existing_actor = auth.uid() THEN
      RETURN jsonb_build_object(
        'success', true,
        'alreadyApplied', true,
        'correctionId', p_correction_id,
        'effective_date', to_char(v_existing_created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD'),
        'effective_time', to_char(v_existing_created_at AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI:SS'),
        'actor_name', (SELECT c.created_by_name FROM public.physical_corrections AS c WHERE c.id = p_correction_id),
        'message', 'Esta correção física já foi confirmada anteriormente.'
      );
    END IF;
    RETURN jsonb_build_object(
      'success', false,
      'conflict', true,
      'code', 'CORRECTION_ID_REUSED',
      'message', 'O identificador da correção já foi usado com outro conteúdo ou por outra sessão.',
      'correctionId', p_correction_id
    );
  END IF;

  -- Verify every positive SKU/restriction identity has exactly one consolidated
  -- history row. Zero-balance rows intentionally create no synthetic movement.
  FOR v_sku, v_restricao, v_quantity, v_date_chacote, v_date_chacote_count IN
    SELECT
      upper(btrim(s.referencia)) AS sku,
      lower(btrim(s.restricao)) AS restricao,
      sum(COALESCE(s.saldo, 0))::bigint AS quantidade,
      min(COALESCE(s."dataChacote", '')) AS data_chacote,
      count(DISTINCT COALESCE(s."dataChacote", '')) AS data_chacote_count
    FROM public.slots AS s
    WHERE s.estoque = v_estoque
      AND s.modulo = v_modulo
      AND s.posicao = v_posicao
      AND COALESCE(s.saldo, 0) > 0
      AND COALESCE(btrim(s.referencia), '') <> ''
    GROUP BY upper(btrim(s.referencia)), lower(btrim(s.restricao))
    ORDER BY upper(btrim(s.referencia)) COLLATE "C", lower(btrim(s.restricao)) COLLATE "C"
  LOOP
    v_history_identity_count := v_history_identity_count + 1;
    SELECT count(*) INTO v_history_match_count
      FROM jsonb_array_elements(p_history) AS h(value)
     WHERE upper(btrim(COALESCE(h.value ->> 'referencia', ''))) = v_sku
       AND lower(COALESCE(NULLIF(btrim(h.value ->> 'restricao'), ''), 'nenhuma')) = v_restricao;
    IF v_history_match_count <> 1 THEN
      RAISE EXCEPTION 'PHYSICAL_ZERO_HISTORY_IDENTITY_COUNT_MISMATCH: %/%', v_sku, v_restricao USING ERRCODE = '22023';
    END IF;

    SELECT h.value INTO v_history_item
      FROM jsonb_array_elements(p_history) AS h(value)
     WHERE upper(btrim(COALESCE(h.value ->> 'referencia', ''))) = v_sku
       AND lower(COALESCE(NULLIF(btrim(h.value ->> 'restricao'), ''), 'nenhuma')) = v_restricao;

    IF v_quantity > 2147483647
       OR COALESCE(v_history_item ->> 'id', '') !~ ('^CORR-' || p_correction_id::text || '-[1-9][0-9]*$')
       OR COALESCE(v_history_item ->> 'estoque', '') <> v_estoque
       OR COALESCE(v_history_item ->> 'modulo', '') <> v_modulo
       OR COALESCE(v_history_item ->> 'posicao', '') <> v_posicao
       OR COALESCE(v_history_item ->> 'referencia', '') <> v_sku
       OR COALESCE(v_history_item ->> 'quantidade', '') !~ '^[1-9][0-9]*$'
       OR (v_history_item ->> 'quantidade')::bigint <> v_quantity
       OR COALESCE(v_history_item ->> 'saldoAnterior', '') !~ '^[1-9][0-9]*$'
       OR (v_history_item ->> 'saldoAnterior')::bigint <> v_quantity
       OR COALESCE(v_history_item ->> 'saldoFinal', '') !~ '^0+$'
       OR COALESCE(v_history_item ->> 'tipo', '') <> 'Saída'
       OR COALESCE(v_history_item ->> 'naturezaTransacao', '') <> 'correcao_fisica'
       OR lower(COALESCE(v_history_item ->> 'correcaoId', '')) <> lower(p_correction_id::text)
       OR COALESCE(v_history_item ->> 'slot_id', '') <> v_base_id
       OR COALESCE(v_history_item ->> 'galpao', '') <> v_base_galpao
       OR lower(COALESCE(NULLIF(btrim(v_history_item ->> 'restricao'), ''), 'nenhuma')) <> v_restricao
       OR COALESCE(v_history_item ->> 'dataChacote', '') IS DISTINCT FROM (CASE WHEN v_date_chacote_count = 1 THEN v_date_chacote ELSE '' END)
       OR COALESCE(v_history_item ->> 'data', '') !~ '^\d{4}-\d{2}-\d{2}$'
       OR COALESCE(v_history_item ->> 'dataLancamento', '') IS DISTINCT FROM (v_history_item ->> 'data')
       OR COALESCE(v_history_item ->> 'hora', '') !~ '^\d{2}:\d{2}$'
       OR COALESCE(btrim(v_history_item ->> 'quemLancou'), '') = ''
       OR COALESCE(btrim(v_history_item ->> 'responsavel'), '') = '' THEN
      RAISE EXCEPTION 'PHYSICAL_ZERO_HISTORY_ROW_INVALID: %/%', v_sku, v_restricao USING ERRCODE = '22023';
    END IF;
  END LOOP;

  IF jsonb_array_length(p_history) <> v_history_identity_count THEN
    RAISE EXCEPTION 'PHYSICAL_ZERO_HISTORY_SET_MISMATCH' USING ERRCODE = '22023';
  END IF;

  PERFORM public.lock_stock_address_key(
    public.stock_address_lock_key(v_estoque, v_modulo, v_posicao)
  );

  SELECT p.ativo INTO v_position_active
    FROM public.warehouse_layout_positions AS p
   WHERE p.estoque = v_estoque
     AND p.modulo = v_modulo
     AND upper(btrim(p.posicao)) = v_posicao
   FOR SHARE;
  IF NOT FOUND OR v_position_active IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'PHYSICAL_POSITION_NOT_ACTIVE_OR_UNKNOWN' USING ERRCODE = '22023';
  END IF;

  SELECT l.ativo INTO v_module_active
    FROM public.warehouse_layout AS l
   WHERE l.estoque = v_estoque AND l.modulo = v_modulo
   FOR SHARE;
  IF FOUND AND v_module_active IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'PHYSICAL_MODULE_INACTIVE: %-%', v_estoque, v_modulo USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_current_count
    FROM public.slots AS s
   WHERE s.estoque = v_estoque AND s.modulo = v_modulo AND s.posicao = v_posicao;
  IF v_current_count <> jsonb_array_length(p_expected_slots) THEN
    RAISE EXCEPTION 'SLOT_SET_CONFLICT: conjunto do endereço foi alterado.' USING ERRCODE = '40001';
  END IF;

  FOR v_current_slot IN
    SELECT s.* FROM public.slots AS s
     WHERE s.estoque = v_estoque AND s.modulo = v_modulo AND s.posicao = v_posicao
     ORDER BY s.id FOR UPDATE
  LOOP
    SELECT e.value INTO v_expected_slot
      FROM jsonb_array_elements(p_expected_slots) AS e(value)
     WHERE e.value ->> 'id' = v_current_slot.id;
    IF NOT FOUND OR to_jsonb(v_current_slot) IS DISTINCT FROM v_expected_slot THEN
      RAISE EXCEPTION 'SLOT_CONFLICT: estado alterado (%).', v_current_slot.id USING ERRCODE = '40001';
    END IF;
  END LOOP;

  SELECT count(*) INTO v_current_count
    FROM public.divergencias AS d
   WHERE d.estoque = v_estoque AND d.modulo = v_modulo AND d.posicao = v_posicao
     AND lower(btrim(COALESCE(d.status, ''))) = 'aberta';
  IF v_current_count <> jsonb_array_length(p_expected_divergencias) THEN
    RAISE EXCEPTION 'DIVERGENCIA_SET_CONFLICT: divergências abertas foram alteradas.' USING ERRCODE = '40001';
  END IF;

  FOR v_current_divergencia IN
    SELECT d.* FROM public.divergencias AS d
     WHERE d.estoque = v_estoque AND d.modulo = v_modulo AND d.posicao = v_posicao
       AND lower(btrim(COALESCE(d.status, ''))) = 'aberta'
     ORDER BY d.id FOR UPDATE
  LOOP
    SELECT e.value INTO v_expected_divergencia
      FROM jsonb_array_elements(p_expected_divergencias) AS e(value)
     WHERE e.value ->> 'id' = v_current_divergencia.id;
    IF NOT FOUND
       OR (to_jsonb(v_current_divergencia) - 'status') IS DISTINCT FROM (v_expected_divergencia - 'status')
       OR lower(btrim(COALESCE(v_expected_divergencia ->> 'status', ''))) <> 'aberta' THEN
      RAISE EXCEPTION 'DIVERGENCIA_CONFLICT: registro alterado (%).', v_current_divergencia.id USING ERRCODE = '40001';
    END IF;
  END LOOP;

  FOR v_expected_divergencia IN
    SELECT e.value FROM jsonb_array_elements(p_expected_divergencias) AS e(value)
  LOOP
    SELECT n.value INTO v_history_item
      FROM jsonb_array_elements(p_divergencias) AS n(value)
     WHERE n.value ->> 'id' = v_expected_divergencia ->> 'id';
    IF (v_history_item ->> 'dataDivergencia') IS DISTINCT FROM (v_expected_divergencia ->> 'dataDivergencia')
       OR (v_history_item ->> 'tipoDivergencia') IS DISTINCT FROM (v_expected_divergencia ->> 'tipoDivergencia')
       OR (v_history_item ->> 'estoque') IS DISTINCT FROM (v_expected_divergencia ->> 'estoque')
       OR (v_history_item ->> 'modulo') IS DISTINCT FROM (v_expected_divergencia ->> 'modulo')
       OR (v_history_item ->> 'posicao') IS DISTINCT FROM (v_expected_divergencia ->> 'posicao')
       OR (v_history_item ->> 'refAtual') IS DISTINCT FROM (v_expected_divergencia ->> 'refAtual')
       OR (v_history_item ->> 'saldoAntes') IS DISTINCT FROM (v_expected_divergencia ->> 'saldoAntes')
       OR (v_history_item ->> 'movimentacao') IS DISTINCT FROM (v_expected_divergencia ->> 'movimentacao')
       OR (v_history_item ->> 'responsavel') IS DISTINCT FROM (v_expected_divergencia ->> 'responsavel')
       OR (v_history_item ->> 'dataChacote') IS DISTINCT FROM (v_expected_divergencia ->> 'dataChacote')
       OR (v_history_item ->> 'restricao') IS DISTINCT FROM (v_expected_divergencia ->> 'restricao') THEN
      RAISE EXCEPTION 'STALE_DIVERGENCIA_PAYLOAD: %', v_expected_divergencia ->> 'id' USING ERRCODE = '40001';
    END IF;
  END LOOP;

  UPDATE public.slots AS s
     SET estoque = v_final_slot.estoque,
         modulo = v_final_slot.modulo,
         posicao = v_final_slot.posicao,
         referencia = v_final_slot.referencia,
         descricao = v_final_slot.descricao,
         saldo = v_final_slot.saldo,
         "dataChacote" = v_final_slot."dataChacote",
         "ultimaData" = v_local_date,
         "ultimaHora" = v_local_time,
         "ultimoResponsavel" = v_actor_name,
         galpao = v_final_slot.galpao,
         restricao = v_final_slot.restricao,
         observacao = v_final_slot.observacao
   WHERE s.id = v_base_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PHYSICAL_ZERO_BASE_UPDATE_FAILED' USING ERRCODE = '40001';
  END IF;

  DELETE FROM public.slots AS s
   WHERE s.id = ANY(p_delete_slot_ids);
  GET DIAGNOSTICS v_slots_deleted = ROW_COUNT;
  IF v_slots_deleted <> cardinality(p_delete_slot_ids) THEN
    RAISE EXCEPTION 'PHYSICAL_ZERO_AUXILIARY_DELETE_COUNT_MISMATCH' USING ERRCODE = '40001';
  END IF;

  IF jsonb_array_length(p_history) > 0 THEN
    INSERT INTO public.history (
      id, "dataLancamento", "quemLancou", data, estoque, modulo, posicao,
      referencia, quantidade, tipo, "dataChacote", hora, responsavel,
      observacao, galpao, slot_id, restricao, "naturezaTransacao",
      "saldoAnterior", "saldoFinal", "correcaoId"
    )
    SELECT
      h.id, v_local_date, v_actor_name, v_local_date, h.estoque, h.modulo,
      h.posicao, h.referencia, h.quantidade, h.tipo, h."dataChacote", v_local_time,
      v_actor_name, h.observacao, h.galpao, h.slot_id, h.restricao,
      h."naturezaTransacao", h."saldoAnterior", h."saldoFinal", p_correction_id
    FROM jsonb_populate_recordset(NULL::public.history, p_history) AS h;
    GET DIAGNOSTICS v_history_written = ROW_COUNT;
  END IF;

  FOR v_expected_divergencia IN
    SELECT e.value FROM jsonb_array_elements(p_divergencias) AS e(value)
    ORDER BY e.value ->> 'id'
  LOOP
    SELECT r.* INTO v_new_divergencia
      FROM jsonb_populate_record(NULL::public.divergencias, v_expected_divergencia) AS r;
    UPDATE public.divergencias AS d
       SET "refNova" = v_new_divergencia."refNova",
           "saldoFinal" = v_new_divergencia."saldoFinal",
           status = 'Corrigida',
           "dataCorrecao" = v_local_date,
           "corrigidoPor" = v_actor_name,
           observacao = v_new_divergencia.observacao,
           "correcaoId" = v_new_divergencia."correcaoId"
     WHERE d.id = v_new_divergencia.id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'DIVERGENCIA_UPDATE_FAILED: %', v_new_divergencia.id USING ERRCODE = '40001';
    END IF;
    v_divergencias_written := v_divergencias_written + 1;
  END LOOP;

  IF v_history_written <> jsonb_array_length(p_history)
     OR v_divergencias_written <> jsonb_array_length(p_expected_divergencias) THEN
    RAISE EXCEPTION 'PHYSICAL_ZERO_WRITE_COUNT_MISMATCH' USING ERRCODE = '40001';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'alreadyApplied', false,
    'correctionId', p_correction_id,
    'slots_written', 1,
    'slots_deleted', v_slots_deleted,
    'history_written', v_history_written,
    'divergencias_written', v_divergencias_written,
    'effective_date', v_local_date,
    'effective_time', v_local_time,
    'actor_name', v_actor_name
  );
END;
$function$;

-- Keep these transactional writers available only to authenticated app sessions.
REVOKE ALL ON FUNCTION public.reconcile_physical_address_atomic(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reconcile_physical_address_atomic_with_deletes(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.resolve_stock_divergence_atomic(jsonb,jsonb,jsonb,jsonb,jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.zero_physical_divergence_address_atomic(boolean,uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reconcile_physical_address_atomic(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_physical_address_atomic_with_deletes(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_stock_divergence_atomic(jsonb,jsonb,jsonb,jsonb,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.zero_physical_divergence_address_atomic(boolean,uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text[]) TO authenticated;

COMMENT ON FUNCTION public.reconcile_physical_address_atomic(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)
  IS 'Correção física transacional; exige stock.physical_correction e, quando resolve divergências, divergences.resolve.';
COMMENT ON FUNCTION public.reconcile_physical_address_atomic_with_deletes(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text[])
  IS 'Correção física transacional com exclusão controlada de auxiliares; exige permissões de correção física e, quando aplicável, resolução de divergências.';
COMMENT ON FUNCTION public.resolve_stock_divergence_atomic(jsonb,jsonb,jsonb,jsonb,jsonb)
  IS 'Resolução transacional de divergências autorizada por divergences.resolve no backend.';
COMMENT ON FUNCTION public.zero_physical_divergence_address_atomic(boolean,uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text[])
  IS 'Zeramento físico integral E2/E3: confirmação explícita, snapshot exato, histórico consolidado por SKU/restrição, exclusão auxiliar seletiva e resolução atômica de divergências.';

COMMIT;
