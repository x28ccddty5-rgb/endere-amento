import React, { useState } from "react";
import { WarehouseSlot, Product, HistoricoMov } from "../types";
import { Database, Search, Sparkles, PlusCircle, ShoppingBag, Map } from "lucide-react";
import { generateId } from "../data/mockStorage";

interface AisleStoragePanelProps {
  slots: WarehouseSlot[];
  productsList: Product[];
  currentUser: any;
  operator: string;
  launchDate: string;
  onUpdateSlots: (updated: WarehouseSlot[]) => void;
  onAddHistory: (movs: HistoricoMov[]) => void;
  hasAccess: (level: "Administrador" | "Operador" | "Consulta") => boolean;
}

export const AisleStoragePanel: React.FC<AisleStoragePanelProps> = ({
  slots,
  productsList,
  currentUser,
  operator,
  launchDate,
  onUpdateSlots,
  onAddHistory,
  hasAccess,
}) => {
  // Form values
  const [estVal, setEstVal] = useState<string>("1");
  const [corredorVal, setCorredorVal] = useState<string>("");
  const [skuVal, setSkuVal] = useState<string>("");
  const [qtyVal, setQtyVal] = useState<number | "">("");

  // Search filter
  const [searchQuery, setSearchQuery] = useState("");

  const matchedProduct = skuVal.trim()
    ? productsList.find(p => {
        let clean = skuVal.trim().toUpperCase();
        if (clean.startsWith("S")) clean = clean.slice(1);
        return p.referencia.toUpperCase() === clean;
      })
    : null;

  // Corredor items are characterized by posicao === "" (no specific pallet slot height position)
  const isReadOnly = !hasAccess("Operador");

  // Filter slots to only show those that are Corredor slots (posicao is empty)
  // E1 slots are natively floor-based (posicao === ""). We also support E2 and E3 having aisle placements!
  const corredorSlots = slots.filter((s) => s.posicao === "");

  const filteredCorredorSlots = corredorSlots.filter((s) => {
    const q = searchQuery.toLowerCase();
    const refMatch = s.referencia.toLowerCase().includes(q);
    const descMatch = s.descricao.toLowerCase().includes(q);
    const modMatch = s.modulo.toLowerCase().includes(q);
    const estMatch = s.estoque.toLowerCase().includes(q);
    return refMatch || descMatch || modMatch || estMatch;
  });

  const handleLaunchAisle = (type: "Entrada" | "Saída") => {
    if (isReadOnly) {
      alert("Seu nível de permissão (Consulta) não permite efetuar lançamentos lógicos.");
      return;
    }

    const cleanCorredor = corredorVal.trim().toUpperCase().replace(/^[RM]/i, "");
    let cleanSku = skuVal.trim().toUpperCase();
    if (cleanSku.startsWith("S")) cleanSku = cleanSku.slice(1);

    if (!cleanCorredor || !cleanSku || !qtyVal || Number(qtyVal) <= 0) {
      alert("Por favor, preencha corretamente o Estoque, Nº Corredor, Referência SKU e Quantidade.");
      return;
    }

    const product = productsList.find(p => p.referencia.toUpperCase() === cleanSku);
    if (!product) {
      alert(`Código SKU "${cleanSku}" não está registrado na Base de dados.`);
      return;
    }

    const qty = Number(qtyVal);

    // Locate existing Corredor slot
    const slotIdx = slots.findIndex(
      (s) => s.estoque === estVal && s.modulo === cleanCorredor && s.posicao === ""
    );

    let updatedSlots = [...slots];
    let targetSlot: WarehouseSlot;

    if (slotIdx === -1) {
      if (type === "Saída") {
        alert("Não é possível realizar saída de um corredor vazio ou inexistente.");
        return;
      }
      targetSlot = {
        id: `${estVal}-${cleanCorredor}-`,
        estoque: estVal,
        modulo: cleanCorredor,
        posicao: "",
        referencia: product.referencia,
        descricao: product.descricao,
        saldo: qty,
        dataChacote: "Corredor",
        ultimaData: launchDate,
        ultimaHora: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
        ultimoResponsavel: operator,
      };
      updatedSlots.push(targetSlot);
    } else {
      targetSlot = { ...slots[slotIdx] };

      if (type === "Entrada") {
        if (targetSlot.referencia !== "" && targetSlot.referencia.toUpperCase() !== cleanSku) {
          // If occupied, overwrite or alert
          const overwrite = confirm(
            `O corredor ${cleanCorredor} do Estoque ${estVal} está ocupado por ${targetSlot.referencia} (${targetSlot.descricao}). Deseja sobrescrever para o novo SKU "${cleanSku}"?`
          );
          if (!overwrite) return;
          targetSlot.referencia = product.referencia;
          targetSlot.descricao = product.descricao;
          targetSlot.saldo = qty;
        } else {
          targetSlot.referencia = product.referencia;
          targetSlot.descricao = product.descricao;
          targetSlot.saldo += qty;
        }
      } else {
        // Saída
        if (targetSlot.referencia !== cleanSku) {
          alert(`Tentativa de saída do item "${cleanSku}" em corredor ocupado por "${targetSlot.referencia}".`);
          return;
        }
        if (targetSlot.saldo < qty) {
          alert(`Saldo de corredor insuficiente! Saldo atual: ${targetSlot.saldo} pçs.`);
          return;
        }
        targetSlot.saldo -= qty;
        if (targetSlot.saldo === 0) {
          targetSlot.referencia = "";
          targetSlot.descricao = "";
        }
      }

      targetSlot.ultimaData = launchDate;
      targetSlot.ultimaHora = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      targetSlot.ultimoResponsavel = operator;
      updatedSlots = updatedSlots.map((s) => (s.id === targetSlot.id ? targetSlot : s));
    }

    onUpdateSlots(updatedSlots);

    // Create history record
    const newMovement: HistoricoMov = {
      id: `MOV-${generateId()}`,
      dataLancamento: launchDate,
      quemLancou: currentUser?.name || "Sistema",
      data: launchDate,
      estoque: estVal,
      modulo: cleanCorredor,
      posicao: "",
      referencia: product.referencia,
      quantidade: qty,
      tipo: type,
      dataChacote: "Corredor",
      hora: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
      responsavel: operator,
    };

    onAddHistory([newMovement]);

    // Clear inputs
    setCorredorVal("");
    setSkuVal("");
    setQtyVal("");
    alert(`Lançamento de ${type} consolidado no Corredor ${cleanCorredor} do Estoque ${estVal}.`);
  };

  return (
    <div className="space-y-6">
      
      {/* Information Header card */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h3 className="text-md font-bold text-slate-800 flex items-center gap-2">
            <Map className="w-5 h-5 text-blue-600" />
            Endereçamento do tipo Corredor (Sem Posição Vertical)
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            Módulo simplificado para armazenar paletes em corredores livres e áreas flexíveis. Ideal para descargas rápidas e docas.
          </p>
        </div>
        <div className="font-mono text-right text-[11px] text-slate-500 bg-slate-100 p-2 rounded-lg border border-slate-200 shrink-0">
          Total Corredores Ativos: <strong className="text-blue-700 font-extrabold">{corredorSlots.filter(s => s.saldo > 0).length}</strong>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">

        {/* Action Panel Form */}
        <div className="lg:col-span-1 bg-white border border-slate-200 p-5 rounded-xl shadow-xs space-y-4 h-fit">
          <span className="text-xs font-black uppercase tracking-wider text-slate-700 flex items-center gap-1.5 pb-2 border-b border-slate-100">
            <PlusCircle className="w-4 h-4 text-blue-600" />
            Lançar no Corredor
          </span>

          {isReadOnly ? (
            <div className="p-3 bg-red-50 text-red-700 text-[11px] font-semibold rounded-lg border border-red-200 leading-normal">
              Apenas Contas do nível <strong>Apoio, Administrador ou Liderança</strong> podem realizar movimentações.
            </div>
          ) : (
            <div className="space-y-3 font-sans">
              
              <div>
                <label className="text-[10px] text-slate-450 block font-bold mb-1 uppercase">Selecionar Estoque</label>
                <select
                  value={estVal}
                  onChange={(e) => setEstVal(e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded p-2 text-xs font-bold text-slate-800 focus:outline-none"
                >
                  <option value="1">1</option>
                  <option value="2">2</option>
                  <option value="3">3</option>
                </select>
              </div>

              <div>
                <label className="text-[10px] text-slate-450 block font-bold mb-1 uppercase">Nº Corredor / Rua</label>
                <input
                  type="text"
                  value={corredorVal}
                  onChange={(e) => setCorredorVal(e.target.value)}
                  placeholder="Ex: 11"
                  className="w-full bg-white border border-slate-300 rounded p-2 text-xs font-bold uppercase focus:ring-1 focus:ring-blue-500 focus:outline-none font-mono text-slate-800"
                />
              </div>

              <div>
                <label className="text-[10px] text-slate-455 block font-bold mb-1">CÓDIGO SKU (REFERÊNCIA)</label>
                <div className="relative">
                  <input
                    type="text"
                    value={skuVal}
                    onChange={(e) => setSkuVal(e.target.value)}
                    placeholder="Ex: 092"
                    className="w-full bg-white border border-slate-300 rounded p-2 text-xs font-black uppercase tracking-wide focus:ring-1 focus:ring-blue-500 focus:outline-none font-mono text-slate-800"
                  />
                  {matchedProduct && (
                    <span className="absolute right-2.5 top-2.5 text-emerald-500">
                      <Sparkles className="w-3.5 h-3.5" title="Produto cadastrado!" />
                    </span>
                  )}
                </div>
                {matchedProduct ? (
                  <span className="text-[10px] text-emerald-600 font-bold block mt-1 leading-tight truncate">
                    ✓ {matchedProduct.descricao}
                  </span>
                ) : skuVal.trim() ? (
                  <span className="text-[10px] text-red-500 font-bold block mt-1 leading-tight">
                    ✗ SKU não cadastrado
                  </span>
                ) : null}
              </div>

              <div>
                <label className="text-[10px] text-slate-450 block font-bold mb-1 uppercase">Quantidade (Peças)</label>
                <input
                  type="number"
                  value={qtyVal}
                  onChange={(e) => setQtyVal(e.target.value === "" ? "" : Math.max(1, parseInt(e.target.value)))}
                  placeholder="Ex: 1500"
                  className="w-full bg-white border border-slate-300 rounded p-2 text-xs font-mono font-bold text-slate-800 focus:outline-none"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => handleLaunchAisle("Entrada")}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg py-2 text-xs font-bold transition shadow-xs cursor-pointer uppercase text-center"
                >
                  Entrada
                </button>
                <button
                  type="button"
                  onClick={() => handleLaunchAisle("Saída")}
                  className="flex-1 bg-red-655 bg-red-600 hover:bg-red-700 text-white rounded-lg py-2 text-xs font-bold transition shadow-xs cursor-pointer uppercase text-center"
                >
                  Saída
                </button>
              </div>

            </div>
          )}
        </div>

        {/* Listing of Corridor Items */}
        <div className="lg:col-span-3 bg-white border border-slate-200 p-5 rounded-xl shadow-xs space-y-4">
          
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
            <span className="text-xs font-black uppercase tracking-wider text-slate-500 block">Saldos de Corredor Ativos</span>
            <div className="w-full md:w-64 relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filtrar por SKU, corredor, estoque..."
                className="w-full bg-slate-50 border border-slate-300 rounded-lg pl-8 pr-3 py-1.5 text-xs font-medium focus:outline-none"
              />
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
            </div>
          </div>

          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase text-[9px] tracking-wider font-extrabold">
                  <th className="p-3 px-4">Estoque</th>
                  <th className="p-3 px-4">Nº Corredor / Rua</th>
                  <th className="p-3 px-4 font-mono text-center">Referência SKU</th>
                  <th className="p-3 px-4">Descrição Cerâmica</th>
                  <th className="p-3 px-4 text-right">Saldo Físico (pçs)</th>
                  <th className="p-3 px-4">Modificado Em</th>
                  <th className="p-3 px-4">Operador</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                {filteredCorredorSlots.filter(s => s.saldo > 0).length > 0 ? (
                  filteredCorredorSlots.filter(s => s.saldo > 0).map((s) => (
                    <tr key={s.id} className="hover:bg-slate-50">
                      <td className="p-3 px-4 text-blue-600 font-extrabold">{s.estoque.replace("E", "")}</td>
                      <td className="p-3 px-4 font-bold">{s.modulo.replace(/^[RM]/i, "")}</td>
                      <td className="p-3 px-4 text-center">
                        <span className="bg-blue-50 text-blue-900 border border-blue-200 text-[10px] font-mono font-black px-2 py-0.5 rounded">
                          {s.referencia}
                        </span>
                      </td>
                      <td className="p-3 px-4 truncate max-w-[200px] text-slate-600 font-bold">{s.descricao}</td>
                      <td className="p-3 px-4 text-right font-black font-mono pr-6 text-slate-900">
                        {s.saldo.toLocaleString()} pçs
                      </td>
                      <td className="p-3 px-4 text-slate-400 text-[11px] font-mono">{s.ultimaData} {s.ultimaHora}</td>
                      <td className="p-3 px-4 text-slate-650 text-[11px] font-bold">{s.ultimoResponsavel}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="py-16 text-center text-slate-400 bg-slate-50 font-normal leading-relaxed">
                      Nenhum palete em endereçamento corredor localizado nessa busca. <br />
                      <span className="text-[10px] text-slate-400 block mt-1">Utilize a ficha de cadastro ao lado para registrar paletes.</span>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

        </div>

      </div>

    </div>
  );
};
