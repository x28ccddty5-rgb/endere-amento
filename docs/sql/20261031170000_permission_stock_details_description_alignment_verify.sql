DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*)
    INTO v_count
  FROM public.permission_catalog
  WHERE permission_key = 'stock.details.view'
    AND module_name = 'Pesquisa de estoque'
    AND label = 'Consultar detalhes do estoque'
    AND description = 'Chave legada descontinuada; não controla mais campos exibidos, filtros, exportação ou leitura da Pesquisa.'
    AND user_override_allowed = true
    AND is_admin_only = false
    AND sort_order = 3;

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'AUDIT03_CATALOG_METADATA_VERIFY_FAILED: expected exactly one aligned stock.details.view row; found %.', v_count;
  END IF;
END;
$$;

SELECT permission_key, module_name, label, description,
       user_override_allowed, is_admin_only, sort_order
FROM public.permission_catalog
WHERE permission_key = 'stock.details.view';
