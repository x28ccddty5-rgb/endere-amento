BEGIN;
SET LOCAL statement_timeout = '10s';

DO $test$
DECLARE
  v_admin uuid;
  v_production uuid;
  v_actor text;
  v_stock text := '2';
  v_module text := '987654320';
  v_position text := 'A1';
  v_layout_id text := 'B10-AUDIT-MODULE-987654320';
  v_divergence_id text := 'DIV-B10-AUDIT-MODULE-987654320-A1';
  v_payload jsonb;
  v_changed_payload jsonb;
  v_result jsonb;
  v_retry jsonb;
  v_message text;
BEGIN
  SELECT id, name INTO v_admin, v_actor
    FROM public.profiles
   WHERE role = 'administrador'
   ORDER BY id LIMIT 1;
  SELECT id INTO v_production
    FROM public.profiles
   WHERE role = 'producao'
   ORDER BY id LIMIT 1;

  IF v_admin IS NULL OR v_production IS NULL OR v_admin = v_production
     OR COALESCE(btrim(v_actor), '') = '' THEN
    RAISE EXCEPTION 'B10_SMOKE_REQUIRED_PROFILES_MISSING';
  END IF;

  IF EXISTS (SELECT 1 FROM public.warehouse_layout WHERE id = v_layout_id)
     OR EXISTS (SELECT 1 FROM public.divergencias WHERE id = v_divergence_id)
     OR EXISTS (SELECT 1 FROM public.slots WHERE estoque = v_stock AND modulo = v_module AND posicao = v_position)
     OR EXISTS (SELECT 1 FROM public.history WHERE estoque = v_stock AND modulo = v_module AND posicao = v_position) THEN
    RAISE EXCEPTION 'B10_SMOKE_FIXTURE_COLLISION';
  END IF;

  INSERT INTO public.warehouse_layout (id, estoque, modulo, capacidade, ativo)
  VALUES (v_layout_id, v_stock, v_module, 1, false);

  v_payload := jsonb_build_array(jsonb_build_object(
    'id', v_divergence_id,
    'dataDivergencia', to_char(clock_timestamp() AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD'),
    'tipoDivergencia', 'Módulo Inativo',
    'estoque', v_stock,
    'modulo', v_module,
    'posicao', v_position,
    'refAtual', '',
    'refNova', '71401G',
    'saldoAntes', 0,
    'movimentacao', 5,
    'saldoFinal', 0,
    'responsavel', v_actor,
    'status', 'Aberta',
    'dataChacote', '',
    'observacao', 'B10 smoke local; não houve movimentação.',
    'restricao', 'nenhuma'
  ));

  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  SELECT public.record_stock_conflict_divergences_atomic('launch', v_payload)
    INTO v_result;
  IF v_result ->> 'success' <> 'true'
     OR v_result ->> 'divergencias_written' <> '1'
     OR v_result ->> 'already_present' <> '0' THEN
    RAISE EXCEPTION 'B10_SMOKE_INSERT_FAILED: %', v_result;
  END IF;
  RAISE NOTICE 'PASS_CONFLICT_DIVERGENCE_INSERTED';

  SELECT public.record_stock_conflict_divergences_atomic('launch', v_payload)
    INTO v_retry;
  IF v_retry ->> 'success' <> 'true'
     OR v_retry ->> 'divergencias_written' <> '0'
     OR v_retry ->> 'already_present' <> '1' THEN
    RAISE EXCEPTION 'B10_SMOKE_IDEMPOTENT_RETRY_FAILED: %', v_retry;
  END IF;
  RAISE NOTICE 'PASS_CONFLICT_DIVERGENCE_IDEMPOTENT';

  v_changed_payload := jsonb_set(
    v_payload,
    '{0,observacao}',
    '"payload diferente"'::jsonb,
    true
  );
  BEGIN
    PERFORM public.record_stock_conflict_divergences_atomic('launch', v_changed_payload);
    RAISE EXCEPTION 'B10_SMOKE_EXPECTED_ID_CONFLICT_NOT_RAISED';
  EXCEPTION WHEN SQLSTATE '23505' THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message NOT LIKE 'DIVERGENCE_ID_CONFLICT:%' THEN
      RAISE EXCEPTION 'B10_SMOKE_UNEXPECTED_ID_CONFLICT: %', v_message;
    END IF;
    RAISE NOTICE 'PASS_CONFLICT_DIVERGENCE_CHANGED_ID_REJECTED';
  END;

  PERFORM set_config('request.jwt.claim.sub', v_production::text, true);
  BEGIN
    PERFORM public.record_stock_conflict_divergences_atomic('launch', v_payload);
    RAISE EXCEPTION 'B10_SMOKE_EXPECTED_PERMISSION_DENIAL_NOT_RAISED';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message <> 'PERMISSION_DENIED:stock.launch.create' THEN
      RAISE EXCEPTION 'B10_SMOKE_UNEXPECTED_PERMISSION_ERROR: %', v_message;
    END IF;
    RAISE NOTICE 'PASS_CONFLICT_DIVERGENCE_PERMISSION_ENFORCED';
  END;

  IF (SELECT count(*) FROM public.divergencias WHERE id = v_divergence_id) <> 1
     OR EXISTS (SELECT 1 FROM public.slots WHERE estoque = v_stock AND modulo = v_module AND posicao = v_position)
     OR EXISTS (SELECT 1 FROM public.history WHERE estoque = v_stock AND modulo = v_module AND posicao = v_position) THEN
    RAISE EXCEPTION 'B10_SMOKE_STOCK_OR_HISTORY_WAS_MODIFIED';
  END IF;
  RAISE NOTICE 'PASS_CONFLICT_ROUTE_DID_NOT_TOUCH_STOCK_OR_HISTORY';
END;
$test$;

ROLLBACK;
