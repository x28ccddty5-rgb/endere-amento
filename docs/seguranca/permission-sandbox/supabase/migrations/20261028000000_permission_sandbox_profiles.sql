-- LOCAL-ONLY FIXTURE. This migration is inside docs/seguranca/permission-sandbox,
-- not the application's production Supabase migrations directory.
-- Profile IDs are temporary placeholders; Start-PermissionSandbox.ps1 replaces
-- them with actual local Auth user IDs and adds the FK before opening the test page.
BEGIN;

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  username text NOT NULL UNIQUE,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  role text NOT NULL CHECK (role IN ('administrador', 'lideranca', 'apoio', 'producao', 'visualizador')),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.profiles FROM PUBLIC, anon, authenticated;

INSERT INTO public.profiles (id, username, name, email, role) VALUES
  ('10000000-0000-4000-8000-000000000017', 'admin-permissoes', 'Administrador Teste', 'admin-permissoes@local.test', 'administrador'),
  ('10000000-0000-4000-8000-000000000002', 'rafael-teste', 'Rafael Teste', 'rafael-permissoes@local.test', 'apoio'),
  ('10000000-0000-4000-8000-000000000003', 'producao-teste', 'Produção Teste', 'producao-permissoes@local.test', 'producao'),
  ('10000000-0000-4000-8000-000000000004', 'visualizador-teste', 'Visualizador Teste', 'visualizador-permissoes@local.test', 'visualizador'),
  ('10000000-0000-4000-8000-000000000001', 'lideranca-teste', 'Liderança Teste', 'lideranca-permissoes@local.test', 'lideranca');

COMMIT;
