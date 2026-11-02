-- Etapa 03 / B6.2A: gravação atômica e restrita dos metadados de slots.
-- Pré-requisito: B1 (permission foundation) aplicada no clone de integração.
-- Não altera saldo, SKU, identidade física, histórico ou divergências.
-- Ainda NÃO revoga DML direto; isso fica em B6.2B, após os testes de integração.

BEGIN;

DO $preflight$
DECLARE
  v_missing_column text;
BEGIN
  IF pg_catalog.to_regclass('public.slots') IS NULL THEN
    RAISE EXCEPTION 'PERMISSION_SLOT_METADATA_PREFLIGHT_TABLE_MISSING';
  END IF;

  IF pg_catalog.to_regprocedure('public.has_app_permission(text)') IS NULL THEN
    RAISE EXCEPTION 'PERMISSION_SLOT_METADATA_PREFLIGHT_FOUNDATION_MISSING';
  END IF;

  SELECT required.column_name
    INTO v_missing_column
  FROM (VALUES
    ('id'), ('estoque'), ('modulo'), ('posicao'), ('referencia'), ('descricao'),
    ('saldo'), ('dataChacote'), ('galpao'), ('restricao'), ('observacao')
  ) AS required(column_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = 'public.slots'::regclass
      AND a.attname = required.column_name
      AND a.attnum > 0
      AND NOT a.attisdropped
  )
  LIMIT 1;

  IF v_missing_column IS NOT NULL THEN
    RAISE EXCEPTION 'PERMISSION_SLOT_METADATA_PREFLIGHT_COLUMN_MISSING: %',
      v_missing_column;
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.update_slot_metadata_atomic(
  p_expected_slot jsonb,
  p_metadata jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_current public.slots%ROWTYPE;
  v_slot_id text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501';
  END IF;

  IF public.has_app_permission('map.metadata.edit') IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'PERMISSION_DENIED:map.metadata.edit' USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(p_expected_slot) IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_metadata) IS DISTINCT FROM 'object'
     OR (p_expected_slot ?& ARRAY[
       'id','estoque','modulo','posicao','referencia','descricao','saldo',
       'dataChacote','galpao','restricao','observacao'
     ]) IS NOT TRUE
     OR (p_metadata ?& ARRAY['dataChacote','galpao','restricao','observacao']) IS NOT TRUE
     OR (p_metadata - ARRAY['dataChacote','galpao','restricao','observacao']) <> '{}'::jsonb THEN
    RAISE EXCEPTION 'INVALID_SLOT_METADATA_PAYLOAD' USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(p_metadata -> 'dataChacote') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p_metadata -> 'galpao') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p_metadata -> 'restricao') IS DISTINCT FROM 'string'
     OR (jsonb_typeof(p_metadata -> 'observacao') IS DISTINCT FROM 'string'
         AND jsonb_typeof(p_metadata -> 'observacao') IS DISTINCT FROM 'null') THEN
    RAISE EXCEPTION 'INVALID_SLOT_METADATA_VALUE_TYPE' USING ERRCODE = '22023';
  END IF;

  IF coalesce(btrim(p_expected_slot ->> 'id'), '') = '' THEN
    RAISE EXCEPTION 'INVALID_SLOT_METADATA_ID' USING ERRCODE = '22023';
  END IF;

  IF p_metadata ->> 'galpao' NOT IN ('3', '12')
     OR p_metadata ->> 'restricao' NOT IN ('nenhuma', 'teste', 'autorizacao', 'outra')
     OR (p_metadata ->> 'galpao' = '12' AND p_metadata ->> 'restricao' <> 'autorizacao') THEN
    RAISE EXCEPTION 'INVALID_SLOT_METADATA_ENUM' USING ERRCODE = '22023';
  END IF;

  IF p_metadata ->> 'dataChacote' NOT IN ('', 'NT')
     AND (p_metadata ->> 'dataChacote') !~ '^\d{2}/\d{2}/\d{4}$' THEN
    RAISE EXCEPTION 'INVALID_SLOT_METADATA_CHACOTE' USING ERRCODE = '22023';
  END IF;

  v_slot_id := p_expected_slot ->> 'id';
  SELECT s.*
    INTO v_current
  FROM public.slots AS s
  WHERE s.id = v_slot_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SLOT_METADATA_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  -- Compare the complete metadata/editor snapshot and the stock-defining fields.
  -- A concurrent move, SKU/saldo change, or simultaneous metadata edit aborts.
  IF v_current.id IS DISTINCT FROM p_expected_slot ->> 'id'
     OR v_current.estoque IS DISTINCT FROM p_expected_slot ->> 'estoque'
     OR v_current.modulo IS DISTINCT FROM p_expected_slot ->> 'modulo'
     OR v_current.posicao IS DISTINCT FROM p_expected_slot ->> 'posicao'
     OR v_current.referencia IS DISTINCT FROM p_expected_slot ->> 'referencia'
     OR v_current.descricao IS DISTINCT FROM p_expected_slot ->> 'descricao'
     OR v_current.saldo::text IS DISTINCT FROM p_expected_slot ->> 'saldo'
     OR v_current."dataChacote" IS DISTINCT FROM p_expected_slot ->> 'dataChacote'
     OR v_current.galpao IS DISTINCT FROM p_expected_slot ->> 'galpao'
     OR v_current.restricao IS DISTINCT FROM p_expected_slot ->> 'restricao'
     OR v_current.observacao IS DISTINCT FROM p_expected_slot ->> 'observacao' THEN
    RAISE EXCEPTION 'SLOT_METADATA_CONFLICT' USING ERRCODE = '40001';
  END IF;

  UPDATE public.slots AS s
  SET "dataChacote" = p_metadata ->> 'dataChacote',
      galpao = p_metadata ->> 'galpao',
      restricao = p_metadata ->> 'restricao',
      observacao = p_metadata ->> 'observacao'
  WHERE s.id = v_current.id;

  RETURN jsonb_build_object(
    'success', true,
    'code', 'SLOT_METADATA_UPDATED',
    'id', v_current.id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.update_slot_metadata_atomic(jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_slot_metadata_atomic(jsonb, jsonb) TO authenticated;

COMMIT;
