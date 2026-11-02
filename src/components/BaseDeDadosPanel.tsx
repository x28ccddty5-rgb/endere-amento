import React, { useMemo, useState } from "react";
import { Product, WarehouseSlot } from "../types";
import type { PermissionKey } from "../constants/permissionCatalog.ts";
import { ChevronLeft, ChevronRight, Database, Search, PlusCircle, ShieldAlert } from "lucide-react";
import {
  buildProductBalanceIndex,
  filterProductCatalogRows,
  normalizeProductCatalogRows,
  normalizeSkuReference,
  paginateProductCatalogRows,
} from "../lib/productCatalogModel.ts";

interface BaseDeDadosPanelProps {
  productsList: Product[];
  slots: WarehouseSlot[];

  onRegisterProduct: (
    ref: string,
    desc: string,
    paletizacao: number
  ) => Promise<boolean>;

  onUpdateProduct: (
    referencia: string,
    descricao: string,
    paletizacao: number
  ) => Promise<boolean>;

  onDeleteProduct: (
    referencia: string
  ) => Promise<boolean>;

  hasAccess: (
    level: "administrador" | "operador" | "consulta"
  ) => boolean;

  currentUser: any;
  permissionEnforcementEnabled?: boolean;
  canUsePermission?: (permissionKey: PermissionKey) => boolean;
}

export const BaseDeDadosPanel: React.FC<BaseDeDadosPanelProps> = ({
  productsList,
  slots,
  onRegisterProduct,
  onUpdateProduct,
  onDeleteProduct,
  hasAccess,
  currentUser,
  permissionEnforcementEnabled = false,
  canUsePermission,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(0);
  const [newRef, setNewRef] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newPaletizacao, setNewPaletizacao] = useState("");

  // Empty warehouse positions may legitimately have a null SKU. Normalize the
  // operational rows before rendering so one incomplete slot cannot crash the tab.
  const normalizedCatalog = useMemo(
    () => normalizeProductCatalogRows(productsList),
    [productsList],
  );
  const productBalanceByReference = useMemo(
    () => buildProductBalanceIndex(slots),
    [slots],
  );
  const filteredProducts = useMemo(
    () => filterProductCatalogRows(normalizedCatalog.products, searchQuery),
    [normalizedCatalog.products, searchQuery],
  );
  const page = useMemo(
    () => paginateProductCatalogRows(filteredProducts, currentPage, 100),
    [filteredProducts, currentPage],
  );
  const visibleProducts = page.items;

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    setCurrentPage(0);
  };

const role =
  currentUser?.role
    ?.toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const roleCanEditBase =
  role === "administrador" ||
  role === "lideranca";

const canCreateProduct = permissionEnforcementEnabled && canUsePermission
  ? canUsePermission("products.create")
  : roleCanEditBase;
const canEditProduct = permissionEnforcementEnabled && canUsePermission
  ? canUsePermission("products.edit")
  : roleCanEditBase;
