-- Somente leitura. Ajuda a medir a qualidade dos eventos legados antes de qualquer
-- tentativa de reconstruir saldos anteriores a 2026-11-02.

-- Distribuicao dos formatos da coluna history.data.
SELECT CASE
         WHEN data ~ '^\d{4}-\d{2}-\d{2}$' THEN 'ISO YYYY-MM-DD'
         WHEN data ~ '^\d{1,2}/\d{1,2}/\d{4}$' THEN 'DD/MM/YYYY'
         WHEN data IS NULL OR btrim(data) = '' THEN 'vazio'
         ELSE 'outro/invalido'
       END AS date_format,
       count(*) AS rows
FROM public.history
GROUP BY 1
ORDER BY rows DESC;

-- Datas suspeitas em formato ISO, inclusive futuras ou com ano fora da faixa operacional.
SELECT id, data, "dataLancamento", hora, tipo, referencia, quantidade,
       estoque, modulo, posicao, "naturezaTransacao", "saldoAnterior", "saldoFinal"
FROM public.history
WHERE data ~ '^\d{4}-\d{2}-\d{2}$'
  AND (
    split_part(data, '-', 1)::integer NOT BETWEEN 2020 AND 2099
    OR data::date > (now() AT TIME ZONE 'America/Sao_Paulo')::date
  )
ORDER BY data DESC
LIMIT 200;

-- Cobertura dos saldos antes/depois e eventos sem referencia.
SELECT count(*) AS total_history_rows,
       count(*) FILTER (WHERE "saldoAnterior" IS NOT NULL AND "saldoFinal" IS NOT NULL) AS with_balance_pair,
       count(*) FILTER (WHERE "saldoAnterior" IS NULL OR "saldoFinal" IS NULL) AS missing_balance_pair,
       count(*) FILTER (WHERE coalesce(btrim(referencia), '') = '') AS without_reference,
       count(*) FILTER (WHERE "naturezaTransacao" = 'correcao_fisica') AS physical_correction_rows
FROM public.history;

-- Resumo de tipos/naturezas para orientar uma futura reconstrucao auditavel.
SELECT coalesce("naturezaTransacao", '(sem natureza)') AS transaction_nature,
       coalesce(tipo, '(sem tipo)') AS movement_type,
       count(*) AS rows,
       count(*) FILTER (WHERE "saldoAnterior" IS NOT NULL AND "saldoFinal" IS NOT NULL) AS with_balance_pair
FROM public.history
GROUP BY 1, 2
ORDER BY rows DESC;

-- Comparacao simples de fotografias gerais e total atual; nao calcula nem grava
-- saldos historicos por SKU e nao deve ser usada para preencher datas faltantes.
SELECT snapshot_date, total_pieces, total_positions, occupied_positions, created_at
FROM public.occupancy_history
ORDER BY snapshot_date DESC
LIMIT 60;
