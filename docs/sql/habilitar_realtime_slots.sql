-- Registro da configuração do Realtime aplicada no Supabase.
-- Script idempotente: não adiciona slots novamente se já estiver habilitado.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication
    WHERE pubname = 'supabase_realtime'
  ) THEN
    RAISE EXCEPTION 'A publicação supabase_realtime não existe.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'slots'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.slots';
  END IF;
END $$;

SELECT EXISTS (
  SELECT 1
  FROM pg_publication_tables
  WHERE pubname = 'supabase_realtime'
    AND schemaname = 'public'
    AND tablename = 'slots'
) AS slots_realtime_habilitado;
