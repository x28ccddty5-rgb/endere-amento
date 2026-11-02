-- Rollback do RPC B6.2A. Antes de executá-lo, reverta o App.tsx para a versão
-- anterior a B6.2; caso contrário, a edição móvel continuará chamando uma RPC removida.
BEGIN;
DROP FUNCTION IF EXISTS public.update_slot_metadata_atomic(jsonb, jsonb);
COMMIT;
