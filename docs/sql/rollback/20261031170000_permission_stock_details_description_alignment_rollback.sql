-- Roll back only this known description change. Do not overwrite an unexpected value.
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

  IF v_current_description = v_old_description THEN
    RAISE NOTICE 'stock.details.view description already rolled back; no change needed.';
  ELSIF v_current_description = v_target_description THEN
    UPDATE public.permission_catalog
    SET description = v_old_description,
        updated_at = now()
    WHERE permission_key = 'stock.details.view';
    RAISE NOTICE 'stock.details.view description rolled back.';
  ELSE
    RAISE EXCEPTION 'AUDIT03_CATALOG_ROLLBACK_STATE_UNEXPECTED: refusing to overwrite unknown value.';
  END IF;
END;
$$;
