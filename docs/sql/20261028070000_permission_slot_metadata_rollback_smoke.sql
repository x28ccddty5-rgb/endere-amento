\set ON_ERROR_STOP on

-- Este smoke test altera observacao temporariamente e termina com ROLLBACK.
-- As claims são somente de teste local; não usa credenciais nem Supabase Cloud.

BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :'production_id', true);
SELECT set_config('request.jwt.claims', jsonb_build_object('sub', :'production_id', 'role', 'authenticated')::text, true);
DO $production_denial$
DECLARE
  v_message text;
BEGIN
  BEGIN
    PERFORM public.update_slot_metadata_atomic('{}'::jsonb, '{}'::jsonb);
    RAISE EXCEPTION 'SMOKE_EXPECTED_PRODUCTION_DENIAL_NOT_RAISED';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message NOT LIKE 'PERMISSION_DENIED:map.metadata.edit%' THEN
      RAISE EXCEPTION 'SMOKE_UNEXPECTED_PRODUCTION_DENIAL: %', v_message;
    END IF;
  END;
  RAISE NOTICE 'PASS_PRODUCTION_DENIED|PERMISSION_DENIED:map.metadata.edit';
END;
$production_denial$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :'admin_id', true);
SELECT set_config('request.jwt.claims', jsonb_build_object('sub', :'admin_id', 'role', 'authenticated')::text, true);
SELECT set_config('app.permission_smoke_marker', :'marker', true);
DO $admin_update$
DECLARE
  v_before public.slots%ROWTYPE;
  v_after public.slots%ROWTYPE;
  v_payload jsonb;
  v_metadata jsonb;
  v_result jsonb;
  v_marker text := current_setting('app.permission_smoke_marker', true);
BEGIN
  SELECT s.*
    INTO v_before
  FROM public.slots AS s
  WHERE s.galpao::text IN ('3','12')
    AND s.restricao::text IN ('nenhuma','teste','autorizacao','outra')
    AND (s.galpao::text <> '12' OR s.restricao::text = 'autorizacao')
    AND (coalesce(s."dataChacote"::text,'') IN ('','NT')
      OR coalesce(s."dataChacote"::text,'') ~ '^\d{2}/\d{2}/\d{4}$')
  ORDER BY s.id
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SMOKE_NO_VALID_SLOT';
  END IF;

  v_payload := to_jsonb(v_before);
  v_metadata := jsonb_build_object(
    'dataChacote', coalesce(v_before."dataChacote"::text, ''),
    'galpao', v_before.galpao::text,
    'restricao', v_before.restricao::text,
    'observacao', v_marker
  );

  v_result := public.update_slot_metadata_atomic(v_payload, v_metadata);
  IF v_result ->> 'success' IS DISTINCT FROM 'true'
     OR v_result ->> 'code' IS DISTINCT FROM 'SLOT_METADATA_UPDATED'
     OR v_result ->> 'id' IS DISTINCT FROM v_before.id::text THEN
    RAISE EXCEPTION 'SMOKE_ADMIN_RPC_RESULT_UNEXPECTED: %', v_result;
  END IF;

  SELECT s.* INTO v_after FROM public.slots AS s WHERE s.id = v_before.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'SMOKE_SLOT_DISAPPEARED'; END IF;

  IF v_after."dataChacote"::text IS DISTINCT FROM coalesce(v_before."dataChacote"::text, '')
     OR v_after.galpao::text IS DISTINCT FROM v_before.galpao::text
     OR v_after.restricao::text IS DISTINCT FROM v_before.restricao::text
     OR v_after.observacao::text IS DISTINCT FROM v_marker THEN
    RAISE EXCEPTION 'SMOKE_METADATA_RESULT_UNEXPECTED';
  END IF;

  IF (to_jsonb(v_after) - ARRAY['dataChacote','galpao','restricao','observacao'])
     IS DISTINCT FROM
     (to_jsonb(v_before) - ARRAY['dataChacote','galpao','restricao','observacao']) THEN
    RAISE EXCEPTION 'SMOKE_NON_METADATA_FIELDS_CHANGED';
  END IF;

  RAISE NOTICE 'PASS_ADMIN_METADATA_UPDATED|%|SLOT_METADATA_UPDATED', v_before.id;
  RAISE NOTICE 'PASS_NON_METADATA_FIELDS_UNCHANGED|% ', v_before.id;
END;
$admin_update$;

SELECT 'PASS_MARKER_VISIBLE_BEFORE_ROLLBACK|' || count(*)::text
FROM public.slots WHERE observacao::text = :'marker';
ROLLBACK;
SELECT 'ROLLBACK|ADMIN_TRANSACTION_REVERTED';
