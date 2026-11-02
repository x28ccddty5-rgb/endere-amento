-- PROPOSTA — NÃO EXECUTAR EM PRODUÇÃO SEM REVISÃO/AUTORIZAÇÃO EXPLÍCITA.
-- Objetivo: remover o uso de SQLSTATE 40001 em exceções de negócio da RPC.
-- PostgREST pode tratar 40001 como falha de serialização e repetir a transação.
-- P0001 mantém a exceção e o rollback, sem sinalizar retry de serialização.
-- A definição existente é obtida do catálogo e alterada apenas se houver
-- exatamente oito cláusulas esperadas. Qualquer divergência aborta a migration.

DO $migration$
DECLARE
  v_function_definition text;
  v_marker constant text := 'USING ERRCODE = ''40001'';';
  v_replacement constant text := 'USING ERRCODE = ''P0001'';';
  v_occurrences integer;
BEGIN
  SELECT pg_get_functiondef(
    'public.resolve_stock_divergence_atomic(jsonb,jsonb,jsonb,jsonb,jsonb)'::regprocedure
  )
  INTO v_function_definition;

  IF v_function_definition IS NULL THEN
    RAISE EXCEPTION 'RPC resolve_stock_divergence_atomic nao encontrada';
  END IF;

  v_occurrences := (
    length(v_function_definition)
    - length(replace(v_function_definition, v_marker, ''))
  ) / length(v_marker);

  IF v_occurrences <> 8 THEN
    RAISE EXCEPTION
      'Migration abortada: esperava 8 usos de SQLSTATE 40001 na RPC; encontrei %.',
      v_occurrences;
  END IF;

  v_function_definition := replace(
    v_function_definition,
    v_marker,
    v_replacement
  );

  IF position('40001' IN v_function_definition) > 0 THEN
    RAISE EXCEPTION
      'Migration abortada: ainda existe referencia a 40001 na definicao da RPC.';
  END IF;

  -- CREATE OR REPLACE preserva a identidade da função e seus grants existentes.
  -- Qualquer erro continua abortando a transação inteira.
  EXECUTE v_function_definition;
END;
$migration$;