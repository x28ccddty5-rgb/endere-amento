-- RELEASE PRODUCTION / D1 — aplicar SOMENTE depois do cutover 20261102180900.
-- Ajusta a descrição final da chave legada stock.details.view; não altera permissões.

-- Audit 03: align the legacy stock.details.view description with the frontend contract.
-- Safe transition: update only the known older description; accept the target value;
-- refuse to overwrite any unexpected catalog state.

DO $$
DECLARE
  v_current_description text;
  v_old_description constant text :=
    'Chave legada descontinuada; não controla campos exibidos nem a leitura da Pesquisa.';
  v_target_description constant text :=
    'Chave legada descontinuada; não controla mais campos exibidos, filtros, exportação ou leitura da Pesquisa.';
BEGIN
  SELECT description
    INTO v_current_description
  FROM public.permission_catalog
  WHERE permission_key = 'stock.details.view'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'AUDIT03_CATALOG_KEY_NOT_FOUND: stock.details.view';
  END IF;

  IF v_current_description = v_target_description THEN
    RAISE NOTICE 'stock.details.view description already aligned; no change needed.';
  ELSIF v_current_description = v_old_description THEN
    UPDATE public.permission_catalog
    SET description = v_target_description,
        updated_at = now()
    WHERE permission_key = 'stock.details.view';

    RAISE NOTICE 'stock.details.view description aligned.';
  ELSE
    RAISE EXCEPTION 'AUDIT03_CATALOG_UNEXPECTED_DESCRIPTION: refusing to overwrite unknown value.';
  END IF;
END;
$$;
