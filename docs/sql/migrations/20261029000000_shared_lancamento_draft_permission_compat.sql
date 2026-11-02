-- COMPATIBILIDADE DO LOTE COMPARTILHADO COM A ARQUITETURA B1/B2 + B7.1
--
-- Alvo inicial obrigatório: banco LOCAL de integração PostgreSQL 17.
-- Derivada da migration histórica docs/sql/20261024_shared_lancamento_draft.sql.
-- Preserva tabelas, RPCs, idempotência, revisão do rascunho e locks da versão histórica.
-- Corrige os guards de autorização para public.has_app_permission(...) e chama
-- exclusivamente os escritores tipados de B7.1 com p_operation_type = 'launch'.
--
-- NÃO executar em Supabase Cloud/produção. Não aplicar junto com a migration histórica.
-- Pré-requisitos: foundation B1/B2, RPCs tipadas B7.1 e schema operacional compatível.
-- A migration copia lancamento_drafts para quarentena, sem apagar nem importar o legado.

BEGIN;
SET LOCAL lock_timeout = '5s';
LOCK TABLE public.lancamento_drafts IN SHARE MODE;

DO $migration_preflight$
DECLARE
  v_name text;
BEGIN
  IF to_regclass('public.lancamento_drafts') IS NULL THEN
    RAISE EXCEPTION 'MIGRATION_PREFLIGHT_FAILED: public.lancamento_drafts missing; no change will be committed.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname = ANY (ARRAY[
      'lancamento_draft_legacy_quarantine','lancamento_draft_control',
      'lancamento_draft_lines','lancamento_draft_archive_lines','lancamento_batch_runs'
    ])
  ) THEN
    RAISE EXCEPTION 'MIGRATION_PREFLIGHT_FAILED: a candidate table already exists; inspect before retrying.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname = ANY (ARRAY[
      'get_shared_lancamento_draft','upsert_shared_lancamento_draft_lines',
      'delete_shared_lancamento_draft_line','clear_shared_lancamento_draft',
      'get_shared_lancamento_batch_result','shared_draft_slot_identity_is_inconsistent',
      'process_shared_lancamento_draft_batch_atomic'
    ])
  ) THEN
    RAISE EXCEPTION 'MIGRATION_PREFLIGHT_FAILED: a candidate function name already exists; inspect before retrying.';
  END IF;
END;
$migration_preflight$;

DO $compatibility_preflight$
DECLARE
  v_missing_columns integer;
  v_permission_count integer;
  v_legacy_columns integer;
BEGIN
  IF to_regprocedure('public.has_app_permission(text)') IS NULL THEN
    RAISE EXCEPTION 'COMPATIBILITY_PREFLIGHT_FAILED: has_app_permission(text) missing; apply B1/B2 foundation locally first.';
  END IF;

  SELECT count(*) INTO v_permission_count
  FROM public.permission_catalog
  WHERE is_active IS TRUE
    AND permission_key = ANY (ARRAY['stock.launch.view','stock.launch.create','stock.batch.process']);
  IF v_permission_count <> 3 THEN
    RAISE EXCEPTION 'COMPATIBILITY_PREFLIGHT_FAILED: required launch permission keys are missing or inactive.';
  END IF;

  IF to_regprocedure('public.apply_stock_mutation_atomic(jsonb,jsonb,jsonb,jsonb,jsonb,text)') IS NULL
     OR to_regprocedure('public.apply_stock_mutation_atomic_with_deletes(jsonb,jsonb,jsonb,jsonb,jsonb,text[],text)') IS NULL THEN
    RAISE EXCEPTION 'COMPATIBILITY_PREFLIGHT_FAILED: B7.1 typed stock writers are missing.';
  END IF;

  IF to_regprocedure('public.stock_address_lock_key(text,text,text)') IS NULL
     OR to_regprocedure('auth.uid()') IS NULL
     OR to_regclass('public.profiles') IS NULL
     OR to_regclass('public.slots') IS NULL
     OR to_regclass('public.divergencias') IS NULL
     OR to_regclass('public.warehouse_layout') IS NULL THEN
    RAISE EXCEPTION 'COMPATIBILITY_PREFLIGHT_FAILED: one or more operational dependencies are missing.';
  END IF;

  SELECT count(*) INTO v_legacy_columns
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'lancamento_drafts'
    AND ((column_name = 'user_id' AND data_type = 'uuid')
      OR (column_name = 'rows' AND data_type = 'jsonb')
      OR (column_name = 'updated_at' AND data_type = 'timestamp with time zone'));
  IF v_legacy_columns <> 3 THEN
    RAISE EXCEPTION 'COMPATIBILITY_PREFLIGHT_FAILED: lancamento_drafts does not match the inspected legacy contract.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
    RAISE EXCEPTION 'COMPATIBILITY_PREFLIGHT_FAILED: expected Supabase database roles are missing.';
  END IF;

  -- Verify every column referenced by the shared-batch SQL before any DDL is issued.
  SELECT count(*) INTO v_missing_columns
  FROM (VALUES
    ('profiles','id'),('profiles','name'),
    ('slots','id'),('slots','estoque'),('slots','modulo'),('slots','posicao'),
    ('slots','referencia'),('slots','saldo'),('slots','restricao'),
    ('divergencias','id'),('divergencias','dataDivergencia'),('divergencias','tipoDivergencia'),
    ('divergencias','estoque'),('divergencias','modulo'),('divergencias','posicao'),
    ('divergencias','refAtual'),('divergencias','refNova'),('divergencias','saldoAntes'),
    ('divergencias','movimentacao'),('divergencias','saldoFinal'),('divergencias','responsavel'),
    ('divergencias','status'),('divergencias','dataChacote'),('divergencias','dataCorrecao'),
    ('divergencias','corrigidoPor'),('divergencias','observacao'),('divergencias','slot_id'),
    ('divergencias','restricao'),('divergencias','correcaoId'),
    ('warehouse_layout','estoque'),('warehouse_layout','modulo'),('warehouse_layout','ativo')
  ) AS required(table_name, column_name)
  LEFT JOIN information_schema.columns actual
    ON actual.table_schema = 'public'
   AND actual.table_name = required.table_name
   AND actual.column_name = required.column_name
  WHERE actual.column_name IS NULL;
  IF v_missing_columns <> 0 THEN
    RAISE EXCEPTION 'COMPATIBILITY_PREFLIGHT_FAILED: % required operational columns are missing.', v_missing_columns;
  END IF;
END;
$compatibility_preflight$;

