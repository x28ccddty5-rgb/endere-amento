CREATE OR REPLACE FUNCTION public.resolve_stock_divergence_atomic(p_expected_slots jsonb, p_slots jsonb, p_history jsonb, p_expected_divergencias jsonb, p_divergencias jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
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
  -- Requer sessão válida e perfil operacional. RLS permanece habilitado.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.has_app_role(
    ARRAY['administrador', 'lideranca', 'apoio', 'producao']::text[]
  ) THEN
    RAISE EXCEPTION 'OPERATION_NOT_ALLOWED'
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

  -- Uma correção fecha ao menos uma divergência existente. Limites protegem
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

  -- IDs vazios ou repetidos no payload são rejeitados, nunca consolidados silenciosamente.
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

  -- Toda posição antiga validada precisa aparecer também no payload novo.
  -- Isso evita confirmar divergências/histórico sem gravar a posição validada.
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

  -- O histórico é append-only: IDs vazios ou repetidos são inválidos.
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

  -- Divergências recebidas para atualização devem corresponder exatamente
  -- às divergências originais enviadas para validação.
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

  -- Trava e compara cada posição original. Se um saldo/registro mudou desde
  -- a leitura do operador, toda a operação é abortada sem gravar nenhuma parte.
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
        'message', format('SLOT_CONFLICT: posição removida ou não encontrada (%s).', v_id),
        'slot_id', v_id
      );
    END IF;

    IF to_jsonb(v_current_slot) IS DISTINCT FROM v_expected_json THEN
      RETURN jsonb_build_object(
        'success', false,
        'conflict', true,
        'code', 'SLOT_CONFLICT',
        'message', format('SLOT_CONFLICT: posição alterada por outro usuário (%s).', v_id),
        'slot_id', v_id
      );
    END IF;

    v_expected_slot_ids := array_append(v_expected_slot_ids, v_id);
  END LOOP;

  -- Trava divergências em ordem determinística. Elas precisam continuar abertas
  -- e iguais ao estado que o operador consultou (exceto caixa do campo status).
  FOR v_expected_json IN
    SELECT e.value
    FROM jsonb_array_elements(p_expected_divergencias) AS e(value)
    ORDER BY e.value ->> 'id'
  LOOP
    v_id := v_expected_json ->> 'id';

    IF lower(trim(COALESCE(v_expected_json ->> 'status', ''))) <> 'aberta' THEN
      RAISE EXCEPTION 'DIVERGENCIA_CONFLICT: a tela não enviou uma divergência aberta (%).', v_id
        USING ERRCODE = '40001';
    END IF;

    SELECT d.*
      INTO v_current_divergencia
      FROM public.divergencias AS d
     WHERE d.id = v_id
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'DIVERGENCIA_CONFLICT: divergência removida (%).', v_id
        USING ERRCODE = '40001';
    END IF;

    IF lower(trim(COALESCE(v_current_divergencia.status, ''))) <> 'aberta' THEN
      RAISE EXCEPTION 'DIVERGENCIA_CONFLICT: divergência já resolvida (%).', v_id
        USING ERRCODE = '40001';
    END IF;

    IF (to_jsonb(v_current_divergencia) - 'status')
         IS DISTINCT FROM (v_expected_json - 'status') THEN
      RAISE EXCEPTION 'DIVERGENCIA_CONFLICT: registro alterado por outro usuário (%).', v_id
        USING ERRCODE = '40001';
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
        RAISE EXCEPTION 'SLOT_CONFLICT: falha ao atualizar posição (%).', v_new_slot.id
          USING ERRCODE = '40001';
      END IF;
    ELSE
      IF EXISTS (SELECT 1 FROM public.slots AS s WHERE s.id = v_new_slot.id) THEN
        RAISE EXCEPTION 'SLOT_CONFLICT: novo ID já existe (%).', v_new_slot.id
          USING ERRCODE = '40001';
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

  -- O histórico é append-only. Falha em qualquer registro reverte também
  -- as atualizações de slots e divergências desta mesma chamada RPC.
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

  -- Esta RPC é exclusiva para resolver divergências existentes. Não insere
  -- nem reabre divergências; cada uma deve mudar de Aberta para Corrigida.
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

    -- Campos que definem a origem da divergência não podem ser reescritos
    -- por uma correção com dados antigos. Só são editáveis os campos de
    -- resolução: status, refNova, saldoFinal, dataCorrecao, corrigidoPor,
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
        USING ERRCODE = '40001';
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
        USING ERRCODE = '40001';
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
$function$
