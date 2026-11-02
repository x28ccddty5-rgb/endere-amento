BEGIN;
SET LOCAL statement_timeout = '10s';

DO $test$
DECLARE
  v_admin uuid;
  v_module_id text := '2-987654321';
  v_position_id text := '2-987654321-A1';
  v_module_expected jsonb;
  v_position_expected jsonb;
  v_result jsonb;
  v_count integer;
BEGIN
  SELECT id INTO v_admin
  FROM public.profiles
  WHERE role = 'administrador'
  ORDER BY id
  LIMIT 1;

  IF v_admin IS NULL THEN
    RAISE EXCEPTION 'LAYOUT_TEST_ADMIN_MISSING';
  END IF;

  IF EXISTS (
       SELECT 1 FROM public.warehouse_layout
       WHERE id = v_module_id OR (estoque = '2' AND modulo = '987654321')
     ) OR EXISTS (
       SELECT 1 FROM public.warehouse_layout_positions
       WHERE id = v_position_id OR (estoque = '2' AND modulo = '987654321')
     ) OR EXISTS (
       SELECT 1 FROM public.slots
       WHERE estoque = '2' AND modulo = '987654321'
     ) THEN
    RAISE EXCEPTION 'LAYOUT_TEST_FIXTURE_COLLISION';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);

  -- Cria módulo sintético pelo escritor atômico existente.
  SELECT public.save_warehouse_layout_atomic(
    '[]'::jsonb,
    jsonb_build_array(jsonb_build_object(
      'id', v_module_id,
      'estoque', '2',
      'modulo', '987654321',
      'capacidade', 10,
      'ativo', true
    ))
  ) INTO v_result;

  IF v_result ->> 'success' <> 'true'
     OR jsonb_array_length(v_result -> 'rows') <> 1 THEN
    RAISE EXCEPTION 'LAYOUT_MODULE_INSERT_FAILED: %', v_result;
  END IF;
  RAISE NOTICE 'PASS_MODULE_SAVED_THROUGH_ATOMIC_RPC';

  SELECT to_jsonb(l) INTO v_module_expected
  FROM public.warehouse_layout l
  WHERE l.id = v_module_id;

  -- Atualiza usando o snapshot exato retornado pelo banco.
  SELECT public.save_warehouse_layout_atomic(
    jsonb_build_array(v_module_expected),
    jsonb_build_array(jsonb_build_object(
      'id', v_module_id,
      'estoque', '2',
      'modulo', '987654321',
      'capacidade', 11,
      'ativo', true
    ))
  ) INTO v_result;

  IF v_result ->> 'success' <> 'true'
     OR (SELECT capacidade FROM public.warehouse_layout WHERE id = v_module_id) <> 11 THEN
    RAISE EXCEPTION 'LAYOUT_MODULE_UPDATE_FAILED: %', v_result;
  END IF;
  RAISE NOTICE 'PASS_MODULE_SNAPSHOT_UPDATE';

  -- Cria a posição física pelo segundo escritor atômico.
  SELECT public.save_warehouse_positions_atomic(
    '[]'::jsonb,
    jsonb_build_array(jsonb_build_object(
      'id', v_position_id,
      'estoque', '2',
      'modulo', '987654321',
      'posicao', 'A1',
      'ativo', true
    ))
  ) INTO v_result;

  IF v_result ->> 'success' <> 'true'
     OR jsonb_array_length(v_result -> 'rows') <> 1 THEN
    RAISE EXCEPTION 'LAYOUT_POSITION_INSERT_FAILED: %', v_result;
  END IF;
  RAISE NOTICE 'PASS_POSITION_SAVED_THROUGH_ATOMIC_RPC';

  SELECT to_jsonb(p) INTO v_position_expected
  FROM public.warehouse_layout_positions p
  WHERE p.id = v_position_id;

  -- Desativa somente a posição sintética, sem slots nem saldo.
  SELECT public.save_warehouse_positions_atomic(
    jsonb_build_array(v_position_expected),
    jsonb_build_array(jsonb_build_object(
      'id', v_position_id,
      'estoque', '2',
      'modulo', '987654321',
      'posicao', 'A1',
      'ativo', false
    ))
  ) INTO v_result;

  IF v_result ->> 'success' <> 'true'
     OR (SELECT ativo FROM public.warehouse_layout_positions WHERE id = v_position_id) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'LAYOUT_POSITION_UPDATE_FAILED: %', v_result;
  END IF;
  RAISE NOTICE 'PASS_POSITION_SNAPSHOT_UPDATE';

  SELECT count(*) INTO v_count
  FROM public.slots
  WHERE estoque = '2' AND modulo = '987654321';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'LAYOUT_TEST_TOUCHED_STOCK_ROWS';
  END IF;
  RAISE NOTICE 'PASS_NO_STOCK_ROWS_TOUCHED';
END;
$test$;

ROLLBACK;
