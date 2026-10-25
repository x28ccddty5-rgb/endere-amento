-- ROLLBACK DE EMERGENCIA: somente se a migracao foi COMMITADA por engano,
-- antes de publicar/usar a nova interface. Nao e rollback de uso normal.
-- Bloqueia a tabela legada e as tabelas operacionais; recusa se houver dados ativos,
-- linhas arquivadas, lotes processados ou diferenca entre origem e quarentena.
-- A quarentena so e removida se for exatamente redundante com a tabela legada atual.

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $preflight$
BEGIN
  IF to_regclass('public.lancamento_drafts') IS NULL
     OR to_regclass('public.lancamento_draft_legacy_quarantine') IS NULL
     OR to_regclass('public.lancamento_draft_control') IS NULL
     OR to_regclass('public.lancamento_draft_lines') IS NULL
     OR to_regclass('public.lancamento_draft_archive_lines') IS NULL
     OR to_regclass('public.lancamento_batch_runs') IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK_BLOCKED: estrutura esperada ausente; inspecione manualmente.';
  END IF;
END;
$preflight$;

LOCK TABLE public.lancamento_drafts IN SHARE MODE;
LOCK TABLE public.lancamento_draft_control IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.lancamento_draft_lines IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.lancamento_draft_archive_lines IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.lancamento_batch_runs IN ACCESS EXCLUSIVE MODE;

DO $guard$
DECLARE
  v_active bigint;
  v_archived bigint;
  v_runs bigint;
  v_mismatches bigint;
BEGIN
  SELECT count(*) INTO v_active FROM public.lancamento_draft_lines;
  SELECT count(*) INTO v_archived FROM public.lancamento_draft_archive_lines;
  SELECT count(*) INTO v_runs FROM public.lancamento_batch_runs;
  IF v_active <> 0 OR v_archived <> 0 OR v_runs <> 0 THEN
    RAISE EXCEPTION 'ROLLBACK_BLOCKED: dados operacionais existem (ativos %, arquivados %, lotes %). Preserve/exporte e reconcilie antes de reverter.', v_active, v_archived, v_runs;
  END IF;

  SELECT count(*) INTO v_mismatches
  FROM (
    SELECT d.user_id
    FROM public.lancamento_drafts d
    LEFT JOIN public.lancamento_draft_legacy_quarantine q ON q.user_id=d.user_id
    WHERE q.user_id IS NULL OR q.rows IS DISTINCT FROM d.rows
       OR q.source_updated_at IS DISTINCT FROM d.updated_at
       OR q.row_count IS DISTINCT FROM CASE WHEN jsonb_typeof(d.rows)='array' THEN jsonb_array_length(d.rows) ELSE 0 END
    UNION ALL
    SELECT q.user_id
    FROM public.lancamento_draft_legacy_quarantine q
    LEFT JOIN public.lancamento_drafts d ON d.user_id=q.user_id
    WHERE d.user_id IS NULL
  ) AS mismatches;
  IF v_mismatches <> 0 THEN
    RAISE EXCEPTION 'ROLLBACK_BLOCKED: a quarentena difere da tabela legada (mismatches %). Nao remova a evidencia; reconcilie manualmente.', v_mismatches;
  END IF;
END;
$guard$;

DROP FUNCTION IF EXISTS public.process_shared_lancamento_draft_batch_atomic(uuid,uuid,bigint,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text[]);
DROP FUNCTION IF EXISTS public.get_shared_lancamento_batch_result(uuid);
DROP FUNCTION IF EXISTS public.clear_shared_lancamento_draft(uuid,bigint);
DROP FUNCTION IF EXISTS public.delete_shared_lancamento_draft_line(uuid,text,bigint);
DROP FUNCTION IF EXISTS public.upsert_shared_lancamento_draft_lines(uuid,jsonb);
DROP FUNCTION IF EXISTS public.get_shared_lancamento_draft();
DROP FUNCTION IF EXISTS public.shared_draft_slot_identity_is_inconsistent(public.slots);
DROP TABLE public.lancamento_batch_runs;
DROP TABLE public.lancamento_draft_archive_lines;
DROP TABLE public.lancamento_draft_lines;
DROP TABLE public.lancamento_draft_control;
DROP TABLE public.lancamento_draft_legacy_quarantine;

COMMIT;
