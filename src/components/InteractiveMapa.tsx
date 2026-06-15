import React, { useState } from "react";
import { WarehouseSlot, Product } from "../types";
import { Map, Info, User, Calendar, Sliders, Check, Hammer, Package } from "lucide-react";
import { VerticalModuleMap } from "./VerticalModuleMap";

interface InteractiveMapaProps {
  slots: WarehouseSlot[];
  onQuickUpdateSlot: (updatedSlot: WarehouseSlot) => void;
  productsList: Product[];
  currentUser: any;
}

export const InteractiveMapa: React.FC<InteractiveMapaProps> = ({
  slots,
  onQuickUpdateSlot,
  productsList,
  currentUser
}) => {

  const role =
  currentUser?.role
    ?.toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  
  const isReadOnly = role !== "administrador";
  
  const [selectedEstoque, setSelectedEstoque] = useState<string>("1");

  const [viewMode, setViewMode] = useState<
    "operacional" | "vertical"
  >("operacional");
    
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  
  // Modules and Ruas helpers
  const [selectedE2Module, setSelectedE2Module] = useState<number>(100);
  const [selectedE3Module, setSelectedE3Module] = useState<number>(50);

  // Quick edit status
  const [editingSlotId, setEditingSlotId] = useState<string | null>(null);
  const [editRef, setEditRef] = useState("");
  const [editQty, setEditQty] = useState<number>(0);
  const [editChacote, setChacote] = useState("");
  const [editOperator, setEditOperator] = useState("");

  const e1Capacidade: Record<string, number> = {
  "1": 27,
  "2": 27,
  "3": 30,
  "4": 33,
  "5": 33,
  "6": 33,
  "7": 30,
  "8": 30,
  "9": 33,
  "10": 33,
  "11": 33,
  "12": 30,
  "13": 33,
  "14": 33,
  "15": 30,
  "16": 27,
  "17": 33,
  "18": 33,
  "19": 33,
  "20": 33,
  "21": 30
};

  const capacidadeTotalE1 = Object.values(e1Capacidade)
  .reduce((total, capacidade) => total + capacidade, 0);
  
  const activeSlots = slots.filter(s => s.estoque === selectedEstoque);
  const selectedSlot = slots.find(s => s.id === selectedSlotId);

  const ruaSelecionada = selectedEstoque === "1"
  ? slots.filter(
      s =>
        s.estoque === "1" &&
        s.modulo === selectedSlot?.modulo &&
        s.saldo > 0
    )
  : [];

  const paletesRua = ruaSelecionada.reduce((total, slot) => {

  const produto = productsList.find(
    p => p.referencia === slot.referencia
  );

  if (!produto?.paletizacao) {
    return total;
  }

  const resultado = slot.saldo / produto.paletizacao;

  if (resultado < 0.5) {
    return total;
  }

  return total + Math.ceil(resultado);

}, 0);

  const capacidadeRuaSelecionada =
    selectedSlot?.estoque === "1"
      ? e1Capacidade[selectedSlot.modulo] || 33
      : 0;
  const livresRua =
  capacidadeRuaSelecionada - paletesRua;
  
  // Lists definitions (plain numbers!)
  const e1Ruas = Array.from({ length: 21 }, (_, i) => String(i + 1));
  
  const e2Positions = ["A1", "B1", "C1", "D1", "E1", "A2", "B2", "C2", "D2", "E2"];
  const e3Positions = ["A1", "B1", "C1", "D1", "E1", "F1", "A2", "B2", "C2", "D2", "E2", "F2"];
  
  const e2BlockedPositions: Record<number, string[]> = {
  4: ["E1"],

  7: ["A2", "B2", "C2", "D2", "E2"],
  8: ["A2", "B2", "C2", "D2", "E2"],

  11: ["A1", "B1", "C1", "A2", "B2", "C2"],
  18: ["A1", "B1", "C1", "A2", "B2", "C2"],

  21: ["A2", "B2", "C2", "D2", "E2"],
  22: ["A2", "B2", "C2", "D2", "E2"],

  25: ["A1", "B1", "C1", "A2", "B2", "C2"],
  32: ["A1", "B1", "C1", "A2", "B2", "C2"],

  35: ["A2", "B2", "C2", "D2", "E2"],
  36: ["A2", "B2", "C2", "D2", "E2"],

  39: ["A1", "B1", "C1", "A2", "B2", "C2", "D2", "E2"],
  46: ["A1", "B1", "C1", "A2", "B2", "C2"],

  49: ["A2", "B2", "C2", "D2", "E2"],

  52: ["A1", "B1", "C1", "A2", "B2", "C2"],
  59: ["A1", "B1", "C1", "A2", "B2", "C2"],

  62: ["A2", "B2", "C2", "D2", "E2"],

  65: ["A1", "B1", "C1", "A2", "B2", "C2"],

  72: ["A1", "B1", "C1", "A2", "B2", "C2", "D1", "E1"],

  75: ["A2", "B2", "C2", "D2", "E2"],
  76: ["A2", "B2", "C2", "D2", "E2"],

  79: ["A1", "B1", "C1", "A2", "B2", "C2", "D2", "E2"],
  86: ["A1", "B1", "C1", "A2", "B2", "C2"],

  89: ["A2", "B2", "C2", "D2", "E2"],
  90: ["A2", "B2", "C2", "D2", "E2"],

  93: ["A1", "B1", "C1", "A2", "B2", "C2"],
  100: ["A1", "B1", "C1", "A2", "B2", "C2"],

  103: ["A2", "B2", "C2", "D2", "E2"],
  104: ["A2", "B2", "C2", "D2", "E2"],

  107: ["A1", "B1", "C1", "A2", "B2", "C2"],

  114: ["A1", "B1", "C1", "A2", "B2", "C2", "D1", "E1"],

  117: ["A2", "B2", "C2", "D2", "E2"],

  120: ["A1", "B1", "C1", "A2", "B2", "C2"],
  125: ["A1", "B1", "C1", "A2", "B2", "C2"],

  128: ["A2", "B2", "C2", "D2", "E2"],
  129: ["A2", "B2", "C2", "D2", "E2"],

  132: ["A1", "B1", "C1", "A2", "B2", "C2"],
  139: ["A1", "B1", "C1", "A2", "B2", "C2"],

  142: ["A2", "B2", "C2", "D2", "E2"],
  143: ["A2", "B2", "C2", "D2", "E2"],

  146: ["A1", "B1", "C1", "A2", "B2", "C2", "D2", "E2"],
  153: ["A1", "B1", "C1", "A2", "B2", "C2"],

  156: ["A2", "B2", "C2", "D2", "E2"],

  157: ["A1", "B1", "C1", "A2", "B2", "C2"],

  164: ["A1", "B1", "C1", "A2", "B2", "C2", "D2", "E2"],

  167: ["A2", "B2", "C2", "D2", "E2"],
  168: ["A2", "B2", "C2", "D2", "E2"],
};

  const e3BlockedPositions: Record<number, string[]> = {
  11: ["A1", "B1", "C1", "A2", "B2", "C2", "F1", "F2"],
  22: ["A1", "B1", "C1", "A2", "B2", "C2", "F1", "F2"],
  41: ["A1", "B1", "C1", "A2", "B2", "C2", "F1", "F2"],
  49: ["A1", "B1", "C1", "A2", "B2", "C2", "F1", "F2"],
  60: ["A1", "B1", "C1", "A2", "B2", "C2", "F1", "F2"],
  68: ["A1", "B1", "C1", "A2", "B2", "C2", "F1", "F2"],
  81: ["A1", "B1", "C1", "A2", "B2", "C2", "F1", "F2"],
  87: ["F2"],
  89: ["A1", "B1", "C1", "A2", "B2", "C2", "F1", "F2"],
  95: ["A2", "B2", "C2", "D2", "E2", "F2"],
  101: ["F1"],
  62: ["F1"]
};

  const e3ExtraPositions: Record<number, string[]> = {
  7: ["G1", "H1", "I1", "G2", "H2", "I2"],
  8: ["G1", "H1", "I1", "G2", "H2"],
  9: ["G1", "G2"],
  124: ["G1", "G2"],
  125: ["G1", "G2"]
};
  
    const blockedE2Positions =
  e2BlockedPositions[selectedE2Module] || [];

  const blockedE3Positions =
  e3BlockedPositions[selectedE3Module] || [];

  const extraE3Positions =
  e3ExtraPositions[selectedE3Module] || [];

  const buildVerticalRows = (positions: string[]) => {

    const ruas = [...new Set(
    positions.map(pos => pos[0])
  )].sort().reverse();

  return ruas.map((rua) => ({
    rua,
    andar1: `${rua}1`,
    andar2: `${rua}2`,
  }));
};
    
  const verticalRows =
  selectedEstoque === "2"
    ? buildVerticalRows(e2Positions)
    : buildVerticalRows([
        ...e3Positions,
        ...extraE3Positions
      ]);

  const getOccupancyStatus = (
  slot: WarehouseSlot,
  estoque: string
) => {
  
  if (estoque === "1") {
  return {
    percentage: 0,
    status: slot.saldo >= 1000
      ? "warning"
      : slot.saldo > 0
        ? "normal"
        : "empty"
  };
}
  
  const produto = productsList.find(
    p => p.referencia === slot.referencia
  );

  if (!produto?.paletizacao || slot.saldo <= 0) {
    return {
      percentage: 0,
      status: "empty"
    };
  }

  const occupancy =
    (slot.saldo / produto.paletizacao) * 100;

  const rua = slot.posicao[0];

  // Estoque 3 - ruas sem tolerância
  if (
    estoque === "3" &&
    ["A", "C", "E"].includes(rua)
  ) {
    return {
      percentage: occupancy,
      status:
        occupancy > 100
          ? "over"
          : "normal"
    };
  }

  // Estoque 2 e ruas B/D/F

  if (occupancy <= 100) {
    return {
      percentage: occupancy,
      status: "normal"
    };
  }

  if (occupancy <= 120) {
    return {
      percentage: occupancy,
      status: "warning"
    };
  }

  return {
    percentage: occupancy,
    status: "over"
  };
};
  
  // Handle slot selection
  const handleSelectSlot = (s: WarehouseSlot) => {
    setSelectedSlotId(s.id);
    setEditingSlotId(null);
  };

  const startEditSlot = (s: WarehouseSlot) => {
    setEditingSlotId(s.id);
    setEditRef(s.referencia);
    setEditQty(s.saldo);
    setChacote(s.dataChacote);
    setEditOperator(s.ultimoResponsavel || "Matheus Costa");
  };

  const saveQuickCorrection = () => {
    if (!selectedSlot) return;

    let cleanRef = editRef.trim().toUpperCase();
    if (cleanRef.startsWith("S")) {
      cleanRef = cleanRef.slice(1);
    }

    let desc = "";
    if (cleanRef !== "") {
      const prod = productsList.find(p => p.referencia.toUpperCase() === cleanRef);
      desc = prod ? prod.descricao : "Sku Reajustado";
    }

    const updated: WarehouseSlot = {
      ...selectedSlot,
      referencia: cleanRef,
      descricao: desc,
      saldo: Number(editQty),
      dataChacote: editChacote,
      ultimaData: new Date().toLocaleDateString("pt-BR"),
      ultimaHora: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
      ultimoResponsavel: editOperator || "Administrador",
    };

    if (updated.saldo === 0) {
      updated.referencia = "";
      updated.descricao = "";
      updated.dataChacote = "";
    }

    onQuickUpdateSlot(updated);
    setEditingSlotId(null);
    setSelectedSlotId(updated.id);
  };

  // Get or dynamically create slot on map interactions so user never faces a broken state
  const getOrCreateSlotOnMap = (est: string, m: string, p: string): WarehouseSlot => {
    const existing = slots.find(s => 
      s.estoque === est && 
      s.modulo === m && 
      s.posicao === p
    );
    if (existing) return existing;
    return {
      id: `${est}-${m}-${p}`,
      estoque: est,
      modulo: m,
      posicao: p,
      referencia: "",
      descricao: "",
      saldo: 0,
      dataChacote: "",
      ultimaData: "",
      ultimaHora: "",
      ultimoResponsavel: "",
    };
  };

  const occupiedPalletsE1 = slots
  .filter(
    s =>
      s.estoque === "1" &&
      s.referencia &&
      s.saldo > 0
  )
  .reduce((total, slot) => {

    const produto = productsList.find(
      p => p.referencia === slot.referencia
    );

    if (!produto?.paletizacao) {
      return total;
    }

    const resultado = slot.saldo / produto.paletizacao;

    if (resultado < 0.5) {
      return total;
    }

    return total + Math.ceil(resultado);

  }, 0);
  
  // Occupancy summary
  const occupiedCount =
  selectedEstoque === "1"
    ? occupiedPalletsE1
    : activeSlots.filter(
        s =>
          s.referencia &&
          s.referencia.trim() !== "" &&
          s.saldo > 0
      ).length;
  
  console.log("Total slots E2:", activeSlots.length);
  console.log("Ocupados:", occupiedCount);
  
  // Estimated representative total
  const totalCount =
  selectedEstoque === "1"
    ? capacidadeTotalE1
    : selectedEstoque === "2"
      ? 1373
      : 112 * 12;

  const occRate = totalCount > 0 ? (occupiedCount / totalCount) * 100 : 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6" id="digital-twin-container">
      
      {/* MAP VIEWER COLSPAN 3 */}
      <div className="lg:col-span-3 bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-6">
        
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <Map className="w-5 h-5 text-blue-600" />
              Gêmeo Digital (Mapa do Galpão)
            </h3>
            <p className="text-xs text-slate-400">
              Corredores, ruas, módulos e posições físicas de armazenagem por taxa de ocupação.
            </p>
          </div>

          {/* Switch Stock 1, 2, 3 */}
          <div className="flex bg-slate-100 p-1 rounded-lg gap-1 border border-slate-200">
            {["1", "2", "3"].map((est) => (
              <button
                key={est}
                onClick={() => {
                  setSelectedEstoque(est);
                  setSelectedSlotId(null);
                }}
                className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all cursor-pointer ${
                  selectedEstoque === est
                    ? "bg-slate-800 text-white shadow-xs"
                    : "text-slate-500 hover:text-slate-800"
                }`}
              >
                Estoque {est}
              </button>
            ))}
          </div>
        </div>

              {selectedEstoque !== "1" && (
        <div className="flex bg-slate-100 p-1 rounded-lg gap-1 border border-slate-200 mt-2">
          
          <button
            onClick={() => setViewMode("operacional")}
            className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all cursor-pointer ${
              viewMode === "operacional"
                ? "bg-slate-800 text-white shadow-xs"
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            Operacional
          </button>
      
          <button
            onClick={() => setViewMode("vertical")}
            className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all cursor-pointer ${
              viewMode === "vertical"
                ? "bg-slate-800 text-white shadow-xs"
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            Vista Física
          </button>
      
        </div>
      )}

        {/* Dynamic Warehouse Status Bar */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-slate-50 border border-slate-200 rounded-lg p-4">
          <div>
            <span className="text-[10px] text-slate-400 block font-bold uppercase">Área do Galpão</span>
            <span className="text-sm font-black text-slate-800">GALPÃO PRINCIPAL</span>
          </div>
          <div>
            <span className="text-[10px] text-slate-400 block font-bold uppercase font-sans">Capacidade Ocupada</span>
            <span className="text-sm font-black text-slate-800 font-mono">
              {occupiedCount} vagas ({occRate.toFixed(2)}%)
            </span>
          </div>
          <div>
            <span className="text-[10px] text-slate-400 block font-bold uppercase">Estrutura de Armazenamento</span>
            <span className="text-xs font-bold text-slate-600 leading-tight">
              {selectedEstoque === "1" && "21 Ruas (Sem posições definidas)"}
              {selectedEstoque === "2" && "172 Módulos (Capacidade ajustada para túneis e pilares)"}
              {selectedEstoque === "3" && "112 Módulos (Capacidade ajustada para túneis, pilares e módulos especiais)"}
            </span>
          </div>
          <div>
            <span className="text-[10px] text-slate-400 block font-bold uppercase">Unidade Base</span>
            <span className="text-xs font-bold text-blue-600">Peças (pçs)</span>
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-6 justify-end text-xs text-slate-500 bg-white pb-2 border-b border-slate-100">
          <span className="flex items-center gap-1.5">
            <span className="w-3.5 h-3.5 bg-slate-100 border border-slate-300 rounded block"></span> Vazio
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3.5 h-3.5 bg-blue-100 border border-blue-200 rounded block"></span> Até 100% da capacidade </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3.5 h-3.5 bg-blue-600 border border-blue-700 rounded block"></span> Faixa de tolerância (100%-120%) </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3.5 h-3.5 bg-red-500 border border-red-700 rounded block"></span>Acima da capacidade</span>
        </div>

        {/* LAYOUT MAP VIEWER */}
        <div className="overflow-x-auto pt-2">
          {selectedEstoque === "1" ? (
            /* E1 GRID VIEWER: 22 RUAS */
            <div className="space-y-4">
              <span className="text-xs font-bold text-slate-500 block">MAPA DE RUAS 1 (Selecione uma rua para inspecionar):</span>
              <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3">
                {e1Ruas.map((rua) => {
                  const s = getOrCreateSlotOnMap("1", rua, "");

                 const ocupacaoReal = slots
                  .filter(
                    x =>
                      x.estoque === "1" &&
                      x.modulo === rua &&
                      x.saldo > 0
                  )
                  .reduce((total, x) => {
                
                    const produto = productsList.find(
                      p => p.referencia === x.referencia
                    );
                
                    if (!produto?.paletizacao) {
                      return total;
                    }
                
                    const resultado = x.saldo / produto.paletizacao;
                
                    let paletes = 0;
                
                    if (resultado >= 0.5) {
                      paletes = Math.ceil(resultado);
                    }
                
                    return total + paletes;
                
                  }, 0);
                
                const capacidadeRua = e1Capacidade[rua] || 33;

                const percentualOcupacao = Math.round(
                (ocupacaoReal / capacidadeRua) * 100
              );
              
                  const isOccupied = s.saldo > 0;
                  const isSelected = selectedSlotId === s.id;
              
                  const occupancy = getOccupancyStatus(
                  s,
                  selectedEstoque
                );

                  let cardColor = "bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-500";
                  if (isOccupied) {

                if (occupancy.status === "normal") {
              
                  cardColor =
                    "bg-blue-100 text-blue-900 border-blue-200";
              
                } else if (occupancy.status === "warning") {
              
                  cardColor =
                    "bg-blue-600 text-white border-blue-700 shadow-sm";
              
                } else if (occupancy.status === "over") {
              
                  cardColor =
                    "bg-red-500 text-white border-red-700 shadow-sm";
              
                }
              
              }
                  if (isSelected) {
                    cardColor += " ring-4 ring-yellow-400 ring-offset-2 shadow-xl scale-[1.02] z-10 relative";
                  }

                  return (
                    <div
                      key={rua}
                      onClick={() => handleSelectSlot(s)}
                      className={`border rounded-lg p-3 text-center cursor-pointer transition-all flex flex-col justify-between h-24 ${cardColor}`}
                    >
                      <span className="text-[10px] uppercase font-black block tracking-wider opacity-80">RUA</span>
                      <span className="text-xl font-black font-sans leading-none my-1">{rua}</span>
                      <div className="text-[10px] font-bold leading-normal">
                        {ocupacaoReal}/{capacidadeRua} paletes
                      </div>

                      <div className="text-[9px] opacity-70">
                        {percentualOcupacao}%
                      </div>

                      <div className="text-[9px] opacity-60">
                        {capacidadeRua - ocupacaoReal} livres
                      </div>
                      
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            /* E2 OR E3 DRILLDOWN MODULE SELECTOR */
            <div className="space-y-6">
              
              {/* Module selection bar to avoid massive render of too many modules */}
              <div className="bg-slate-50 border border-slate-200 p-4 rounded-xl flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <Package className="w-5 h-5 text-blue-600" />
                  <div>
                    <span className="text-xs font-bold text-slate-700 block">Navegar por Módulos Estruturais:</span>
                    <span className="text-[10px] text-slate-400 block">Selecione o número do módulo para abrir as gavetas</span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {selectedEstoque === "2" ? (
                    <>
                      <label className="text-xs font-bold text-slate-600">Módulo (1 a 172):</label>
                      <input 
                        type="number" 
                        min="1" 
                        max="172" 
                        value={selectedE2Module}
                        onChange={(e) => {
                          const val = Math.max(1, Math.min(172, Number(e.target.value)));
                          setSelectedE2Module(val);
                          setSelectedSlotId(null);
                        }}
                        className="w-20 bg-white border border-slate-300 rounded px-2 py-1 text-xs font-bold focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                      <div className="flex gap-1">
                        <button 
                          onClick={() => { setSelectedE2Module(m => Math.max(1, m - 1)); setSelectedSlotId(null); }}
                          className="px-2 py-1 bg-white border border-slate-300 text-xs rounded hover:bg-slate-100 font-bold cursor-pointer"
                        >
                          -1
                        </button>
                        <button 
                          onClick={() => { setSelectedE2Module(m => Math.min(172, m + 1)); setSelectedSlotId(null); }}
                          className="px-2 py-1 bg-white border border-slate-300 text-xs rounded hover:bg-slate-100 font-bold cursor-pointer"
                        >
                          +1
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <label className="text-xs font-bold text-slate-600">Módulo (1 a 112):</label>
                      <input 
                        type="number" 
                        min="1" 
                        max="112" 
                        value={selectedE3Module}
                        onChange={(e) => {
                          const val = Math.max(1, Math.min(112, Number(e.target.value)));
                          setSelectedE3Module(val);
                          setSelectedSlotId(null);
                        }}
                        className="w-20 bg-white border border-slate-300 rounded px-2 py-1 text-xs font-bold focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                      <div className="flex gap-1">
                        <button 
                          onClick={() => { setSelectedE3Module(m => Math.max(1, m - 1)); setSelectedSlotId(null); }}
                          className="px-2 py-1 bg-white border border-slate-300 text-xs rounded hover:bg-slate-100 font-bold cursor-pointer"
                        >
                          -1
                        </button>
                        <button 
                          onClick={() => { setSelectedE3Module(m => Math.min(112, m + 1)); setSelectedSlotId(null); }}
                          className="px-2 py-1 bg-white border border-slate-300 text-xs rounded hover:bg-slate-100 font-bold cursor-pointer"
                        >
                          +1
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* DRAW SHELVES GRID MAP */}
              <div>
                <span className="text-xs font-bold text-slate-500 block mb-3 uppercase tracking-wider">
                  Layout Físico das Vagas • Módulo {selectedEstoque === "2" ? selectedE2Module : selectedE3Module}:
                </span>

                {viewMode === "vertical" && (
                <VerticalModuleMap
                  rows={verticalRows}

                  blockedPositions={
                  selectedEstoque === "2"
                    ? blockedE2Positions
                    : blockedE3Positions
                }
                  
                  selectedEstoque={selectedEstoque}
                
                  getSlot={getOrCreateSlotOnMap}

                  getOccupancyStatus={getOccupancyStatus}
                  
                  onSelectSlot={handleSelectSlot}
                
                  selectedSlotId={selectedSlotId}
                
                  selectedModule={
                    selectedEstoque === "2"
                      ? selectedE2Module
                      : selectedE3Module
                  }
                />
              )}
              
              {viewMode === "operacional" && (
                
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  {selectedEstoque === "2" ? (
                    
                    e2Positions
                      .filter((pos) => !blockedE2Positions.includes(pos))
                      .map((pos) => {
                      const modStr = String(selectedE2Module);
                      const s = getOrCreateSlotOnMap("2", modStr, pos);
                      const isOccupied = s.saldo > 0;
                      const isSelected = selectedSlotId === s.id;
                        
                      const occupancy = getOccupancyStatus(
                      s,
                      selectedEstoque
                    );

                      let cellBg =
                      "bg-slate-50 hover:bg-slate-100 text-slate-400 border-dashed border-slate-300";
                    
                    if (isOccupied) {
                    
                      if (occupancy.status === "normal") {
                    
                        cellBg =
                          "bg-blue-100 hover:bg-blue-200 text-blue-900 border-blue-200 font-medium";
                    
                      } else if (occupancy.status === "warning") {
                    
                        cellBg =
                          "bg-blue-600 hover:opacity-90 text-white border-blue-700 font-bold";
                    
                      } else if (occupancy.status === "over") {
                    
                        cellBg =
                          "bg-red-500 hover:bg-red-600 text-white border-red-700 font-bold";
                    
                      }
                    
                    }
                      if (isSelected) {
                        cellBg += " ring-4 ring-yellow-400 ring-offset-2 shadow-xl scale-[1.02] z-10 relative";
                      }

                      return (
                        <div
                          key={pos}
                          onClick={() => handleSelectSlot(s)}
                          className={`border rounded-lg p-3 h-24 text-center cursor-pointer transition flex flex-col justify-between ${cellBg}`}
                          title={`Módulo ${modStr} Posição ${pos} - ${s.referencia || "Vazio"}`}
                        >
                          <span className="text-[10px] opacity-75 font-mono uppercase block text-left">
                            Posição {pos}
                          </span>
                          <span className="text-lg font-black block tracking-tight my-1">
                            {s.referencia || "—"}
                          </span>
                          <span className="text-[10px] text-right block opacity-75">
                            {isOccupied ? `${s.saldo} pçs` : "Vazio"}
                          </span>
                        </div>
                      );
                    })
                  ) : (
                    [...e3Positions, ...extraE3Positions]
                    .filter((pos) => !blockedE3Positions.includes(pos))
                    .map((pos) => {
                        
                      const modStr = String(selectedE3Module);
                      const s = getOrCreateSlotOnMap("3", modStr, pos);
                      const isOccupied = s.saldo > 0;
                      const isSelected = selectedSlotId === s.id;
                      
                      const occupancy = getOccupancyStatus(
                      s,
                      selectedEstoque
                    );

                      let cellBg = "bg-slate-50 hover:bg-slate-100 text-slate-400 border-dashed border-slate-300";
                      if (isOccupied) {

                      if (occupancy.status === "normal") {
                    
                        cellBg =
                          "bg-blue-100 hover:bg-blue-200 text-blue-900 border-blue-200 font-medium";
                    
                      } else if (occupancy.status === "warning") {
                    
                        cellBg =
                          "bg-blue-600 hover:opacity-90 text-white border-blue-700 font-bold";
                    
                      } else if (occupancy.status === "over") {
                    
                        cellBg =
                          "bg-red-500 hover:bg-red-600 text-white border-red-700 font-bold";
                    
                      }
                    
                    }
                      if (isSelected) {
                        cellBg += " ring-4 ring-yellow-400 ring-offset-2 shadow-xl scale-[1.02] z-10 relative";
                      }

                      return (
                        <div
                          key={pos}
                          onClick={() => handleSelectSlot(s)}
                          className={`border rounded-lg p-3 h-24 text-center cursor-pointer transition flex flex-col justify-between ${cellBg}`}
                          title={`Módulo ${modStr} Posição ${pos} - ${s.referencia || "Vazio"}`}
                        >
                          <span className="text-[10px] opacity-75 font-mono uppercase block text-left">
                            Posição {pos}
                          </span>
                          <span className="text-lg font-black block tracking-tight my-1">
                            {s.referencia || "—"}
                          </span>
                          <span className="text-[10px] text-right block opacity-75">
                            {isOccupied ? `${s.saldo} pçs` : "Vazio"}
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>
               )}
              </div>
            </div>
          )}
        </div>

        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-500 flex items-center gap-2">
          <Info className="w-4 h-4 text-blue-600 shrink-0" />
          <span>
            <strong>Dica de Operação:</strong> Na estrutura de porta-paletes do 1º andar (A1/F1, etc) ou 2º andar (A2/F2, etc), as cores indicam o nível de ocupação da posição em relação à capacidade de armazenagem. Clique para inventariar de forma ágil ou conferir dados.
          </span>
        </div>

      </div>

      {/* INSPECTION DETAILED SIDE DRAWER */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs flex flex-col justify-between">
        
        <div>
          <h3 className="text-md font-bold text-slate-800 pb-3 border-b border-slate-100 flex items-center gap-2 mb-4">
            <Info className="w-4.5 h-4.5 text-slate-500" />
            Inspetor de Vaga
          </h3>

          {selectedSlot ? (
            <div className="space-y-5">
              
              {/* Core location summary */}
                <div className="bg-slate-50 border border-slate-100 rounded-lg p-3">
                
                  <span className="text-[10px] text-slate-400 font-bold uppercase block font-sans">
                    Localização
                  </span>
                
                  <span className="text-xs font-black text-blue-600 block">
                    Estoque {selectedSlot.estoque}
                  </span>
                
                  <span className="text-sm font-extrabold text-slate-800 block">
                    {selectedSlot.estoque === "1"
                      ? `Rua ${selectedSlot.modulo}`
                      : `Módulo ${selectedSlot.modulo} • Posição ${selectedSlot.posicao}`
                    }
                  </span>
                
                  {selectedSlot.estoque === "1" && (
                    <div className="mt-3 pt-3 border-t border-slate-200 space-y-1 text-xs">
                
                      <div className="flex justify-between">
                        <span className="text-slate-500">Capacidade:</span>
                        <span className="font-bold">
                          {capacidadeRuaSelecionada} paletes
                        </span>
                      </div>
                
                      <div className="flex justify-between">
                        <span className="text-slate-500">Ocupados:</span>
                        <span className="font-bold text-blue-700">
                          {paletesRua} paletes
                        </span>
                      </div>
                
                      <div className="flex justify-between">
                        <span className="text-slate-500">Livres:</span>
                        <span className="font-bold text-emerald-600">
                          {livresRua} paletes
                        </span>
                      </div>
                
                      <div className="flex justify-between">
                        <span className="text-slate-500">Taxa:</span>
                        <span className="font-bold">
                          {Math.round(
                            (paletesRua / capacidadeRuaSelecionada) * 100
                          ) || 0}%
                        </span>
                      </div>
                
                    </div>
                  )}
                
                </div>

              {editingSlotId === selectedSlot.id ? (
                /* QUICK MANUAL CORRECTION */
                <div className="space-y-4 bg-slate-50 p-4 rounded-lg border border-blue-200">
                  <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                    <Sliders className="w-3.5 h-3.5 text-blue-600" /> Correção Manual
                  </span>
                  
                  <div>
                    <label className="text-[10px] font-semibold text-slate-500 block mb-1">Referência SKU</label>
                    <input 
                      type="text" 
                      value={editRef} 
                      onChange={(e) => setEditRef(e.target.value)}
                      placeholder="Ex: 092"
                      className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-xs uppercase focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-semibold text-slate-500 block mb-1">Saldo Atual (peças)</label>
                    <input 
                      type="number" 
                      value={editQty} 
                      onChange={(e) => setEditQty(Math.max(0, Number(e.target.value)))}
                      className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-semibold text-slate-500 block mb-1">Identificação Chacote / Lote</label>
                    <input 
                      type="text" 
                      value={editChacote} 
                      onChange={(e) => setChacote(e.target.value)}
                      placeholder="Lote, data ou NT"
                      className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-semibold text-slate-500 block mb-1">Autorizado por</label>
                    <input 
                      type="text" 
                      value={editOperator} 
                      onChange={(e) => setEditOperator(e.target.value)}
                      className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>

                  <div className="flex gap-2 pt-2">
                    <button
                      onClick={() => !isReadOnly && saveQuickCorrection()}
                      disabled={isReadOnly}
                      className="flex-1 bg-blue-600 text-white rounded py-1.5 text-xs font-bold hover:bg-blue-700 flex items-center justify-center gap-1 shadow-sm cursor-pointer"
                    >
                      <Check className="w-3.5 h-3.5" /> Confirmar
                    </button>
                    <button
                      onClick={() => setEditingSlotId(null)}
                      className="flex-1 bg-slate-200 text-slate-700 rounded py-1.5 text-xs font-bold hover:bg-slate-300 cursor-pointer"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                /* EXPANSED SLOT VIEW */
                <div className="space-y-4">
                  {(
                    selectedEstoque === "1"
                      ? ruaSelecionada.length > 0
                      : selectedSlot.saldo > 0
                  ) ? (
                    <>
                      <div>

                        <span className="text-[10px] text-slate-400 font-bold uppercase block mb-2">
                          SKUs DA RUA
                        </span>
                      
                        <div className="space-y-2 max-h-80 overflow-y-auto">
                      
                          {ruaSelecionada.map((slot) => {
                      
                            const produto = productsList.find(
                              p => p.referencia === slot.referencia
                            );
                      
                            let paletes = 0;
                      
                            if (produto?.paletizacao) {
                      
                              const resultado =
                                slot.saldo / produto.paletizacao;
                      
                              if (resultado >= 0.5) {
                                paletes = Math.ceil(resultado);
                              }
                      
                            }
                      
                            return (
                      
                              <div
                                key={slot.id}
                                className="bg-slate-50 border border-slate-200 rounded-lg p-2"
                              >
                      
                                <div className="flex justify-between items-center">
                      
                                  <span className="font-mono text-xs font-bold text-blue-700">
                                    {slot.referencia}
                                  </span>
                      
                                  <span className="text-xs font-bold text-indigo-700">
                                    {paletes} paletes
                                  </span>
                      
                                </div>
                      
                                <div className="text-[11px] text-slate-600 mt-1">
                                  {slot.descricao}
                                </div>
                      
                                <div className="text-[10px] text-slate-500 mt-1">
                                  {slot.saldo.toLocaleString()} peças
                                </div>
                      
                              </div>
                            );
                
                          })}
                
                        </div>
                
                      </div>
                
                    </>
                  ) : (

                  <div className="bg-slate-50 text-slate-500 text-center py-10 rounded-lg text-xs space-y-2 border border-slate-100">
                    <Package className="w-8 h-8 mx-auto text-slate-300 stroke-1" />
                    <div className="font-bold">Sem produtos nesta rua</div>
                  </div>
                  
                  )}
                    
                  <button
                    disabled={isReadOnly}
                    onClick={() => !isReadOnly && startEditSlot(selectedSlot)}
                    className={`w-full bg-slate-100 text-slate-700 border border-slate-200 rounded-lg py-2 text-xs font-bold transition-colors flex items-center justify-center gap-1.5 shadow-2xs ${
                    isReadOnly
                      ? "opacity-50 cursor-not-allowed"
                      : "hover:bg-slate-200 cursor-pointer"
                  }`}
                  >
                    <Hammer className="w-3.5 h-3.5 text-slate-500" />
                    Corrigir / Inventariar Vaga
                  </button>
                </div>
              )}

            </div>
          ) : (
            <div className="text-center py-20 text-slate-400 space-y-3">
              <Package className="w-10 h-10 text-slate-300 mx-auto" />
              <div className="text-xs font-semibold">Inspecionar Vaga Física</div>
              <p className="text-[10px] text-slate-400 max-w-[200px] mx-auto leading-relaxed">
                Clique em qualquer rua ou módulo no mapa ao lado para consultar dados.
              </p>
            </div>
          )}

        </div>

        {/* Footer sizing details */}
        {selectedSlot && (
          <div className="pt-4 border-t border-slate-100 text-[10px] text-slate-400 font-sans">
            <span>Dimensões padrão: 120 x 80 x 140 cm</span>
            <span className="block mt-0.5">Capacidade de estocagem padrão: 5000 peças.</span>
          </div>
        )}

      </div>

    </div>
  );
};