CREATE TABLE IF NOT EXISTS public.lancamento_draft_legacy_quarantine (
  -- No auth.users FK: this is archival data and must still preserve a draft
  -- if its account was deleted before the migration.
  user_id uuid PRIMARY KEY,
  rows jsonb NOT NULL,
  row_count integer NOT NULL CHECK (row_count >= 0),
  source_updated_at timestamptz NOT NULL,
  quarantined_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- Preserve existing per-user drafts exactly as found, but never import them into
-- the new shared active draft automatically. ON CONFLICT keeps the first archive.
INSERT INTO public.lancamento_draft_legacy_quarantine (
  user_id, rows, row_count, source_updated_at, quarantined_at
)
SELECT d.user_id, d.rows, CASE WHEN jsonb_typeof(d.rows) = 'array' THEN jsonb_array_length(d.rows) ELSE 0 END, d.updated_at, clock_timestamp()
FROM public.lancamento_drafts AS d
ON CONFLICT (user_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.lancamento_draft_control (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton IS TRUE),
  generation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  next_sequence bigint NOT NULL DEFAULT 1 CHECK (next_sequence >= 1),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  -- Actor IDs are audit metadata, not ownership links; deleting an auth account
  -- must not be blocked by the last editor of the shared singleton.
  updated_by uuid NULL
);

INSERT INTO public.lancamento_draft_control (singleton)
VALUES (true)
ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.lancamento_draft_lines (
  generation_id uuid NOT NULL,
  line_id text NOT NULL,
  sequence bigint NOT NULL CHECK (sequence >= 1),
  row_data jsonb NOT NULL CHECK (jsonb_typeof(row_data) = 'object'),
  line_revision bigint NOT NULL DEFAULT 1 CHECK (line_revision >= 1),
  -- Keep actor UUIDs without auth.users FKs so user deletion cannot block a
  -- shared draft; immutable archives preserve the same audit identifiers.
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (generation_id, line_id),
  UNIQUE (generation_id, sequence),
  CHECK (line_id <> ''),
  CHECK (row_data->>'id' = line_id)
);

CREATE INDEX IF NOT EXISTS lancamento_draft_lines_generation_sequence_idx
  ON public.lancamento_draft_lines (generation_id, sequence);

CREATE TABLE IF NOT EXISTS public.lancamento_draft_archive_lines (
  line_id text PRIMARY KEY,
  generation_id uuid NOT NULL,
  sequence bigint NOT NULL CHECK (sequence >= 1),
  row_data jsonb NOT NULL CHECK (jsonb_typeof(row_data) = 'object'),
  disposition text NOT NULL CHECK (disposition IN ('processed', 'discarded', 'ignored')),
  batch_id uuid NULL,
  -- Historical actor IDs are retained without auth.users FKs so account deletion
  -- cannot erase or become blocked by immutable audit records.
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  archived_by uuid NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (row_data->>'id' = line_id)
);

CREATE INDEX IF NOT EXISTS lancamento_draft_archive_batch_idx
  ON public.lancamento_draft_archive_lines (batch_id)
  WHERE batch_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.lancamento_batch_runs (
  batch_id uuid PRIMARY KEY,
  generation_id uuid NOT NULL UNIQUE,
  draft_revision bigint NOT NULL CHECK (draft_revision >= 0),
  -- Keep the historical actor UUID even if that account is removed later.
  executed_by uuid NOT NULL,
  result_summary jsonb NOT NULL CHECK (jsonb_typeof(result_summary) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE public.lancamento_draft_legacy_quarantine ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lancamento_draft_control ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lancamento_draft_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lancamento_draft_archive_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lancamento_batch_runs ENABLE ROW LEVEL SECURITY;

-- Direct table access is deliberately denied. Authenticated operators use guarded RPCs only.
REVOKE ALL ON TABLE public.lancamento_draft_legacy_quarantine FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.lancamento_draft_control FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.lancamento_draft_lines FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.lancamento_draft_archive_lines FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.lancamento_batch_runs FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_shared_lancamento_draft()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_control public.lancamento_draft_control%ROWTYPE;
  v_lines jsonb;
BEGIN
  -- Visualizador pode consultar o rascunho porque a tela de lançamento está
  -- liberada em modo somente leitura. As RPCs de escrita/processamento seguem
  -- restritas a administrador, liderança e apoio.
  IF auth.uid() IS NULL OR public.has_app_permission('stock.launch.view') IS DISTINCT FROM TRUE THEN
    RETURN jsonb_build_object('success', false, 'code', 'OPERATION_NOT_ALLOWED');
  END IF;

  -- Keep the generation/revision stable while the matching lines are read.
  -- All writers take FOR UPDATE on this row, so this snapshot cannot combine
  -- control metadata from before a batch with line data from after it.
  SELECT c.* INTO v_control
  FROM public.lancamento_draft_control AS c
  WHERE c.singleton IS TRUE
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SHARED_DRAFT_CONTROL_MISSING';
  END IF;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'line_id', l.line_id,
        'row_data', l.row_data,
        'line_revision', l.line_revision,
        'sequence', l.sequence
      ) ORDER BY l.sequence
    ), '[]'::jsonb
  ) INTO v_lines
  FROM public.lancamento_draft_lines AS l
  WHERE l.generation_id = v_control.generation_id;

  RETURN jsonb_build_object(
    'success', true,
    'generation_id', v_control.generation_id,
    'revision', v_control.revision,
    'lines', v_lines
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.upsert_shared_lancamento_draft_lines(
  p_generation_id uuid,
  p_lines jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_control public.lancamento_draft_control%ROWTYPE;
  v_target_generation_id uuid;
  v_line jsonb;
  v_line_id text;
  v_row_data jsonb;
  v_expected_revision bigint;
  v_existing public.lancamento_draft_lines%ROWTYPE;
  v_next_sequence bigint;
  v_new_revision bigint;
  v_current_line_count bigint;
  v_incoming_new_count bigint;
  v_changed boolean := false;
  v_line_results jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL OR public.has_app_permission('stock.launch.create') IS DISTINCT FROM TRUE THEN
    RETURN jsonb_build_object('success', false, 'code', 'OPERATION_NOT_ALLOWED');
  END IF;
  IF p_generation_id IS NULL OR jsonb_typeof(p_lines) IS DISTINCT FROM 'array' THEN
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_DRAFT_LINES_PAYLOAD');
  END IF;
  IF jsonb_array_length(p_lines) > 5000 THEN
    RETURN jsonb_build_object('success', false, 'code', 'DRAFT_LINES_PAYLOAD_TOO_LARGE');
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_lines) AS item(value)
    WHERE jsonb_typeof(item.value) IS DISTINCT FROM 'object'
       OR coalesce(item.value->>'line_id','') = ''
       OR jsonb_typeof(item.value->'row_data') IS DISTINCT FROM 'object'
       OR item.value->>'line_id' IS DISTINCT FROM item.value->'row_data'->>'id'
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_lines) AS item(value)
    GROUP BY item.value->>'line_id' HAVING count(*) > 1
  ) THEN
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_OR_DUPLICATE_DRAFT_LINE');
  END IF;

  SELECT c.* INTO v_control
  FROM public.lancamento_draft_control AS c
  WHERE c.singleton IS TRUE
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SHARED_DRAFT_CONTROL_MISSING';
  END IF;
  v_target_generation_id := v_control.generation_id;
  IF v_control.generation_id IS DISTINCT FROM p_generation_id THEN
    -- New lines that lost the race with batch finalization are safe to place in
    -- the next active draft. Edits to old lines remain conflicts, because the
    -- old row may already have been processed from a prior snapshot.
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_lines) AS item(value)
      WHERE nullif(item.value->>'expected_line_revision','') IS NOT NULL
    ) THEN
      RETURN jsonb_build_object('success', false, 'conflict', true, 'code', 'DRAFT_GENERATION_CONFLICT');
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_lines) AS item(value)
      JOIN public.lancamento_draft_archive_lines AS a ON a.line_id = item.value->>'line_id'
    ) THEN
      RETURN jsonb_build_object('success', false, 'conflict', true, 'code', 'DRAFT_LINE_ALREADY_ARCHIVED');
    END IF;
  END IF;

  -- Validate the complete request before writing any row.
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    v_line_id := v_line->>'line_id';
    v_row_data := v_line->'row_data';
    v_expected_revision := nullif(v_line->>'expected_line_revision','')::bigint;

    SELECT l.* INTO v_existing
    FROM public.lancamento_draft_lines AS l
    WHERE l.generation_id = v_target_generation_id AND l.line_id = v_line_id;

    IF FOUND THEN
      -- A new-line save may have committed even if its response was lost. If the
      -- same line ID and exact payload are already present, treat the repeat as
      -- idempotent success. Reusing the ID with different contents still conflicts.
      IF v_expected_revision IS NULL THEN
        IF v_existing.row_data IS DISTINCT FROM v_row_data THEN
          RETURN jsonb_build_object(
            'success', false, 'conflict', true, 'code', 'DRAFT_LINE_CONFLICT',
            'line_id', v_line_id, 'current_line_revision', v_existing.line_revision
          );
        END IF;
      ELSIF v_expected_revision <> v_existing.line_revision THEN
        RETURN jsonb_build_object(
          'success', false, 'conflict', true, 'code', 'DRAFT_LINE_CONFLICT',
          'line_id', v_line_id, 'current_line_revision', v_existing.line_revision
        );
      END IF;
    ELSE
      IF v_expected_revision IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'conflict', true, 'code', 'DRAFT_LINE_MISSING', 'line_id', v_line_id);
      END IF;
      IF EXISTS (SELECT 1 FROM public.lancamento_draft_archive_lines a WHERE a.line_id = v_line_id) THEN
        RETURN jsonb_build_object('success', false, 'conflict', true, 'code', 'DRAFT_LINE_ALREADY_ARCHIVED', 'line_id', v_line_id);
      END IF;
    END IF;
  END LOOP;

  -- The batch RPC has the same 5,000-line limit. Enforce that cap across all
  -- incremental save calls, otherwise the UI could create a draft that can no
  -- longer be processed by the batch RPC.
  SELECT count(*) INTO v_current_line_count
  FROM public.lancamento_draft_lines AS l
  WHERE l.generation_id = v_target_generation_id;
  SELECT count(*) INTO v_incoming_new_count
  FROM jsonb_array_elements(p_lines) AS item(value)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.lancamento_draft_lines AS l
    WHERE l.generation_id = v_target_generation_id
      AND l.line_id = item.value->>'line_id'
  );
  IF v_current_line_count + v_incoming_new_count > 5000 THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'DRAFT_TOTAL_CAPACITY_EXCEEDED',
      'message', 'O rascunho compartilhado atingiu o limite de 5.000 linhas ativas. Remova ou descarte linhas antes de acrescentar novas.',
      'max_lines', 5000,
      'current_lines', v_current_line_count,
      'requested_new_lines', v_incoming_new_count
    );
  END IF;

  v_next_sequence := v_control.next_sequence;
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    v_line_id := v_line->>'line_id';
    v_row_data := v_line->'row_data';
    v_expected_revision := nullif(v_line->>'expected_line_revision','')::bigint;

    SELECT l.* INTO v_existing
    FROM public.lancamento_draft_lines AS l
    WHERE l.generation_id = v_target_generation_id AND l.line_id = v_line_id;

    IF FOUND THEN
      IF v_existing.row_data IS DISTINCT FROM v_row_data THEN
        UPDATE public.lancamento_draft_lines AS l
        SET row_data = v_row_data,
            line_revision = l.line_revision + 1,
            updated_by = auth.uid(),
            updated_at = clock_timestamp()
        WHERE l.generation_id = v_target_generation_id AND l.line_id = v_line_id
        RETURNING l.* INTO v_existing;
        v_changed := true;
      END IF;
    ELSE
      INSERT INTO public.lancamento_draft_lines (
        generation_id, line_id, sequence, row_data, line_revision,
        created_by, updated_by, created_at, updated_at
      ) VALUES (
        v_target_generation_id, v_line_id, v_next_sequence, v_row_data, 1,
        auth.uid(), auth.uid(), clock_timestamp(), clock_timestamp()
      ) RETURNING * INTO v_existing;
      v_next_sequence := v_next_sequence + 1;
      v_changed := true;
    END IF;

    v_line_results := v_line_results || jsonb_build_array(jsonb_build_object(
      'line_id', v_existing.line_id,
      'line_revision', v_existing.line_revision,
      'sequence', v_existing.sequence,
      'row_data', v_existing.row_data
    ));
  END LOOP;

  v_new_revision := v_control.revision;
  IF v_changed THEN
    v_new_revision := v_control.revision + 1;
    UPDATE public.lancamento_draft_control AS c
    SET revision = v_new_revision,
        next_sequence = v_next_sequence,
        updated_by = auth.uid(),
        updated_at = clock_timestamp()
    WHERE c.singleton IS TRUE;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'generation_id', v_target_generation_id,
    'revision', v_new_revision,
    'line_revisions', v_line_results
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_shared_lancamento_draft_line(
  p_generation_id uuid,
  p_line_id text,
  p_expected_line_revision bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_control public.lancamento_draft_control%ROWTYPE;
  v_line public.lancamento_draft_lines%ROWTYPE;
  v_new_revision bigint;
BEGIN
  IF auth.uid() IS NULL OR public.has_app_permission('stock.launch.create') IS DISTINCT FROM TRUE THEN
    RETURN jsonb_build_object('success', false, 'code', 'OPERATION_NOT_ALLOWED');
  END IF;
  IF p_generation_id IS NULL OR coalesce(btrim(p_line_id),'') = '' OR p_expected_line_revision IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_DRAFT_LINE_DELETE');
  END IF;

  SELECT c.* INTO v_control
  FROM public.lancamento_draft_control AS c
  WHERE c.singleton IS TRUE FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHARED_DRAFT_CONTROL_MISSING'; END IF;
  IF v_control.generation_id IS DISTINCT FROM p_generation_id THEN
    RETURN jsonb_build_object('success', false, 'conflict', true, 'code', 'DRAFT_GENERATION_CONFLICT');
  END IF;

  SELECT l.* INTO v_line
  FROM public.lancamento_draft_lines AS l
  WHERE l.generation_id = p_generation_id AND l.line_id = p_line_id;
  IF NOT FOUND THEN
    -- If the delete committed but its response was lost, acknowledge the same
    -- discarded line instead of making the caller believe a new conflict exists.
    IF EXISTS (
      SELECT 1 FROM public.lancamento_draft_archive_lines AS a
      WHERE a.line_id = p_line_id
        AND a.generation_id = p_generation_id
        AND a.disposition = 'discarded'
    ) THEN
      RETURN jsonb_build_object(
        'success', true, 'already_deleted', true,
        'generation_id', p_generation_id, 'revision', v_control.revision,
        'line_id', p_line_id
      );
    END IF;
    RETURN jsonb_build_object('success', false, 'conflict', true, 'code', 'DRAFT_LINE_CONFLICT', 'line_id', p_line_id);
  END IF;
  IF v_line.line_revision <> p_expected_line_revision THEN
    RETURN jsonb_build_object('success', false, 'conflict', true, 'code', 'DRAFT_LINE_CONFLICT', 'line_id', p_line_id, 'current_line_revision', v_line.line_revision);
  END IF;

  INSERT INTO public.lancamento_draft_archive_lines (
    line_id, generation_id, sequence, row_data, disposition, batch_id,
    created_by, updated_by, archived_by, created_at, updated_at
  ) VALUES (
    v_line.line_id, v_line.generation_id, v_line.sequence, v_line.row_data, 'discarded', NULL,
    v_line.created_by, v_line.updated_by, auth.uid(), v_line.created_at, v_line.updated_at
  );
  DELETE FROM public.lancamento_draft_lines l
  WHERE l.generation_id = p_generation_id AND l.line_id = p_line_id;

  v_new_revision := v_control.revision + 1;
  UPDATE public.lancamento_draft_control AS c
  SET revision = v_new_revision, updated_by = auth.uid(), updated_at = clock_timestamp()
  WHERE c.singleton IS TRUE;

  RETURN jsonb_build_object('success', true, 'generation_id', p_generation_id, 'revision', v_new_revision, 'line_id', p_line_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.clear_shared_lancamento_draft(
  p_generation_id uuid,
  p_expected_revision bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_control public.lancamento_draft_control%ROWTYPE;
  v_next_generation uuid;
  v_archived_count bigint;
BEGIN
  IF auth.uid() IS NULL OR public.has_app_permission('stock.launch.create') IS DISTINCT FROM TRUE OR public.has_app_permission('stock.batch.process') IS DISTINCT FROM TRUE THEN
    RETURN jsonb_build_object('success', false, 'code', 'OPERATION_NOT_ALLOWED');
  END IF;
  IF p_generation_id IS NULL OR p_expected_revision IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_DRAFT_CLEAR');
  END IF;

  SELECT c.* INTO v_control
  FROM public.lancamento_draft_control AS c
  WHERE c.singleton IS TRUE FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHARED_DRAFT_CONTROL_MISSING'; END IF;
  IF v_control.generation_id IS DISTINCT FROM p_generation_id OR v_control.revision <> p_expected_revision THEN
    RETURN jsonb_build_object('success', false, 'conflict', true, 'code', 'DRAFT_REVISION_CONFLICT', 'current_revision', v_control.revision);
  END IF;

  INSERT INTO public.lancamento_draft_archive_lines (
    line_id, generation_id, sequence, row_data, disposition, batch_id,
    created_by, updated_by, archived_by, created_at, updated_at
  )
  SELECT l.line_id, l.generation_id, l.sequence, l.row_data, 'discarded', NULL,
         l.created_by, l.updated_by, auth.uid(), l.created_at, l.updated_at
  FROM public.lancamento_draft_lines AS l
  WHERE l.generation_id = p_generation_id;
  GET DIAGNOSTICS v_archived_count = ROW_COUNT;

  DELETE FROM public.lancamento_draft_lines AS l WHERE l.generation_id = p_generation_id;
  v_next_generation := gen_random_uuid();
  UPDATE public.lancamento_draft_control AS c
  SET generation_id = v_next_generation,
      revision = 0,
      next_sequence = 1,
      updated_by = auth.uid(),
      updated_at = clock_timestamp()
  WHERE c.singleton IS TRUE;

  RETURN jsonb_build_object('success', true, 'previous_generation_id', p_generation_id, 'generation_id', v_next_generation, 'revision', 0, 'archived_count', v_archived_count);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_shared_lancamento_batch_result(p_batch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_run public.lancamento_batch_runs%ROWTYPE;
  v_control public.lancamento_draft_control%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR public.has_app_permission('stock.batch.process') IS DISTINCT FROM TRUE THEN
    RETURN jsonb_build_object('success', false, 'code', 'OPERATION_NOT_ALLOWED');
  END IF;
  IF p_batch_id IS NULL THEN RETURN jsonb_build_object('success', false, 'code', 'INVALID_BATCH_ID'); END IF;

  -- Wait for any in-flight batch transaction. A plain SELECT could report
  -- BATCH_NOT_FOUND while that transaction is still uncommitted.
  SELECT c.* INTO v_control
  FROM public.lancamento_draft_control AS c
  WHERE c.singleton IS TRUE
  FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHARED_DRAFT_CONTROL_MISSING'; END IF;

  SELECT r.* INTO v_run FROM public.lancamento_batch_runs AS r WHERE r.batch_id = p_batch_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'code', 'BATCH_NOT_FOUND'); END IF;
  RETURN jsonb_build_object(
    'success', true,
    'already_processed', true,
    'batch_id', v_run.batch_id,
    'generation_id', v_run.generation_id,
    'draft_revision', v_run.draft_revision,
    'result_summary', v_run.result_summary,
    'created_at', v_run.created_at
  );
END;
$function$;

-- Read-only identity check matching the application's getSlotIdentityMismatch rules.
-- Used only to decide whether a known bad legacy identity can be recorded as a
-- divergence without allowing any stock mutation in that physical scope.
CREATE OR REPLACE FUNCTION public.shared_draft_slot_identity_is_inconsistent(p_slot public.slots)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $function$
DECLARE
  v_raw_stock text := btrim(coalesce(p_slot.estoque, ''));
  v_stock text;
  v_raw_module text := btrim(coalesce(p_slot.modulo, ''));
  v_clean_module text;
  v_module text;
  v_raw_position text := coalesce(p_slot.posicao, '');
  v_position text;
  v_base_id text;
  v_prefix text;
  v_marker integer;
  v_suffix text;
  v_encoded_sku text;
  v_encoded_restriction text;
  v_stored_sku text := upper(btrim(coalesce(p_slot.referencia, '')));
  v_stored_restriction text;
  v_occupied_or_referenced boolean;
BEGIN
  v_stock := upper(v_raw_stock);
  IF left(v_stock, 1) = 'E' THEN v_stock := substring(v_stock FROM 2); END IF;
  IF v_raw_stock IS DISTINCT FROM v_stock THEN RETURN true; END IF;

  v_clean_module := regexp_replace(upper(v_raw_module), '^[MR]', '');
  IF v_clean_module ~ '^\d+$' THEN
    v_module := ltrim(v_clean_module, '0');
    IF v_module = '' THEN v_module := '0'; END IF;
  ELSE
    v_module := v_clean_module;
  END IF;
  IF v_raw_module IS DISTINCT FROM v_module THEN RETURN true; END IF;

  v_position := upper(btrim(v_raw_position));
  IF v_stock = '1' THEN
    IF v_raw_position <> '' THEN RETURN true; END IF;
    v_prefix := '1-' || v_module || '-';
    IF left(coalesce(p_slot.id, ''), length(v_prefix)) IS DISTINCT FROM v_prefix
       OR length(coalesce(p_slot.id, '')) <= length(v_prefix) THEN
      RETURN true;
    END IF;
    v_encoded_sku := upper(btrim(substring(p_slot.id FROM length(v_prefix) + 1)));
    IF v_stored_sku <> '' AND v_stored_sku IS DISTINCT FROM v_encoded_sku THEN RETURN true; END IF;
    RETURN false;
  END IF;

  IF v_stock NOT IN ('2', '3') THEN RETURN false; END IF;
  IF v_raw_position IS DISTINCT FROM v_position THEN RETURN true; END IF;

  v_base_id := v_stock || '-' || v_module || '-' || v_position;
  v_marker := position('::ITEM::' IN coalesce(p_slot.id, ''));
  IF v_marker = 0 THEN
    RETURN p_slot.id IS DISTINCT FROM v_base_id;
  END IF;

  IF substring(p_slot.id FROM 1 FOR v_marker - 1) IS DISTINCT FROM v_base_id THEN RETURN true; END IF;
  v_suffix := substring(p_slot.id FROM v_marker + length('::ITEM::'));
  v_encoded_sku := split_part(v_suffix, '::', 1);
  v_encoded_restriction := lower(btrim(split_part(v_suffix, '::', 2)));
  IF btrim(v_encoded_sku) = '' OR v_encoded_restriction NOT IN ('nenhuma', 'teste', 'autorizacao', 'outra')
     OR length(v_suffix) - length(replace(v_suffix, '::', '')) <> 2 THEN
    RETURN true;
  END IF;

  v_occupied_or_referenced := coalesce(p_slot.saldo, 0) > 0 OR v_stored_sku <> '';
  v_stored_restriction := CASE
    WHEN p_slot.restricao IN ('teste', 'autorizacao', 'outra') THEN p_slot.restricao
    ELSE 'nenhuma'
  END;
  IF v_occupied_or_referenced AND (
    v_stored_sku IS DISTINCT FROM upper(btrim(v_encoded_sku))
    OR v_stored_restriction IS DISTINCT FROM v_encoded_restriction
  ) THEN
    RETURN true;
  END IF;
  RETURN false;
END;
$function$;

REVOKE ALL ON FUNCTION public.shared_draft_slot_identity_is_inconsistent(public.slots) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.process_shared_lancamento_draft_batch_atomic(
  p_batch_id uuid,
  p_generation_id uuid,
  p_expected_revision bigint,
  p_input_rows jsonb,
  p_result_summary jsonb,
  p_expected_slots jsonb,
  p_slots jsonb,
  p_expected_divergencias jsonb,
  p_divergencias jsonb,
  p_history jsonb,
  p_delete_slot_ids text[] DEFAULT '{}'::text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_control public.lancamento_draft_control%ROWTYPE;
  v_run public.lancamento_batch_runs%ROWTYPE;
  v_current_rows jsonb;
  v_stock_result jsonb;
  v_summary jsonb;
  v_line jsonb;
  v_row_data jsonb;
  v_row_id text;
  v_safe_row_id text;
  v_event_count bigint;
  v_divergence_count bigint;
  v_archived_count bigint;
  v_next_generation uuid;
  v_scope_key text;
  v_candidate_scope text;
  v_scope_parts jsonb;
  v_special_scope_keys text[] := ARRAY[]::text[];
  v_invalid_special_scope_keys text[] := ARRAY[]::text[];
  v_divergence jsonb;
  v_payload jsonb;
  v_slot_id text;
  v_current_count bigint;
  v_payload_count bigint;
  v_current_slot public.slots%ROWTYPE;
  v_expected_slot public.slots%ROWTYPE;
  v_current_div public.divergencias%ROWTYPE;
  v_expected_div public.divergencias%ROWTYPE;
  v_layout_row public.warehouse_layout%ROWTYPE;
  v_special_valid boolean;
  v_module_inactive boolean;
  v_bad_identity boolean;
  v_normal_expected_slots jsonb;
  v_normal_slots jsonb;
  v_normal_expected_divergencias jsonb;
  v_normal_divergencias jsonb;
  v_normal_history jsonb;
  v_normal_delete_slot_ids text[] := ARRAY[]::text[];
  v_special_divergences_written bigint := 0;
  v_actor_name text;
BEGIN
  IF auth.uid() IS NULL OR public.has_app_permission('stock.launch.create') IS DISTINCT FROM TRUE OR public.has_app_permission('stock.batch.process') IS DISTINCT FROM TRUE THEN
    RETURN jsonb_build_object('success', false, 'code', 'OPERATION_NOT_ALLOWED');
  END IF;
  SELECT p.name INTO v_actor_name FROM public.profiles AS p WHERE p.id = auth.uid();
  IF coalesce(btrim(v_actor_name), '') = '' THEN
    RETURN jsonb_build_object('success', false, 'code', 'OPERATOR_PROFILE_MISSING');
  END IF;
  IF p_batch_id IS NULL OR p_generation_id IS NULL OR p_expected_revision IS NULL
     OR jsonb_typeof(p_input_rows) IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_result_summary) IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_expected_slots) IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_slots) IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_expected_divergencias) IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_divergencias) IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_history) IS DISTINCT FROM 'array'
     OR p_delete_slot_ids IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_SHARED_DRAFT_BATCH_PAYLOAD');
  END IF;
  IF jsonb_array_length(p_input_rows) > 5000 THEN
    RETURN jsonb_build_object('success', false, 'code', 'SHARED_DRAFT_BATCH_TOO_LARGE');
  END IF;
  IF cardinality(p_delete_slot_ids) <> cardinality(ARRAY(SELECT DISTINCT unnest(p_delete_slot_ids)))
     OR EXISTS (
       SELECT 1 FROM unnest(p_delete_slot_ids) AS del(slot_id)
       WHERE del.slot_id IS NULL OR btrim(del.slot_id) = ''
          OR NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(p_expected_slots) AS expected(value)
            WHERE expected.value->>'id' = del.slot_id
          )
     ) THEN
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_SLOT_DELETE_PAYLOAD');
  END IF;

  -- Validate every submitted snapshot array before the special divergence-only
  -- route can bypass the ordinary stock RPC. The regular stock RPC already rejects
  -- duplicate IDs, but that protection must also cover scopes routed around it.
  IF EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_expected_slots) AS x(value)
       WHERE coalesce(x.value->>'id','') = ''
     ) OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_expected_slots) AS x(value)
       GROUP BY x.value->>'id' HAVING count(*) > 1
     ) OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_slots) AS x(value)
       WHERE coalesce(x.value->>'id','') = ''
     ) OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_slots) AS x(value)
       GROUP BY x.value->>'id' HAVING count(*) > 1
     ) OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_expected_divergencias) AS x(value)
       WHERE coalesce(x.value->>'id','') = ''
     ) OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_expected_divergencias) AS x(value)
       GROUP BY x.value->>'id' HAVING count(*) > 1
     ) OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_divergencias) AS x(value)
       WHERE coalesce(x.value->>'id','') = ''
     ) OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_divergencias) AS x(value)
       GROUP BY x.value->>'id' HAVING count(*) > 1
     ) OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_history) AS x(value)
       WHERE coalesce(x.value->>'id','') = ''
     ) OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_history) AS x(value)
       GROUP BY x.value->>'id' HAVING count(*) > 1
     ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'DUPLICATE_OR_EMPTY_STOCK_PAYLOAD_IDS',
      'message', 'O lote contém IDs vazios ou duplicados no snapshot de estoque, divergências ou histórico.'
    );
  END IF;

  -- Fast path for retries after a lost response. A second check is made after
  -- locking the control row so simultaneous requests with the same ID are safe.
  SELECT r.* INTO v_run FROM public.lancamento_batch_runs AS r WHERE r.batch_id = p_batch_id;
  IF FOUND THEN
    IF v_run.generation_id IS DISTINCT FROM p_generation_id
       OR v_run.draft_revision IS DISTINCT FROM p_expected_revision THEN
      RETURN jsonb_build_object('success', false, 'conflict', true, 'code', 'BATCH_IDEMPOTENCY_KEY_COLLISION');
    END IF;
    RETURN jsonb_build_object('success', true, 'already_processed', true, 'batch_id', v_run.batch_id,
      'generation_id', v_run.generation_id, 'draft_revision', v_run.draft_revision,
      'result_summary', v_run.result_summary, 'created_at', v_run.created_at);
  END IF;

  SELECT c.* INTO v_control
  FROM public.lancamento_draft_control AS c
  WHERE c.singleton IS TRUE FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHARED_DRAFT_CONTROL_MISSING'; END IF;

  SELECT r.* INTO v_run FROM public.lancamento_batch_runs AS r WHERE r.batch_id = p_batch_id;
  IF FOUND THEN
    IF v_run.generation_id IS DISTINCT FROM p_generation_id
       OR v_run.draft_revision IS DISTINCT FROM p_expected_revision THEN
      RETURN jsonb_build_object('success', false, 'conflict', true, 'code', 'BATCH_IDEMPOTENCY_KEY_COLLISION');
    END IF;
    RETURN jsonb_build_object('success', true, 'already_processed', true, 'batch_id', v_run.batch_id,
      'generation_id', v_run.generation_id, 'draft_revision', v_run.draft_revision,
      'result_summary', v_run.result_summary, 'created_at', v_run.created_at);
  END IF;

  IF v_control.generation_id IS DISTINCT FROM p_generation_id THEN
    RETURN jsonb_build_object('success', false, 'conflict', true, 'code', 'DRAFT_GENERATION_CONFLICT',
      'current_generation_id', v_control.generation_id);
  END IF;
  IF v_control.revision <> p_expected_revision THEN
    RETURN jsonb_build_object('success', false, 'conflict', true, 'code', 'DRAFT_REVISION_CONFLICT',
      'current_revision', v_control.revision);
  END IF;

  SELECT coalesce(
    jsonb_agg(jsonb_build_object(
      'line_id', l.line_id,
      'row_data', l.row_data,
      'line_revision', l.line_revision,
      'sequence', l.sequence
    ) ORDER BY l.sequence),
    '[]'::jsonb
  ) INTO v_current_rows
  FROM public.lancamento_draft_lines AS l
  WHERE l.generation_id = p_generation_id;

  IF v_current_rows IS DISTINCT FROM p_input_rows THEN
    RETURN jsonb_build_object('success', false, 'conflict', true, 'code', 'DRAFT_SNAPSHOT_MISMATCH');
  END IF;

  -- Never silently discard partially filled rows just because the SKU is blank.
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_input_rows)
  LOOP
    v_row_data := v_line->'row_data';
    IF jsonb_typeof(v_row_data) IS DISTINCT FROM 'object'
       OR coalesce(v_line->>'line_id','') IS DISTINCT FROM v_row_data->>'id' THEN
      RETURN jsonb_build_object('success', false, 'code', 'INVALID_DRAFT_ROW');
    END IF;

    IF coalesce(btrim(v_row_data->>'referencia'),'') = '' THEN
      IF coalesce(btrim(v_row_data->>'data'),'') <> ''
         OR coalesce(btrim(v_row_data->>'estoque'),'1') NOT IN ('', '1')
         OR coalesce(btrim(v_row_data->>'modulo'),'') <> ''
         OR coalesce(btrim(v_row_data->>'posicao'),'') <> ''
         OR coalesce(v_row_data->>'quantidade','') NOT IN ('', 'null')
         OR coalesce(btrim(v_row_data->>'tipo'),'') <> ''
         OR coalesce(btrim(v_row_data->>'dataChacote'),'') <> ''
         OR coalesce(btrim(v_row_data->>'hora'),'') <> ''
         OR coalesce(btrim(v_row_data->>'responsavel'),'') <> ''
         OR coalesce(btrim(v_row_data->>'observacao'),'') <> ''
         OR coalesce(btrim(v_row_data->>'galpao'),'3') NOT IN ('', '3')
         OR coalesce(btrim(v_row_data->>'restricao'),'nenhuma') NOT IN ('', 'nenhuma') THEN
        RETURN jsonb_build_object('success', false, 'code', 'DRAFT_LINE_INCOMPLETE', 'line_id', v_line->>'line_id');
      END IF;
      CONTINUE;
    END IF;

    v_row_id := v_row_data->>'id';
    v_safe_row_id := left(regexp_replace(v_row_id, '[^A-Za-z0-9_-]', '_', 'g'), 80);
    SELECT count(*) INTO v_event_count
    FROM jsonb_array_elements(p_history) AS h(value)
    WHERE left(coalesce(h.value->>'id',''), length('MOV-' || v_safe_row_id || '-')) = 'MOV-' || v_safe_row_id || '-';

    SELECT count(*) INTO v_divergence_count
    FROM jsonb_array_elements(p_divergencias) AS d(value)
    WHERE left(coalesce(d.value->>'id',''), length('DIV-' || v_safe_row_id || '-')) = 'DIV-' || v_safe_row_id || '-'
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_expected_divergencias) AS old(value)
        WHERE old.value->>'id' = d.value->>'id'
      );

    IF v_event_count + v_divergence_count <> 1 THEN
      RETURN jsonb_build_object('success', false, 'code', 'DRAFT_LINE_WITHOUT_SINGLE_RESULT', 'line_id', v_line->>'line_id');
    END IF;
  END LOOP;

  -- Lock all scopes in a deterministic order before checking snapshots or routing
  -- safe divergence-only scopes. Existing stock RPCs acquire the same locks again;
  -- transaction-level advisory locks are re-entrant for this backend.
  FOR v_scope_key IN
    SELECT DISTINCT public.stock_address_lock_key(
      payload.value->>'estoque', payload.value->>'modulo', coalesce(payload.value->>'posicao','')
    ) AS key
    FROM (
      SELECT value FROM jsonb_array_elements(p_expected_slots)
      UNION ALL SELECT value FROM jsonb_array_elements(p_slots)
      UNION ALL SELECT value FROM jsonb_array_elements(p_expected_divergencias)
      UNION ALL SELECT value FROM jsonb_array_elements(p_divergencias)
      UNION ALL SELECT value FROM jsonb_array_elements(p_history)
    ) AS payload(value)
    ORDER BY key
  LOOP
    PERFORM public.lock_stock_address_key(v_scope_key);
  END LOOP;

  -- The ordinary stock writer intentionally refuses inactive/unknown physical
  -- locations and malformed address identities. Those can still produce a valid
  -- business divergence when—and only when—the corresponding scope is completely
  -- unchanged, contains no movement/deletion, and the database independently
  -- confirms the exact operational conflict. Route such a scope around the stock
  -- writer; no slot or history data is changed by this exception.
  FOR v_line IN
    SELECT d.value
    FROM jsonb_array_elements(p_divergencias) AS d(value)
    WHERE d.value->>'tipoDivergencia' IN ('Módulo Inativo', 'ID de Endereço Inconsistente')
      AND coalesce(d.value->>'status','') = 'Aberta'
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_expected_divergencias) AS old(value)
        WHERE old.value->>'id' = d.value->>'id'
      )
    ORDER BY d.value->>'id'
  LOOP
    v_divergence := v_line;
    v_candidate_scope := public.stock_address_lock_key(
      v_divergence->>'estoque', v_divergence->>'modulo', coalesce(v_divergence->>'posicao','')
    );
    v_special_valid := true;

    -- All newly produced results at a special scope must be the root conflict
    -- or its explicit blocked-position follow-up, and all must remain open.
    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_divergencias) AS d(value)
      WHERE public.stock_address_lock_key(
          d.value->>'estoque', d.value->>'modulo', coalesce(d.value->>'posicao','')
        ) = v_candidate_scope
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(p_expected_divergencias) AS old(value)
          WHERE old.value->>'id' = d.value->>'id'
        )
        AND (
          coalesce(d.value->>'status','') <> 'Aberta'
          OR CASE v_divergence->>'tipoDivergencia'
               WHEN 'Módulo Inativo' THEN d.value->>'tipoDivergencia' <> 'Módulo Inativo'
               ELSE d.value->>'tipoDivergencia' NOT IN ('ID de Endereço Inconsistente','Posição Bloqueada por Divergência')
             END
        )
    ) THEN
      v_special_valid := false;
    END IF;

    -- A special scope may not change/add/remove a stock identity, write history,
    -- or delete a slot. Check the complete pre/post arrays, not just touched IDs.
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_history) AS h(value)
      WHERE public.stock_address_lock_key(h.value->>'estoque',h.value->>'modulo',coalesce(h.value->>'posicao','')) = v_candidate_scope
    ) OR EXISTS (
      SELECT 1 FROM unnest(p_delete_slot_ids) AS del(slot_id)
      JOIN jsonb_array_elements(p_expected_slots) AS e(value) ON e.value->>'id' = del.slot_id
      WHERE public.stock_address_lock_key(e.value->>'estoque',e.value->>'modulo',coalesce(e.value->>'posicao','')) = v_candidate_scope
    ) OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_expected_slots) AS e(value)
      WHERE public.stock_address_lock_key(e.value->>'estoque',e.value->>'modulo',coalesce(e.value->>'posicao','')) = v_candidate_scope
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(p_slots) AS n(value)
          WHERE n.value->>'id' = e.value->>'id' AND n.value = e.value
        )
    ) OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_slots) AS n(value)
      WHERE public.stock_address_lock_key(n.value->>'estoque',n.value->>'modulo',coalesce(n.value->>'posicao','')) = v_candidate_scope
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(p_expected_slots) AS e(value)
          WHERE e.value->>'id' = n.value->>'id' AND e.value = n.value
        )
    ) THEN
      v_special_valid := false;
    END IF;

    -- The expected divergence snapshot must still be complete and unchanged.
    SELECT count(*) INTO v_current_count
    FROM public.divergencias AS d
    WHERE public.stock_address_lock_key(d.estoque,d.modulo,coalesce(d.posicao,'')) = v_candidate_scope;
    SELECT count(*) INTO v_payload_count
    FROM jsonb_array_elements(p_expected_divergencias) AS d(value)
    WHERE public.stock_address_lock_key(d.value->>'estoque',d.value->>'modulo',coalesce(d.value->>'posicao','')) = v_candidate_scope;
    IF v_current_count <> v_payload_count OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_expected_divergencias) AS e(value)
      WHERE public.stock_address_lock_key(e.value->>'estoque',e.value->>'modulo',coalesce(e.value->>'posicao','')) = v_candidate_scope
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(p_divergencias) AS n(value)
          WHERE n.value->>'id' = e.value->>'id' AND n.value = e.value
        )
    ) THEN
      v_special_valid := false;
    END IF;
    FOR v_payload IN
      SELECT e.value FROM jsonb_array_elements(p_expected_divergencias) AS e(value)
      WHERE public.stock_address_lock_key(e.value->>'estoque',e.value->>'modulo',coalesce(e.value->>'posicao','')) = v_candidate_scope
      ORDER BY e.value->>'id'
    LOOP
      SELECT d.* INTO v_current_div
      FROM public.divergencias AS d WHERE d.id = v_payload->>'id' FOR UPDATE;
      IF NOT FOUND THEN
        v_special_valid := false;
        EXIT;
      END IF;
      SELECT r.* INTO v_expected_div FROM jsonb_populate_record(NULL::public.divergencias,v_payload) AS r;
      IF to_jsonb(v_current_div) IS DISTINCT FROM to_jsonb(v_expected_div) THEN
        v_special_valid := false;
        EXIT;
      END IF;
    END LOOP;

    -- Verify that the database slot snapshot for the scope has not changed.
    SELECT count(*) INTO v_current_count
    FROM public.slots AS s
    WHERE public.stock_address_lock_key(s.estoque,s.modulo,coalesce(s.posicao,'')) = v_candidate_scope;
    SELECT count(*) INTO v_payload_count
    FROM jsonb_array_elements(p_expected_slots) AS s(value)
    WHERE public.stock_address_lock_key(s.value->>'estoque',s.value->>'modulo',coalesce(s.value->>'posicao','')) = v_candidate_scope;
    IF v_current_count <> v_payload_count OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_expected_slots) AS e(value)
      WHERE public.stock_address_lock_key(e.value->>'estoque',e.value->>'modulo',coalesce(e.value->>'posicao','')) = v_candidate_scope
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(p_slots) AS n(value)
          WHERE n.value->>'id' = e.value->>'id' AND n.value = e.value
        )
    ) THEN
      v_special_valid := false;
    END IF;
    -- The special divergence-only route must prove the entire post-state is
    -- exactly the same slot set. Otherwise an unexpected new/duplicate slot in
    -- p_slots could be silently filtered out while the draft is archived.
    SELECT count(*) INTO v_payload_count
    FROM jsonb_array_elements(p_slots) AS s(value)
    WHERE public.stock_address_lock_key(s.value->>'estoque',s.value->>'modulo',coalesce(s.value->>'posicao','')) = v_candidate_scope;
    IF v_current_count <> v_payload_count THEN
      v_special_valid := false;
    END IF;
    FOR v_payload IN
      SELECT e.value FROM jsonb_array_elements(p_expected_slots) AS e(value)
      WHERE public.stock_address_lock_key(e.value->>'estoque',e.value->>'modulo',coalesce(e.value->>'posicao','')) = v_candidate_scope
      ORDER BY e.value->>'id'
    LOOP
      SELECT s.* INTO v_current_slot
      FROM public.slots AS s WHERE s.id = v_payload->>'id' FOR UPDATE;
      IF NOT FOUND THEN
        v_special_valid := false;
        EXIT;
      END IF;
      SELECT r.* INTO v_expected_slot FROM jsonb_populate_record(NULL::public.slots,v_payload) AS r;
      IF to_jsonb(v_current_slot) IS DISTINCT FROM to_jsonb(v_expected_slot) THEN
        v_special_valid := false;
        EXIT;
      END IF;
    END LOOP;

    IF v_divergence->>'tipoDivergencia' = 'Módulo Inativo' THEN
      v_scope_parts := v_candidate_scope::jsonb;
      SELECT l.* INTO v_layout_row
      FROM public.warehouse_layout AS l
      WHERE l.estoque = v_scope_parts->>0
        AND CASE
          WHEN btrim(l.modulo) ~ '^\d+$' THEN (btrim(l.modulo)::numeric)::text
          ELSE btrim(l.modulo)
        END = v_scope_parts->>1
      FOR SHARE;
      IF NOT FOUND OR v_layout_row.ativo IS DISTINCT FROM FALSE THEN
        v_special_valid := false;
      END IF;
    ELSE
      -- The divergence must identify a snapshot row whose immutable ID/data are
      -- unchanged, and the row must still fail the same identity predicate used
      -- by the UI. A fabricated divergence cannot bypass stock safeguards.
      v_slot_id := nullif(v_divergence->>'slot_id','');
      IF v_slot_id IS NULL THEN
        v_special_valid := false;
      ELSE
        SELECT e.value INTO v_payload
        FROM jsonb_array_elements(p_expected_slots) AS e(value)
        WHERE e.value->>'id' = v_slot_id
          AND public.stock_address_lock_key(e.value->>'estoque',e.value->>'modulo',coalesce(e.value->>'posicao','')) = v_candidate_scope;
        IF NOT FOUND THEN
          v_special_valid := false;
        ELSE
          SELECT s.* INTO v_current_slot FROM public.slots AS s WHERE s.id = v_slot_id FOR UPDATE;
          IF NOT FOUND THEN
            v_special_valid := false;
          ELSE
            SELECT r.* INTO v_expected_slot FROM jsonb_populate_record(NULL::public.slots,v_payload) AS r;
            IF to_jsonb(v_current_slot) IS DISTINCT FROM to_jsonb(v_expected_slot)
               OR NOT public.shared_draft_slot_identity_is_inconsistent(v_current_slot) THEN
              v_special_valid := false;
            END IF;
          END IF;
        END IF;
      END IF;
    END IF;

    IF v_special_valid THEN
      IF NOT (v_candidate_scope = ANY(v_special_scope_keys)) THEN
        v_special_scope_keys := array_append(v_special_scope_keys, v_candidate_scope);
      END IF;
    ELSE
      IF NOT (v_candidate_scope = ANY(v_invalid_special_scope_keys)) THEN
        v_invalid_special_scope_keys := array_append(v_invalid_special_scope_keys, v_candidate_scope);
      END IF;
    END IF;
  END LOOP;

  -- If any candidate at a scope failed database verification, process that scope
  -- through the typed launch writer (which rejects unsafe state) rather than granting
  -- a partial exception based on another row at the same address.
  SELECT coalesce(array_agg(k ORDER BY k), ARRAY[]::text[])
  INTO v_special_scope_keys
  FROM (SELECT DISTINCT k FROM unnest(v_special_scope_keys) AS x(k)
        WHERE NOT (k = ANY(v_invalid_special_scope_keys))) AS verified;

  SELECT coalesce(jsonb_agg(p.value ORDER BY p.value->>'id'), '[]'::jsonb) INTO v_normal_expected_slots
  FROM jsonb_array_elements(p_expected_slots) AS p(value)
  WHERE NOT (public.stock_address_lock_key(p.value->>'estoque',p.value->>'modulo',coalesce(p.value->>'posicao','')) = ANY(v_special_scope_keys));
  SELECT coalesce(jsonb_agg(p.value ORDER BY p.value->>'id'), '[]'::jsonb) INTO v_normal_slots
  FROM jsonb_array_elements(p_slots) AS p(value)
  WHERE NOT (public.stock_address_lock_key(p.value->>'estoque',p.value->>'modulo',coalesce(p.value->>'posicao','')) = ANY(v_special_scope_keys));
  SELECT coalesce(jsonb_agg(p.value ORDER BY p.value->>'id'), '[]'::jsonb) INTO v_normal_expected_divergencias
  FROM jsonb_array_elements(p_expected_divergencias) AS p(value)
  WHERE NOT (public.stock_address_lock_key(p.value->>'estoque',p.value->>'modulo',coalesce(p.value->>'posicao','')) = ANY(v_special_scope_keys));
  SELECT coalesce(jsonb_agg(p.value ORDER BY p.value->>'id'), '[]'::jsonb) INTO v_normal_divergencias
  FROM jsonb_array_elements(p_divergencias) AS p(value)
  WHERE NOT (public.stock_address_lock_key(p.value->>'estoque',p.value->>'modulo',coalesce(p.value->>'posicao','')) = ANY(v_special_scope_keys));
  SELECT coalesce(jsonb_agg(p.value ORDER BY p.value->>'id'), '[]'::jsonb) INTO v_normal_history
  FROM jsonb_array_elements(p_history) AS p(value)
  WHERE NOT (public.stock_address_lock_key(p.value->>'estoque',p.value->>'modulo',coalesce(p.value->>'posicao','')) = ANY(v_special_scope_keys));
  SELECT coalesce(array_agg(del.slot_id ORDER BY del.slot_id), ARRAY[]::text[]) INTO v_normal_delete_slot_ids
  FROM unnest(p_delete_slot_ids) AS del(slot_id)
  JOIN jsonb_array_elements(p_expected_slots) AS e(value) ON e.value->>'id' = del.slot_id
  WHERE NOT (public.stock_address_lock_key(e.value->>'estoque',e.value->>'modulo',coalesce(e.value->>'posicao','')) = ANY(v_special_scope_keys));

  IF jsonb_array_length(v_normal_expected_slots) = 0
     AND jsonb_array_length(v_normal_slots) = 0
     AND jsonb_array_length(v_normal_expected_divergencias) = 0
     AND jsonb_array_length(v_normal_divergencias) = 0
     AND jsonb_array_length(v_normal_history) = 0
     AND cardinality(v_normal_delete_slot_ids) = 0 THEN
    v_stock_result := jsonb_build_object('success', true, 'slots_written', 0, 'history_written', 0, 'divergencias_written', 0, 'scopes_locked', 0);
  ELSIF cardinality(v_normal_delete_slot_ids) > 0 THEN
    v_stock_result := public.apply_stock_mutation_atomic_with_deletes(
      v_normal_expected_slots, v_normal_slots, v_normal_expected_divergencias,
      v_normal_divergencias, v_normal_history, v_normal_delete_slot_ids, 'launch'
    );
  ELSE
    v_stock_result := public.apply_stock_mutation_atomic(
      v_normal_expected_slots, v_normal_slots, v_normal_expected_divergencias,
      v_normal_divergencias, v_normal_history, 'launch'
    );
  END IF;

  IF coalesce((v_stock_result->>'success')::boolean, false) IS NOT TRUE THEN
    RETURN v_stock_result;
  END IF;

  -- Special scopes were independently validated and locked above. Insert only
  -- their new open divergences here, after the normal stock transaction succeeded,
  -- so any earlier return cannot leave a partial divergence behind.
  INSERT INTO public.divergencias (
    id, "dataDivergencia", "tipoDivergencia", estoque, modulo, posicao,
    "refAtual", "refNova", "saldoAntes", movimentacao, "saldoFinal",
    responsavel, status, "dataChacote", "dataCorrecao", "corrigidoPor",
    observacao, slot_id, restricao, "correcaoId"
  )
  SELECT
    d.value->>'id', d.value->>'dataDivergencia', d.value->>'tipoDivergencia',
    d.value->>'estoque', d.value->>'modulo', d.value->>'posicao',
    d.value->>'refAtual', d.value->>'refNova',
    nullif(d.value->>'saldoAntes','')::integer,
    nullif(d.value->>'movimentacao','')::integer,
    nullif(d.value->>'saldoFinal','')::integer,
    d.value->>'responsavel', d.value->>'status', d.value->>'dataChacote',
    d.value->>'dataCorrecao', d.value->>'corrigidoPor', d.value->>'observacao',
    d.value->>'slot_id', d.value->>'restricao', nullif(d.value->>'correcaoId','')::uuid
  FROM jsonb_array_elements(p_divergencias) AS d(value)
  WHERE public.stock_address_lock_key(d.value->>'estoque',d.value->>'modulo',coalesce(d.value->>'posicao','')) = ANY(v_special_scope_keys)
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_expected_divergencias) AS old(value)
      WHERE old.value->>'id' = d.value->>'id'
    );
  GET DIAGNOSTICS v_special_divergences_written = ROW_COUNT;

  SELECT count(*) INTO v_divergence_count
  FROM jsonb_array_elements(p_divergencias) AS d(value)
  WHERE NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_expected_divergencias) AS old(value)
    WHERE old.value->>'id' = d.value->>'id'
  );

  v_summary := p_result_summary || jsonb_build_object(
    'draft_line_count', jsonb_array_length(p_input_rows),
    'history_count', jsonb_array_length(p_history),
    'new_divergence_count', v_divergence_count,
    'special_divergence_count', v_special_divergences_written
  );

  -- All changes below share the same PostgreSQL transaction as the stock RPC.
  -- An exception anywhere rolls back stock, history, divergences and draft close.
  INSERT INTO public.lancamento_batch_runs (
    batch_id, generation_id, draft_revision, executed_by, result_summary, created_at
  ) VALUES (
    p_batch_id, p_generation_id, p_expected_revision, auth.uid(), v_summary, clock_timestamp()
  );

  INSERT INTO public.lancamento_draft_archive_lines (
    line_id, generation_id, sequence, row_data, disposition, batch_id,
    created_by, updated_by, archived_by, created_at, updated_at
  )
  SELECT l.line_id, l.generation_id, l.sequence, l.row_data,
         CASE WHEN coalesce(btrim(l.row_data->>'referencia'),'') = '' THEN 'ignored' ELSE 'processed' END,
         p_batch_id, l.created_by, l.updated_by, auth.uid(), l.created_at, l.updated_at
  FROM public.lancamento_draft_lines AS l
  WHERE l.generation_id = p_generation_id;
  GET DIAGNOSTICS v_archived_count = ROW_COUNT;

  DELETE FROM public.lancamento_draft_lines AS l WHERE l.generation_id = p_generation_id;
  v_next_generation := gen_random_uuid();
  UPDATE public.lancamento_draft_control AS c
  SET generation_id = v_next_generation,
      revision = 0,
      next_sequence = 1,
      updated_by = auth.uid(),
      updated_at = clock_timestamp()
  WHERE c.singleton IS TRUE;

  RETURN jsonb_build_object(
    'success', true,
    'already_processed', false,
    'batch_id', p_batch_id,
    'generation_id', p_generation_id,
    'next_generation_id', v_next_generation,
    'result_summary', v_summary,
    'archived_count', v_archived_count,
    'stock_result', v_stock_result
  );
