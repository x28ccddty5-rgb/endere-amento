-- Verificação somente leitura da ampliação de SELECT
-- nas tabelas warehouse_layout e warehouse_layout_positions.

WITH expected_permissions(permission_key) AS (
  VALUES
    ('stock.launch.view'),
    ('stock.launch.create'),
    ('stock.transfer.create'),
    ('stock.batch.process')
),
target_policies AS (
  SELECT
    schemaname,
    tablename,
    policyname,
    cmd,
    qual
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'public'
    AND (
      (tablename = 'warehouse_layout'
       AND policyname = 'warehouse_layout_select_permission_catalog')
      OR
      (tablename = 'warehouse_layout_positions'
       AND policyname = 'warehouse_layout_positions_select_permission_catalog')
    )
)
SELECT
  t.tablename,
  t.policyname,
  t.cmd,
  t.qual AS using_expression,
  e.permission_key,
  COALESCE(
    POSITION(e.permission_key IN t.qual) > 0,
    false
  ) AS permission_is_present
FROM target_policies t
CROSS JOIN expected_permissions e
ORDER BY t.tablename, e.permission_key;

-- Relação completa das políticas das duas tabelas.
-- Permite conferir que as políticas de escrita continuam separadas.
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual AS using_expression,
  with_check
FROM pg_catalog.pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'warehouse_layout',
    'warehouse_layout_positions'
  )
ORDER BY tablename, policyname;

-- Estado RLS das tabelas.
SELECT
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS rls_forced
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n
  ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'warehouse_layout',
    'warehouse_layout_positions'
  )
ORDER BY c.relname;