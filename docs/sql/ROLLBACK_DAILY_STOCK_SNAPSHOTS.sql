-- BLOCO 8 - rollback controlado
-- Objetivo: parar o agendamento e restaurar a capacidade antiga do frontend de
-- gravar occupancy_history, caso a publicacao do frontend seja revertida.
-- IMPORTANTE: preserva stock_balance_snapshots, stock_internal e seus dados.
-- Nao remove pg_cron, pois a extensao pode servir a outros jobs do projeto.

BEGIN;

DO $unschedule$
DECLARE
  v_job_id bigint;
BEGIN
  FOR v_job_id IN
    SELECT jobid
    FROM cron.job
    WHERE jobname = 'enderecamento-daily-stock-snapshots'
  LOOP
    PERFORM cron.unschedule(v_job_id);
  END LOOP;
END;
$unschedule$;

DROP FUNCTION IF EXISTS stock_internal.capture_daily_stock_snapshots();

-- Bloqueia a consulta da nova tabela pela API, mas preserva os registros para
-- eventual reativacao. A tabela e o log interno nao sao apagados.
DROP POLICY IF EXISTS stock_balance_snapshots_read_history
  ON public.stock_balance_snapshots;
REVOKE ALL ON TABLE public.stock_balance_snapshots FROM PUBLIC, anon, authenticated;

-- Restaura as policies que existiam antes do Bloco 8.
DROP POLICY IF EXISTS occupancy_history_select_dashboard
  ON public.occupancy_history;
DROP POLICY IF EXISTS occupancy_history_select_authenticated
  ON public.occupancy_history;
DROP POLICY IF EXISTS occupancy_history_insert_operations
  ON public.occupancy_history;
DROP POLICY IF EXISTS occupancy_history_update_operations
  ON public.occupancy_history;

CREATE POLICY occupancy_history_select_authenticated
  ON public.occupancy_history
  FOR SELECT
  TO authenticated
  USING (
    (SELECT public.has_app_role(ARRAY[
      'administrador', 'lideranca', 'apoio', 'producao', 'visualizador'
    ]::text[]))
  );

CREATE POLICY occupancy_history_insert_operations
  ON public.occupancy_history
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT public.has_app_role(ARRAY[
      'administrador', 'lideranca', 'apoio', 'producao'
    ]::text[]))
  );

CREATE POLICY occupancy_history_update_operations
  ON public.occupancy_history
  FOR UPDATE
  TO authenticated
  USING (
    (SELECT public.has_app_role(ARRAY[
      'administrador', 'lideranca', 'apoio', 'producao'
    ]::text[]))
  )
  WITH CHECK (
    (SELECT public.has_app_role(ARRAY[
      'administrador', 'lideranca', 'apoio', 'producao'
    ]::text[]))
  );

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.occupancy_history TO authenticated;

COMMIT;

-- Pos-rollback: confirmar que o job nao existe e que as policies antigas voltaram.
SELECT jobid, jobname, schedule, active
FROM cron.job
WHERE jobname = 'enderecamento-daily-stock-snapshots';

SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'occupancy_history'
ORDER BY policyname;

-- stock_balance_snapshots e stock_internal permanecem preservadas intencionalmente.