EXCEPTION WHEN OTHERS THEN
  -- PL/pgSQL rolls back all writes made in this function block before entering this handler.
  RETURN jsonb_build_object('success', false, 'conflict', false, 'code', 'SHARED_DRAFT_BATCH_ATOMIC_FAILED',
    'sqlstate', SQLSTATE, 'message', 'O lote não foi confirmado. O rascunho foi preservado; consulte o resultado antes de repetir.');
END;
$function$;

REVOKE ALL ON FUNCTION public.get_shared_lancamento_draft() FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.upsert_shared_lancamento_draft_lines(uuid, jsonb) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.delete_shared_lancamento_draft_line(uuid, text, bigint) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.clear_shared_lancamento_draft(uuid, bigint) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.get_shared_lancamento_batch_result(uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.process_shared_lancamento_draft_batch_atomic(uuid, uuid, bigint, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, text[]) FROM PUBLIC, anon, service_role;

GRANT EXECUTE ON FUNCTION public.get_shared_lancamento_draft() TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_shared_lancamento_draft_lines(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_shared_lancamento_draft_line(uuid, text, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.clear_shared_lancamento_draft(uuid, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_shared_lancamento_batch_result(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_shared_lancamento_draft_batch_atomic(uuid, uuid, bigint, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, text[]) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