const canDeleteProduct = permissionEnforcementEnabled && canUsePermission
  ? canUsePermission("products.delete_deactivate")
  : roleCanEditBase;

    const isReadOnly = !canCreateProduct;
  

  const handleAddProduct = async () => {
     if (!canCreateProduct) {
    alert("Seu perfil não possui permissão para cadastrar produtos.");
    return;
    }

    let cleanRef = newRef.trim().toUpperCase();
    if (cleanRef.startsWith("S")) {
      cleanRef = cleanRef.slice(1);
    }

    const desc = newDesc.trim().toUpperCase();

    if (!cleanRef || !desc) {
      alert("Por favor, informe a Referência SKU e a Descrição do novo produto.");
      return;
    }

    const success = await onRegisterProduct(
      cleanRef,
      desc,
      Number(newPaletizacao)
    );
    if (success) {
      setNewRef("");
      setNewDesc("");
    }
  };

  return (
    <div className="space-y-6 animate-fade-in font-sans">
      
      <div className="bg-white border border-slate-200 rounded-xl p-4 md:p-6 shadow-xs">
        
        {/* Title Area */}
        <div className="pb-4 border-b border-slate-100 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-5 md:mb-6">
          <div>
            <h3 className="text-md font-bold text-slate-800 flex items-center gap-2">
              <Database className="w-5 h-5 text-indigo-600 font-bold" />
              Base de Dados Cerâmicos
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              Catálogo geral de referências homologadas para movimentações logísticas na Porto Brasil.
            </p>
          </div>

          <div className="w-full md:w-80 relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="Pesquisar por código SKU ou descrição..."
              className="w-full bg-slate-50 border border-slate-300 rounded-lg pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 font-medium text-slate-800"
            />
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          
          {/* Form Side - Register New SKU */}
          <div className="lg:col-span-1 bg-slate-50 border border-slate-200 p-5 rounded-xl space-y-4 h-fit">
            <span className="text-xs font-black uppercase tracking-wider text-slate-700 flex items-center gap-1.5 pb-2 border-b border-slate-200">
              <PlusCircle className="w-4 h-4 text-indigo-600" />
              Novo Registro SKU
            </span>

            {isReadOnly ? (
              <div className="flex flex-col items-center justify-center text-center p-3 py-4 bg-amber-50/70 border border-amber-200/55 rounded-xl space-y-2">
                <ShieldAlert className="w-5 h-5 text-amber-600" />
                <span className="text-xs font-black text-amber-800 uppercase block">Conta Restrita</span>
                <p className="text-[10px] text-slate-450 leading-relaxed font-semibold">
                  Esta conta não possui permissão para cadastrar novos SKUs. Solicite ao Administrador a liberação da permissão específica.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="text-[10px] text-slate-500 font-bold uppercase block mb-1">Referência SKU (Ex: 092)</label>
                  <input
                    type="text"
                    value={newRef}
                    onChange={(e) => setNewRef(e.target.value)}
                    placeholder="Código da peça"
                    className="w-full bg-white border border-slate-300 rounded p-2 text-xs font-black uppercase tracking-wide focus:ring-1 focus:ring-indigo-500 focus:outline-none font-mono text-slate-800"
                  />
                  <span className="text-[9px] text-slate-400 mt-1 block">O prefixo 'S' é opcional e será removido para manter o padrão Porto Brasil.</span>
                </div>

                <div>
                  <label className="text-[10px] text-slate-500 font-bold uppercase block mb-1">Descrição Comercial</label>
                  <input
                    type="text"
                    value={newDesc}
                    onChange={(e) => setNewDesc(e.target.value)}
                    placeholder="Ex: RASO MONACO COK INCOLOR"
                    className="w-full bg-white border border-slate-300 rounded p-2 text-xs font-bold uppercase focus:ring-1 focus:ring-indigo-500 focus:outline-none text-slate-800"
                  />
                </div>
                
                <div>
                  <label className="text-[10px] text-slate-500 font-bold uppercase block mb-1">
                    Paletização
                  </label>
                
                  <input
                    type="number"
                    value={newPaletizacao}
                    onChange={(e) =>
                      setNewPaletizacao(e.target.value)
                    }
                    placeholder="Ex: 648"
                    className="w-full bg-white border border-slate-300 rounded p-2 text-xs font-bold"
                  />
                </div>

                <button
                  type="button"
                  onClick={handleAddProduct}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg p-2 text-xs font-bold transition shadow uppercase tracking-wider cursor-pointer"
                >
                  Cadastrar Referência
                </button>
              </div>
            )}
          </div>

          {/* List Side - Items List */}
          <div className="lg:col-span-3 space-y-3">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between text-xs text-slate-500 pb-1 font-bold">
              <span>
                Filtro ativo: exibindo <strong>{page.start}-{page.end}</strong> de {filteredProducts.length} resultados
                ({normalizedCatalog.products.length} SKUs válidos)
              </span>
              <span>Linguagem: Padrão Digital</span>
            </div>

            {normalizedCatalog.invalidRows > 0 && (
              <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-medium text-amber-800">
                {normalizedCatalog.invalidRows} registro(s) sem referência SKU válida foram ignorados para evitar falhas na tela. A base original não foi alterada.
              </div>
            )}

            {page.totalPages > 1 && (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <span className="text-[10px] font-bold text-slate-500">Página {page.pageIndex + 1} de {page.totalPages} · 100 itens por página</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={page.pageIndex === 0}
                    onClick={() => setCurrentPage((value) => Math.max(0, value - 1))}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-[10px] font-bold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" /> Anterior
                  </button>
                  <button
                    type="button"
                    disabled={page.pageIndex >= page.totalPages - 1}
                    onClick={() => setCurrentPage((value) => Math.min(page.totalPages - 1, value + 1))}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-[10px] font-bold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Próxima <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )}

            <div className="hidden md:block divide-y divide-slate-100 bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs max-h-[520px] overflow-y-auto pr-1">
              {filteredProducts.length > 0 ? (
                visibleProducts.map((p) => {
                  const countBalance = productBalanceByReference.get(normalizeSkuReference(p.referencia)) ?? 0;

                  return (
                    <div key={p.referencia} className="p-3 px-4 flex items-center justify-between text-xs hover:bg-slate-50/50 transition">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="font-mono font-black text-xs bg-indigo-50 border border-indigo-250 text-indigo-700 px-3 py-1 rounded-md shrink-0 tracking-wide">
                          {p.referencia}
                        </span>
                        <div className="min-w-0 leading-tight">
                          <span className="text-slate-800 font-extrabold block truncate uppercase">{p.descricao}</span>
                          <span className="text-[10px] text-slate-400 block font-semibold pt-0.5">PEÇA ACABADA • PORTO BRASIL</span>
                        </div>
                      </div>

                      <div className="shrink-0 flex items-center gap-2">
                        <span className="bg-blue-50 text-blue-800 border border-blue-200 text-[10px] font-black px-2.5 py-1 rounded-md">
                          Paletização: {p.paletizacao ?? 0}
                        </span>

                        {countBalance > 0 ? (
                          <span className="bg-emerald-50 text-emerald-800 border border-emerald-200 text-[10px] font-black px-2.5 py-1 rounded-md">
                            Saldo: {countBalance.toLocaleString()} pçs
                          </span>
                        ) : (
                          <span className="bg-slate-100 text-slate-400 border border-slate-200 text-[10px] font-bold px-2.5 py-1 rounded-md">
                            Sem estoque
                          </span>
                        )}

                        {(canEditProduct || canDeleteProduct) && (
                          <>
                            {canEditProduct && <button
                              type="button"
                              onClick={() => {
                                const novaDescricao = prompt("Nova descrição:", p.descricao);
                                const novaPaletizacao = prompt("Nova paletização:", String(p.paletizacao || 0));
                                if (novaDescricao && novaPaletizacao) {
                                  void onUpdateProduct(
                                    p.referencia,
                                    novaDescricao,
                                    Number(novaPaletizacao)
                                  );
                                }
                              }}
                              className="bg-blue-100 text-blue-700 border border-blue-200 text-[10px] font-black px-2 py-1 rounded-md"
                            >
                              Editar
                            </button>}

                            {canDeleteProduct && <button
                              type="button"
                              onClick={() => void onDeleteProduct(p.referencia)}
                              className="bg-red-100 text-red-700 border border-red-200 text-[10px] font-black px-2 py-1 rounded-md"
                            >
                              Excluir
                            </button>}
                          </>
                        )}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="py-20 text-center text-slate-400 font-bold bg-slate-50 leading-relaxed font-sans">
                  Nenhum código SKU correspondente aos filtros foi localizado na base.
                </div>
              )}
            </div>

            <div className="md:hidden max-h-[58vh] overflow-y-auto space-y-2 pr-0.5">
              {filteredProducts.length > 0 ? (
                visibleProducts.map((p) => {
                  const countBalance = productBalanceByReference.get(normalizeSkuReference(p.referencia)) ?? 0;

                  return (
                    <article
                      key={p.referencia}
                      className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <span className="inline-flex max-w-full rounded-md border border-indigo-200 bg-indigo-50 px-2.5 py-1 font-mono text-xs font-black tracking-wide text-indigo-700">
                            {p.referencia}
                          </span>
                          <h4 className="mt-2 break-words text-sm font-extrabold uppercase leading-snug text-slate-800">
                            {p.descricao}
                          </h4>
                          <p className="mt-1 text-[9px] font-semibold uppercase text-slate-400">
                            Peça acabada • Porto Brasil
                          </p>
                        </div>

                        {countBalance > 0 ? (
                          <span className="shrink-0 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[9px] font-black text-emerald-800">
                            {countBalance.toLocaleString()} pçs
                          </span>
                        ) : (
                          <span className="shrink-0 rounded-md border border-slate-200 bg-slate-100 px-2 py-1 text-[9px] font-bold text-slate-400">
                            Sem estoque
                          </span>
                        )}
                      </div>

                      <div className="mt-3 grid grid-cols-1 gap-2">
                        <div className="flex items-center justify-between rounded-lg border border-blue-100 bg-blue-50 px-3 py-2">
                          <span className="text-[9px] font-black uppercase text-blue-700">Paletização</span>
                          <span className="text-xs font-black text-blue-900">{p.paletizacao ?? 0}</span>
                        </div>

                        {(canEditProduct || canDeleteProduct) && (
                          <div className="grid grid-cols-2 gap-2">
                            {canEditProduct && <button
                              type="button"
                              onClick={() => {
                                const novaDescricao = prompt("Nova descrição:", p.descricao);
                                const novaPaletizacao = prompt("Nova paletização:", String(p.paletizacao || 0));
                                if (novaDescricao && novaPaletizacao) {
                                  void onUpdateProduct(
                                    p.referencia,
                                    novaDescricao,
                                    Number(novaPaletizacao)
                                  );
                                }
                              }}
                              className="min-h-10 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-[10px] font-black uppercase text-blue-700"
                            >
                              Editar
                            </button>}

                            {canDeleteProduct && <button
                              type="button"
                              onClick={() => void onDeleteProduct(p.referencia)}
                              className="min-h-10 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[10px] font-black uppercase text-red-700"
                            >
                              Excluir
                            </button>}
                          </div>
                        )}
                      </div>
                    </article>
                  );
                })
              ) : (
                <div className="rounded-xl border border-slate-200 bg-slate-50 py-16 text-center text-xs font-bold leading-relaxed text-slate-400">
                  Nenhum código SKU correspondente aos filtros foi localizado na base.
                </div>
              )}
            </div>
          </div>

        </div>

      </div>

    </div>
  );
};
