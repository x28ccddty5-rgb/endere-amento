-- Template: runner replaces __ADMIN_ID__ and __PRODUCTION_ID__ with UUIDs read from local profiles.
-- No data rows are written; all calls receive empty arrays and every transaction is rolled back.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '__PRODUCTION_ID__', true);
SELECT set_config('request.jwt.claims', jsonb_build_object('sub','__PRODUCTION_ID__','role','authenticated')::text, true);
DO $production$
DECLARE r jsonb;
BEGIN
  r := public.apply_stock_mutation_atomic('[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'launch');
  IF COALESCE((r->>'success')::boolean,true) IS NOT FALSE OR r->>'sqlstate' IS DISTINCT FROM '42501' OR r->>'code' IS DISTINCT FROM 'PERMISSION_DENIED' THEN
    RAISE EXCEPTION 'B7_1_SMOKE_PRODUCTION_LAUNCH_NOT_DENIED: %', r;
  END IF;
  r := public.apply_stock_mutation_atomic('[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'transfer');
  IF COALESCE((r->>'success')::boolean,true) IS NOT FALSE OR r->>'sqlstate' IS DISTINCT FROM '42501' OR r->>'code' IS DISTINCT FROM 'PERMISSION_DENIED' THEN
    RAISE EXCEPTION 'B7_1_SMOKE_PRODUCTION_TRANSFER_NOT_DENIED: %', r;
  END IF;
  r := public.apply_stock_mutation_atomic('[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'physical_correction');
  IF COALESCE((r->>'success')::boolean,true) IS NOT FALSE OR r->>'sqlstate' IS DISTINCT FROM '42501' OR r->>'code' IS DISTINCT FROM 'PERMISSION_DENIED' THEN
    RAISE EXCEPTION 'B7_1_SMOKE_PRODUCTION_CORRECTION_NOT_DENIED: %', r;
  END IF;
  r := public.apply_stock_mutation_atomic_with_deletes('[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,ARRAY[]::text[],'launch');
  IF COALESCE((r->>'success')::boolean,true) IS NOT FALSE OR r->>'sqlstate' IS DISTINCT FROM '42501' OR r->>'code' IS DISTINCT FROM 'PERMISSION_DENIED' THEN RAISE EXCEPTION 'B7_1_SMOKE_PRODUCTION_DELETE_LAUNCH_NOT_DENIED: %', r; END IF;
  r := public.apply_stock_mutation_atomic_with_deletes('[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,ARRAY[]::text[],'transfer');
  IF COALESCE((r->>'success')::boolean,true) IS NOT FALSE OR r->>'sqlstate' IS DISTINCT FROM '42501' OR r->>'code' IS DISTINCT FROM 'PERMISSION_DENIED' THEN RAISE EXCEPTION 'B7_1_SMOKE_PRODUCTION_DELETE_TRANSFER_NOT_DENIED: %', r; END IF;
  r := public.apply_stock_mutation_atomic_with_deletes('[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,ARRAY[]::text[],'physical_correction');
  IF COALESCE((r->>'success')::boolean,true) IS NOT FALSE OR r->>'sqlstate' IS DISTINCT FROM '42501' OR r->>'code' IS DISTINCT FROM 'PERMISSION_DENIED' THEN RAISE EXCEPTION 'B7_1_SMOKE_PRODUCTION_DELETE_CORRECTION_NOT_DENIED: %', r; END IF;
  RAISE NOTICE 'PASS_PRODUCTION_STOCK_MUTATIONS_DENIED';
END;
$production$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '__ADMIN_ID__', true);
SELECT set_config('request.jwt.claims', jsonb_build_object('sub','__ADMIN_ID__','role','authenticated')::text, true);
DO $admin$
DECLARE r jsonb;
BEGIN
  r := public.apply_stock_mutation_atomic('[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'launch');
  IF COALESCE((r->>'success')::boolean,true) IS NOT FALSE OR r->>'sqlstate' IS DISTINCT FROM '22023' THEN
    RAISE EXCEPTION 'B7_1_SMOKE_ADMIN_DID_NOT_REACH_PAYLOAD_VALIDATION_LAUNCH: %', r;
  END IF;
  r := public.apply_stock_mutation_atomic('[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'transfer');
  IF COALESCE((r->>'success')::boolean,true) IS NOT FALSE OR r->>'sqlstate' IS DISTINCT FROM '22023' THEN
    RAISE EXCEPTION 'B7_1_SMOKE_ADMIN_DID_NOT_REACH_TRANSFER_SHAPE_VALIDATION: %', r;
  END IF;
  r := public.apply_stock_mutation_atomic('[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'physical_correction');
  IF COALESCE((r->>'success')::boolean,true) IS NOT FALSE OR r->>'sqlstate' IS DISTINCT FROM '22023' THEN
    RAISE EXCEPTION 'B7_1_SMOKE_ADMIN_DID_NOT_REACH_CORRECTION_PAYLOAD_VALIDATION: %', r;
  END IF;
  r := public.apply_stock_mutation_atomic_with_deletes('[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,ARRAY[]::text[],'launch');
  IF COALESCE((r->>'success')::boolean,true) IS NOT FALSE OR r->>'sqlstate' IS DISTINCT FROM '22023' THEN RAISE EXCEPTION 'B7_1_SMOKE_ADMIN_DELETE_LAUNCH_DID_NOT_REACH_PAYLOAD_VALIDATION: %', r; END IF;
  r := public.apply_stock_mutation_atomic_with_deletes('[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,ARRAY[]::text[],'transfer');
  IF COALESCE((r->>'success')::boolean,true) IS NOT FALSE OR r->>'sqlstate' IS DISTINCT FROM '22023' THEN RAISE EXCEPTION 'B7_1_SMOKE_ADMIN_DELETE_TRANSFER_DID_NOT_REACH_PAYLOAD_VALIDATION: %', r; END IF;
  r := public.apply_stock_mutation_atomic_with_deletes('[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,ARRAY[]::text[],'physical_correction');
  IF COALESCE((r->>'success')::boolean,true) IS NOT FALSE OR r->>'sqlstate' IS DISTINCT FROM '22023' THEN RAISE EXCEPTION 'B7_1_SMOKE_ADMIN_DELETE_CORRECTION_DID_NOT_REACH_PAYLOAD_VALIDATION: %', r; END IF;
  RAISE NOTICE 'PASS_ADMIN_REACHED_PAYLOAD_VALIDATION';
END;
$admin$;
ROLLBACK;

SELECT 'PASS_B7_1_NO_DATA_MUTATED' AS result;
