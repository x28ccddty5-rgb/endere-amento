-- B7.1 rollback. First roll back src/App.tsx to the caller using untyped RPCs.
BEGIN;
DO $preflight$
BEGIN
  IF to_regprocedure('public.apply_stock_mutation_atomic(jsonb,jsonb,jsonb,jsonb,jsonb,text)') IS NULL
     OR to_regprocedure('public.apply_stock_mutation_atomic_with_deletes(jsonb,jsonb,jsonb,jsonb,jsonb,text[],text)') IS NULL THEN
    RAISE EXCEPTION 'B7_1_TYPED_WRITERS_MISSING';
  END IF;
END;
$preflight$;
REVOKE ALL ON FUNCTION public.apply_stock_mutation_atomic(jsonb,jsonb,jsonb,jsonb,jsonb,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_stock_mutation_atomic_with_deletes(jsonb,jsonb,jsonb,jsonb,jsonb,text[],text) FROM PUBLIC, anon, authenticated;
DROP FUNCTION public.apply_stock_mutation_atomic(jsonb,jsonb,jsonb,jsonb,jsonb,text);
DROP FUNCTION public.apply_stock_mutation_atomic_with_deletes(jsonb,jsonb,jsonb,jsonb,jsonb,text[]);
CREATE OR REPLACE FUNCTION public.apply_stock_mutation_atomic(p_expected_slots jsonb, p_slots jsonb, p_expected_divergencias jsonb, p_divergencias jsonb, p_history jsonb)
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
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_app_role(ARRAY['administrador','lideranca','apoio','producao']::text[]) THEN
    RAISE EXCEPTION 'OPERATION_NOT_ALLOWED' USING ERRCODE = '42501';
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
$function$

CREATE OR REPLACE FUNCTION public.apply_stock_mutation_atomic_with_deletes(p_expected_slots jsonb, p_slots jsonb, p_expected_divergencias jsonb, p_divergencias jsonb, p_history jsonb, p_delete_slot_ids text[])
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
  IF NOT public.has_app_role(ARRAY['administrador','lideranca','apoio','producao']::text[]) THEN
    RAISE EXCEPTION 'OPERATION_NOT_ALLOWED' USING ERRCODE = '42501';
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
    p_expected_slots, v_staged_slots, p_expected_divergencias, p_divergencias, p_history
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
  WHEN SQLSTATE '40001' THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    RETURN jsonb_build_object('success',false,'conflict',true,'code',split_part(v_message,':',1),'message','O estado do endereço mudou durante a exclusão atômica. A transação foi revertida; recarregue o endereço.','slots_deleted',0);
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
    RETURN jsonb_build_object('success',false,'conflict',false,'code',split_part(v_message,':',1),'sqlstate',v_sqlstate,'message','A transação de estoque foi revertida. Nenhuma exclusão foi confirmada; recarregue e confira o endereço.','slots_deleted',0);
END;
$function$

REVOKE ALL ON FUNCTION public.apply_stock_mutation_atomic(jsonb,jsonb,jsonb,jsonb,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_stock_mutation_atomic(jsonb,jsonb,jsonb,jsonb,jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.apply_stock_mutation_atomic_with_deletes(jsonb,jsonb,jsonb,jsonb,jsonb,text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_stock_mutation_atomic_with_deletes(jsonb,jsonb,jsonb,jsonb,jsonb,text[]) TO authenticated;
COMMIT;
