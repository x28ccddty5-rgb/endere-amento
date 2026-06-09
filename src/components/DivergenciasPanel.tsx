import React, { useState } from "react";
import { Divergencia, WarehouseSlot, Product, HistoricoMov } from "../types";
import { AlertOctagon, Printer, FileSpreadsheet, Lock, Sparkles, Check, Trash2 } from "lucide-react";
import { generateId } from "../data/mockStorage";

interface DivergenciasPanelProps {
  divergencias: Divergencia[];
  slots: WarehouseSlot[];
  productsList: Product[];
  currentUser: any;
  operator: string;
  launchDate: string;
  onUpdateDivergencias: (updated: Divergencia[]) => void;
  onUpdateSlots: (updated: WarehouseSlot[]) => void;
  onAddHistory: (movs: HistoricoMov[]) => void;
  hasAccess: (level: "Administrador" | "Operador" | "Consulta") => boolean;
}

export const DivergenciasPanel: React.FC<DivergenciasPanelProps> = ({
  divergencias,
  slots,
  productsList,
  currentUser,
  operator,
  launchDate,
  onUpdateDivergencias,
  onUpdateSlots,
  onAddHistory,
  hasAccess,
}) => {
  const [selectedDivergenciaId, setSelectedDivergenciaId] = useState<string | null>(null);
  const [resolveAction, setResolveAction] = useState<"sobrescrever" | "descartar">("sobrescrever");
  const [resolveQty, setResolveQty] = useState<number>(0);
  const [resolveSkuVal, setResolveSkuVal] = useState<string>(""); // SKU Novo (obrigatório) - Corrigido manualmente
  const [resolveDataChacoteVal, setResolveDataChacoteVal] = useState<string>(""); // Data Chacote (opcional)

  const isDivergenciasAdmin = currentUser?.role === "Administrador";

  // Filter to show only "Aberta" divergences first, but user asked:
  // "mudar status para corrigido, gravas no historico e analise se compensa retirar a divergencia e deixar somente as abertas"
  // Let's filter to show Open by default, with a toggle button to show all / corrected ones. This is the master solution!
  const [showOnlyOpen, setShowOnlyOpen] = useState(true);

  const displayedDivergencias = showOnlyOpen 
    ? divergencias.filter(d => d.status === "Aberta")
    : divergencias;

  const openCorrectionDialog = (d: Divergencia) => {
    setSelectedDivergenciaId(d.id);
    setResolveAction("sobrescrever");
    setResolveQty(d.movimentacao);
    setResolveSkuVal(d.refNova || d.refAtual || "");
    setResolveDataChacoteVal(d.dataChacote || "");
  };

  const handleResolveDivergencia = () => {
    if (!selectedDivergenciaId) return;

    const div = divergencias.find(d => d.id === selectedDivergenciaId);
    if (!div) return;

    let cleanSku = "";
    let prod = null;
    
    // Automatically set to today's date "hoje()" (not shown as input)
    const targetDate = new Date().toISOString().slice(0, 10);

    if (resolveAction !== "descartar") {
      // Check mandatory fields: SKU novo e Saldo novo
      cleanSku = resolveSkuVal.trim().toUpperCase();
      if (cleanSku.startsWith("S")) cleanSku = cleanSku.slice(1);

      if (!cleanSku) {
        alert("Falta SKU corrigido. Este campo é obrigatório na resolução manual.");
        return;
      }

      if (resolveQty === undefined || String(resolveQty) === "" || resolveQty < 0) {
        alert("Saldo validado fisicamente é obrigatório e deve ser positivo.");
        return;
      }

      prod = productsList.find(p => p.referencia.toUpperCase() === cleanSku);
      if (!prod) {
        alert(`Código SKU "${cleanSku}" não cadastrado na Base de dados de referências.`);
        return;
      }
    }

    // 1) Define state copies
    let updatedSlots = [...slots];
    let updatedDivergencias = [...divergencias];

    const currentHour = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

    if (resolveAction === "sobrescrever") {
      // Find or create slot to overwrite
      let slotIdx = updatedSlots.findIndex(
        s => s.estoque === div.estoque && s.modulo === div.modulo && s.posicao === div.posicao
      );

      if (slotIdx === -1) {
        // Create new address in memory
        const newSlot: WarehouseSlot = {
          id: `${div.estoque}-${div.modulo}-${div.posicao}`,
          estoque: div.estoque,
          modulo: div.modulo,
          posicao: div.posicao,
          referencia: cleanSku,
          descricao: prod ? prod.descricao : "Produto desconhecido",
          saldo: resolveQty,
          ultimaData: targetDate,
          ultimaHora: currentHour,
          ultimoResponsavel: operator,
          dataChacote: resolveDataChacoteVal,
        };
        updatedSlots.push(newSlot);
      } else {
        // Overwrite existing address slot even if occupied
        updatedSlots[slotIdx] = {
          ...updatedSlots[slotIdx],
          referencia: cleanSku,
          descricao: prod ? prod.descricao : updatedSlots[slotIdx].descricao,
          saldo: resolveQty,
          ultimaData: targetDate,
          ultimaHora: currentHour,
          ultimoResponsavel: operator,
          dataChacote: resolveDataChacoteVal,
        };
      }
    } else if (resolveAction === "descartar") {
      // Force empty coordinate - Zerar Endereço maintains estoque, modulo, posicao, clears SKU, saldo, dataChacote
      let slotIdx = updatedSlots.findIndex(
        s => s.estoque === div.estoque && s.modulo === div.modulo && s.posicao === div.posicao
      );
      if (slotIdx !== -1) {
        updatedSlots[slotIdx] = {
          ...updatedSlots[slotIdx],
          referencia: "",
          descricao: "",
          saldo: 0,
          dataChacote: "",
          ultimaData: targetDate,
          ultimaHora: currentHour,
          ultimoResponsavel: operator,
        };
      }
    }

    // Update divergence item to status Corrigida
    updatedDivergencias = updatedDivergencias.map(d => {
      if (d.id === div.id) {
        return {
          ...d,
          status: "Corrigida",
          refNova: resolveAction === "descartar" ? "" : cleanSku,
          saldoFinal: resolveAction === "descartar" ? 0 : resolveQty,
          dataCorrecao: targetDate,
          corrigidoPor: currentUser?.name || operator,
        };
      }
      return d;
    });

    // Save outputs
    onUpdateSlots(updatedSlots);
    onUpdateDivergencias(updatedDivergencias);

    // Write to timeline history
    const logId = `CORR-${generateId()}`;
    const newLog: HistoricoMov = {
      id: logId,
      dataLancamento: targetDate,
      quemLancou: currentUser?.name || operator,
      data: targetDate,
      estoque: div.estoque,
      modulo: div.modulo,
      posicao: div.posicao,
      referencia: resolveAction === "descartar" ? "" : cleanSku,
      quantidade: resolveAction === "descartar" ? 0 : resolveQty,
      tipo: resolveAction === "descartar" ? "Saída" : "Entrada",
      dataChacote: resolveAction === "descartar" ? "" : (resolveDataChacoteVal || "Reconciliação"),
      hora: currentHour,
      responsavel: operator,
    };
    onAddHistory([newLog]);

    // Cleanup and alerts
    setSelectedDivergenciaId(null);
    alert(`Divergência [${div.id}] corrigida manualmente e sincronizada ao Gêmeo Digital!`);
  };

  const handleExportCSV = () => {
    let csvContent = "\uFEFF"; // BOM for excel utf8
    csvContent += "ID;Data;Estoque;Modulo/Rua;Posicao;Ref Atual;Ref Nova;Movimentacao;Responsavel;Status\n";

    divergencias.forEach(d => {
      csvContent += `${d.id};${d.dataDivergencia};${d.estoque};${d.modulo};${d.posicao || ""};${d.refAtual || ""};${d.refNova || ""};${d.movimentacao};${d.responsavel};${d.status}\n`;
    });

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `Divergencias_PortoBrasil_${launchDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6 animate-fade-in">
      
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs">
        
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-4 border-b border-slate-100 mb-6 no-print">
          <div>
            <h3 className="text-md font-bold text-slate-800 flex items-center gap-2 uppercase tracking-wide">
              <AlertOctagon className="w-5 h-5 text-red-500 animate-pulse" />
              Relatório de Divergências de Estoque
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              Divergências geradas automaticamente no fluxo de lançamentos por conflito físico ou saldo indisponível.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setShowOnlyOpen(!showOnlyOpen)}
              className={`px-3.5 py-2 rounded-lg text-xs font-bold border transition duration-150 cursor-pointer ${
                showOnlyOpen 
                  ? "bg-red-50 hover:bg-red-100 text-red-700 border-red-200" 
                  : "bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-300"
              }`}
            >
              {showOnlyOpen ? "Exibindo: Somente Abertas" : "Exibindo: Todas Divergências"}
            </button>
            <button
              onClick={handleExportCSV}
              className="bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-lg px-3.5 py-2 text-xs font-bold transition flex items-center gap-1.5 cursor-pointer uppercase tracking-wider"
            >
              <FileSpreadsheet className="w-4 h-4" /> Exportar Excel
            </button>
            <button
              onClick={handlePrint}
              className="bg-slate-55 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-lg px-3.5 py-2 text-xs font-bold transition flex items-center gap-1.5 cursor-pointer uppercase tracking-wider"
            >
              <Printer className="w-4 h-4" /> Imprimir Ficha
            </button>
          </div>
        </div>

        {/* STATS AREA */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
          <div className="bg-red-50 border border-red-200 p-4 rounded-xl text-center">
            <span className="text-[10px] uppercase font-black tracking-wider text-red-500 block">Divergências Abertas</span>
            <span className="text-2xl font-black text-red-700 mt-1 block">
              {divergencias.filter(d => d.status === "Aberta").length}
            </span>
          </div>
          <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-xl text-center">
            <span className="text-[10px] uppercase font-black tracking-wider text-emerald-500 block">Tratativas Resolvidas</span>
            <span className="text-2xl font-black text-emerald-700 mt-1 block">
              {divergencias.filter(d => d.status === "Corrigida").length}
            </span>
          </div>
          <div className="bg-slate-50 border border-slate-200 p-4 rounded-xl text-center">
            <span className="text-[10px] uppercase font-black tracking-wider text-slate-450 block">Média de Reconciliação</span>
            <span className="text-2xl font-black text-slate-700 mt-1 block">100% Digital</span>
          </div>
        </div>

        {/* GRID OF DISCREPANCIES */}
        <div className="overflow-x-auto text-[11px] font-sans">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-100 text-slate-600 border-b border-slate-200 uppercase font-black text-[9px] tracking-wider">
                <th className="py-3 px-3">Protocolo</th>
                <th className="py-3 px-3">Data Log</th>
                <th className="py-3 px-3">Motivo Crítico</th>
                <th className="py-3 px-3 font-mono">Estoque</th>
                <th className="py-3 px-3">Módulo / Rua</th>
                <th className="py-3 px-3">Posição</th>
                <th className="py-3 px-3 font-mono text-center">SKU Conflitante</th>
                <th className="py-3 px-3 font-mono text-center">SKU Corrigido</th>
                <th className="py-3 px-3 text-right">Saldo Retido</th>
                <th className="py-3 px-3">Agente</th>
                <th className="py-3 px-3 text-center">Etapa</th>
                {isDivergenciasAdmin && <th className="py-3 px-2 text-center no-print">Ação Lógica</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-150 relative text-[11.5px] font-medium text-slate-700">
              {displayedDivergencias.length > 0 ? (
                displayedDivergencias.map((d) => (
                  <tr key={d.id} className={`hover:bg-slate-50 transition border-b border-slate-150 ${
                    d.status === "Aberta" ? "bg-red-50/15" : "bg-emerald-50/5 opacity-80"
                  }`}>
                    <td className="py-3 px-3 font-extrabold text-blue-600">{d.id}</td>
                    <td className="py-3 px-3 font-mono text-slate-450">{d.dataDivergencia}</td>
                    <td className="py-3 px-3 font-bold text-red-700 max-w-[160px] leading-snug">{d.tipoDivergencia}</td>
                    <td className="py-3 px-3 font-black text-slate-800">{d.estoque.replace("E", "")}</td>
                    <td className="py-3 px-3 font-bold font-mono text-slate-800">{d.modulo.replace(/^[RM]/i, "")}</td>
                    <td className="py-3 px-3 text-slate-700 font-bold font-mono">{d.posicao || "—"}</td>
                    <td className="py-3 px-3 text-center font-mono">
                      {d.refAtual ? (
                        <span className="bg-slate-105 border border-slate-200 text-slate-700 px-1.5 py-0.5 rounded font-black text-[10px]">
                          {d.refAtual}
                        </span>
                      ) : "Vazio"}
                    </td>
                    <td className="py-3 px-3 text-center font-mono">
                      <span className="bg-blue-50 border border-blue-200 text-blue-900 px-1.5 py-0.5 rounded font-black text-[10px]">
                        {d.refNova}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right font-black text-slate-800 pr-6">{d.movimentacao.toLocaleString()} pçs</td>
                    <td className="py-3 px-3 text-slate-600 font-bold">{d.responsavel}</td>
                    <td className="py-3 px-3 text-center">
                      <span className={`text-[9px] font-black px-2 py-0.5 rounded-full border uppercase ${
                        d.status === "Aberta" 
                          ? "bg-red-50 text-red-700 border-red-200" 
                          : "bg-emerald-55 bg-emerald-50 text-emerald-800 border-emerald-200"
                      }`}>
                        {d.status}
                      </span>
                    </td>

                    {isDivergenciasAdmin && (
                      <td className="py-3 px-2 text-center no-print">
                        {d.status === "Aberta" ? (
                          <button
                            onClick={() => openCorrectionDialog(d)}
                            className="bg-slate-900 hover:bg-red-650 hover:bg-black font-extrabold text-[10px] text-white px-2.5 py-1.5 rounded-lg border border-slate-700 transition cursor-pointer"
                          >
                            Corrigir
                          </button>
                        ) : (
                          <div className="text-[10px] text-slate-400 font-bold italic leading-tight">
                            Aprovado {d.dataCorrecao} <br />
                            por {d.corrigidoPor}
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={13} className="py-20 text-center text-slate-400 font-medium bg-slate-50">
                    Fila de divergências zerada! Não há nenhum conflito aberto no estoque do Galpão.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* DIALOG MODAL RESOLVER MANUALMENTE */}
        {selectedDivergenciaId && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 no-print">
            <div className="bg-white border border-slate-250 rounded-xl p-6 shadow-2xl max-w-lg w-full space-y-4 animate-scale-up">
              
              <div className="flex justify-between items-start">
                <div>
                  <span className="text-[10px] text-indigo-605 text-indigo-600 font-bold block uppercase tracking-wider mb-0.5">Auditoria Logística • Correção de Inventário</span>
                  <h4 className="text-md font-black text-slate-920">Ajuste Manual Físico</h4>
                </div>
                <button 
                  onClick={() => setSelectedDivergenciaId(null)}
                  className="text-slate-400 hover:text-slate-700 font-black text-md cursor-pointer"
                >
                  ✕
                </button>
              </div>

              {(() => {
                const div = divergencias.find(d => d.id === selectedDivergenciaId);
                if (!div) return null;
                return (
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs space-y-2 leading-relaxed font-sans text-slate-650">
                    <div>
                      <span className="text-[9px] text-slate-400 block font-bold uppercase">Endereço de Conflito:</span>
                      <strong className="text-slate-800">Estoque {div.estoque.replace("E", "")} • Módulo/Rua: {div.modulo.replace(/^[RM]/i, "")} {div.posicao ? `• Posição: ${div.posicao}` : ""}</strong>
                    </div>
                    <div>
                      <span className="text-[9px] text-slate-400 block font-bold uppercase">Motivo registrado pelo robô:</span>
                      <strong className="text-red-700 font-bold">{div.tipoDivergencia}</strong>
                    </div>
                    <div className="pt-2 border-t border-slate-200/50 text-[10px] italic text-slate-500">
                      OBS: {div.observacao}
                    </div>
                  </div>
                );
              })()}

              <div className="space-y-3 font-sans">
                
                {/* AÇÃO REPARADORA RADIOS */}
                <div className="space-y-2 pb-2 border-b border-slate-100">
                  <label className="text-[10px] font-bold text-slate-450 block uppercase">Ação Logística Corretora:</label>
                  
                  <div className="space-y-1.5 text-xs">
                    <label className="flex items-start gap-2 p-2 border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer transition">
                      <input 
                        type="radio" 
                        name="resolveAction" 
                        value="sobrescrever" 
                        checked={resolveAction === "sobrescrever"}
                        onChange={() => setResolveAction("sobrescrever")}
                        className="mt-0.5"
                      />
                      <div>
                        <strong className="text-slate-800 block text-[11px] font-bold">Sobrescrever Endereçamento Original</strong>
                        <span className="text-slate-400 text-[10px] block font-medium leading-normal mt-0.5">
                          Preenchimento automatico no endereçamento com Sku novo / Saldo Novo / Data do Chacote Novo
                        </span>
                      </div>
                    </label>

                    <label className="flex items-start gap-2 p-2 border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer transition">
                      <input 
                        type="radio" 
                        name="resolveAction" 
                        value="descartar" 
                        checked={resolveAction === "descartar"}
                        onChange={() => setResolveAction("descartar")}
                        className="mt-0.5"
                      />
                      <div>
                        <strong className="text-slate-800 block text-[11px] font-bold">Zerar Endereço (Vaga Limpa)</strong>
                        <span className="text-slate-400 text-[10px] block font-medium leading-none mt-0.5">
                          Limpa o palete da coordenada conflitante, forçando saldo zero (vaga livre).
                        </span>
                      </div>
                    </label>
                  </div>
                </div>

                {resolveAction === "sobrescrever" && (
                  <div className="space-y-3 pt-1">
                    {/* 1. SKU NOVO (Obrigatório) */}
                    <div>
                      <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">SKU NOVO (REFERÊNCIA CORRIGIDA FISICAMENTE) *</label>
                      <input
                        type="text"
                        value={resolveSkuVal}
                        onChange={(e) => setResolveSkuVal(e.target.value)}
                        placeholder="Ex: 092"
                        className="w-full bg-slate-50 border border-slate-300 rounded p-2 text-xs font-black uppercase text-slate-800 focus:ring-1 focus:ring-blue-500"
                      />
                      <p className="text-[9px] text-slate-400 mt-0.5">Informe o código que de fato está no local (apenas números, o prefixo 'S' é auto-removido).</p>
                    </div>

                    {/* 2. SALDO NOVO (Obrigatório) */}
                    <div>
                      <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">SALDO NOVO DISPONÍVEL (VALIDADO FISICAMENTE) *</label>
                      <input
                        type="number"
                        value={resolveQty}
                        onChange={(e) => setResolveQty(Math.max(0, parseInt(e.target.value) || 0))}
                        placeholder="Ex: 1200"
                        className="w-full bg-slate-50 border border-slate-300 rounded p-2 text-xs font-black text-slate-800 focus:ring-1 focus:ring-blue-500"
                      />
                    </div>

                    {/* 3. DATA DO CHACOTE (Opcional) */}
                    <div>
                      <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">DATA DO CHACOTE (OPCIONAL)</label>
                      <input
                        type="text"
                        value={resolveDataChacoteVal}
                        onChange={(e) => setResolveDataChacoteVal(e.target.value)}
                        placeholder="Ex: 09/06/2026"
                        className="w-full bg-slate-50 border border-slate-300 rounded p-2 text-xs font-bold text-slate-800 focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                )}

              </div>

              <div className="flex gap-2 pt-3">
                <button
                  type="button"
                  onClick={handleResolveDivergencia}
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white rounded-lg py-2.5 text-xs font-bold transition shadow cursor-pointer uppercase text-center"
                >
                  Corrigir Divergência
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedDivergenciaId(null)}
                  className="flex-1 bg-slate-200 text-slate-700 rounded-lg py-2.5 text-xs font-bold hover:bg-slate-300 transition cursor-pointer text-center"
                >
                  Cancelar
                </button>
              </div>

            </div>
          </div>
        )}

      </div>

    </div>
  );
};
