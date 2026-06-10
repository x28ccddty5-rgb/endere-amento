import React, { useState } from "react";
import { Product, WarehouseSlot } from "../types";
import { Database, Search, PlusCircle, ShieldAlert, Check } from "lucide-react";

interface BaseDeDadosPanelProps {
  productsList: Product[];
  slots: WarehouseSlot[];
  onRegisterProduct: (ref: string, desc: string) => Promise<boolean>;
  hasAccess: (level: "Administrador" | "Operador" | "Consulta") => boolean;
  currentUser: any;
}

export const BaseDeDadosPanel: React.FC<BaseDeDadosPanelProps> = ({
  productsList,
  slots,
  onRegisterProduct,
  hasAccess,
  currentUser,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [newRef, setNewRef] = useState("");
  const [newDesc, setNewDesc] = useState("");

  const isReadOnly = !hasAccess("Operador");
  
  const canEditBase =
  currentUser?.role === "Administrador" ||
  currentUser?.role === "Lideranca";

  const filteredProducts = productsList.filter((p) => {
    const q = searchQuery.toLowerCase();
    const refMatch = p.referencia.toLowerCase() === q;
    const descMatch = p.descricao.toLowerCase().includes(q);
    return refMatch || descMatch;
  });

  const handleAddProduct = async () => {
     if (!canEditBase) {
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

    const success = await onRegisterProduct(cleanRef, desc);
    if (success) {
      setNewRef("");
      setNewDesc("");
    }
  };

  return (
    <div className="space-y-6 animate-fade-in font-sans">
      
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs">
        
        {/* Title Area */}
        <div className="pb-4 border-b border-slate-100 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
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
              onChange={(e) => setSearchQuery(e.target.value)}
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
                  Apenas operadores dos níveis <strong>Lideranca ou Administrador</strong> podem cadastrar novos modelos cerâmicos.
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
            <div className="flex items-center justify-between text-xs text-slate-500 pb-1 font-bold">
              <span>Filtro Ativo: exibindo <strong>{filteredProducts.length}</strong> itens de {productsList.length}</span>
              <span>Linguagem: Padrão Digital</span>
            </div>

            <div className="divide-y divide-slate-100 bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs max-h-[520px] overflow-y-auto pr-1">
              {filteredProducts.length > 0 ? (
                filteredProducts.map((p) => {
                  // Compute total inventory balance dynamically for this references item across all active slots
                  const countBalance = slots
                    .filter(s => {
                      let sRef = s.referencia.toUpperCase();
                      if (sRef.startsWith("S")) sRef = sRef.slice(1);
                      let pRef = p.referencia.toUpperCase();
                      if (pRef.startsWith("S")) pRef = pRef.slice(1);
                      return sRef === pRef;
                    })
                    .reduce((acc, s) => acc + s.saldo, 0);

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
                        {countBalance > 0 ? (
                          <span className="bg-emerald-50 text-emerald-800 border border-emerald-200 text-[10px] font-black px-2.5 py-1 rounded-md">
                            Saldo: {countBalance.toLocaleString()} pçs
                          </span>
                        ) : (
                          <span className="bg-slate-100 text-slate-400 border border-slate-200 text-[10px] font-bold px-2.5 py-1 rounded-md">
                            Sem estoque
                          </span>
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
          </div>

        </div>

      </div>

    </div>
  );
};
