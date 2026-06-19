import React, { useState } from "react";
import { 
  Box, 
  Layers, 
  MapPin, 
  TrendingUp, 
  Package, 
  Database, 
  RefreshCw, 
  ArrowUpRight, 
  ArrowDownRight, 
  Clock, 
  User, 
  AlertTriangle, 
  CheckCircle, 
  Percent 
} from "lucide-react";
import { WarehouseSlot, HistoricoMov, Divergencia } from "../types";

interface DashboardCardsProps {
  slots: WarehouseSlot[];
  history: HistoricoMov[];
  divergencias: Divergencia[];
  productsList: any[];
  occupiedPalletsE1: number;
  appMode?: string;
}

export const DashboardCards: React.FC<DashboardCardsProps> = ({
  slots,
  history,
  divergencias,
  productsList,
  occupiedPalletsE1,
  appMode
}) => {

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerDays, setDrawerDays] = useState(7);
  
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedDays, setSelectedDays] = useState(7);
  
  // 1. Calculate slot statuses
  const totalSlots = 657 + 1373 + 1288;

const occupiedSlots =
  occupiedPalletsE1 +
  slots.filter(
    s => s.estoque === "2" && s.saldo > 0
  ).length +
  slots.filter(
    s => s.estoque === "3" && s.saldo > 0
  ).length;

const freeSlots = totalSlots - occupiedSlots;

const occupationRate =
  totalSlots > 0
    ? (occupiedSlots / totalSlots) * 100
    : 0;

  // 2. SKUs & Total Quantities
 const uniqueSKUs = new Set(
  slots
    .filter(
      s =>
        s.referencia &&
        s.referencia.trim() !== "" &&
        s.saldo > 0
    )
    .map(s => s.referencia.trim())
).size;
  const totalStoredQuantity = slots.reduce((acc, s) => acc + s.saldo, 0);

// Última sincronização
const lastSync = history.length > 0
  ? [...history].sort((a, b) =>
      `${b.data}T${b.hora}`.localeCompare(`${a.data}T${a.hora}`)
    )[0]
  : null;
  
// Movimentações da data da última sincronização
const dataUltimaSincronia = lastSync?.data || "";

const movementsToday = history.filter(
  h => h.data === dataUltimaSincronia
).length;

console.log("Data última sincronização:", dataUltimaSincronia);
console.log("Movimentações:", movementsToday);

// Operador mais ativo da última sincronização
const operatorCounter: Record<string, number> = {};

history
  .filter(h => h.data === lastSync?.data)
  .forEach(h => {
    const operador = h.responsavel?.trim() || "Sem Registro";

    operatorCounter[operador] =
      (operatorCounter[operador] || 0) + 1;
  });

const topOperator =
  Object.entries(operatorCounter)
    .sort((a, b) => b[1] - a[1])[0] || ["Sem Registro", 0];

console.log("Top Operator:", topOperator);

const hojeData = new Date();

const skusMov7Dias = new Set(
  history
    .filter(h => {
      const dataMov = new Date(h.data);
      const diffDias =
  (hojeData.getTime() - dataMov.getTime()) /
  (1000 * 60 * 60 * 24);

      return diffDias <= 7;
    })
    .map(h => h.referencia)
);

const skusMov30Dias = new Set(
  history
    .filter(h => {
      const dataMov = new Date(h.data);
      const diffDias =
  (hojeData.getTime() - dataMov.getTime()) /
  (1000 * 60 * 60 * 24);

      return diffDias <= 30;
    })
    .map(h => h.referencia)
);

const skusAtivos = new Set(
  slots
    .filter(
      s =>
        s.saldo > 0 &&
        s.referencia &&
        s.referencia.trim() !== ""
    )
    .map(s => s.referencia.trim())
);

const skusParados7Dias =
  [...skusAtivos].filter(
    sku => !skusMov7Dias.has(sku)
  ).length;

const skusParados30Dias =
  [...skusAtivos].filter(
    sku => !skusMov30Dias.has(sku)
  ).length;

    const skusParados7DiasLista = [...skusAtivos]
    .filter(sku => !skusMov7Dias.has(sku))
    .map(referencia => {
  
      const skuSlots = slots.filter(
        s =>
          s.referencia?.trim() === referencia &&
          s.saldo > 0
      );
  
      const saldoTotal = skuSlots.reduce(
        (acc, s) => acc + s.saldo,
        0
      );
  
      const produto = productsList.find(
        p => p.referencia?.trim() === referencia
      );
  
      const ultimaMovimentacao = history
        .filter(h => h.referencia === referencia)
        .sort((a, b) =>
          `${b.data} ${b.hora}`.localeCompare(
            `${a.data} ${a.hora}`
          )
        )[0];
  
      const custoUnitario =
      produto?.custoUnitario || 0;
    
      const valorTotal =
        saldoTotal * custoUnitario;

      const diasParado = ultimaMovimentacao
      ? Math.floor(
          (Date.now() -
            new Date(
              ultimaMovimentacao.data
            ).getTime()) /
          (1000 * 60 * 60 * 24)
        )
      : 999;
      
      return {
        referencia,
        descricao: produto?.descricao || "-",
        saldo: saldoTotal,
        custoUnitario,
        valorTotal,
        ultimaMovimentacao:
          ultimaMovimentacao?.data || "-",
        diasParado
      };
    });
  
  // 4. Divergencias
  const divAbertas = divergencias.filter(d => d.status === "Aberta").length;
  const divCorrigidas = divergencias.filter(d => d.status === "Corrigida").length;
  const totalDivs = divergencias.length;
  const correctionRate = totalDivs > 0 ? (divCorrigidas / totalDivs) * 100 : 100;
  
  const divergenciasCorrigidas = divergencias.filter(
  d =>
    d.status === "Corrigida" &&
    d.dataCorrecao &&
    d.dataDivergencia
);

const tempoMedio =
  divergenciasCorrigidas.length > 0
    ? (
        divergenciasCorrigidas.reduce((acc, d) => {
          const inicio = new Date(d.dataDivergencia || "").getTime();
          const fim = new Date(d.dataCorrecao || "").getTime();

          return acc + ((fim - inicio) / (1000 * 60 * 60 * 24));
        }, 0) / divergenciasCorrigidas.length
      ).toFixed(1)
    : "0.0";

    const filteredSkus = skusParados7DiasLista.filter((sku) => {

      const matchBusca =
        sku.referencia
          .toLowerCase()
          .includes(searchTerm.toLowerCase()) ||
    
        sku.descricao
          .toLowerCase()
          .includes(searchTerm.toLowerCase());
    
      const matchPeriodo =
        selectedDays === 60
          ? sku.diasParado >= 60
          : sku.diasParado >= selectedDays;
    
      return matchBusca && matchPeriodo;
    
    });

    const exportarCSV = () => {

      const cabecalho = [
        "Referencia",
        "Descricao",
        "Saldo",
        "Valor",
        "Ultima Movimentacao",
        "Dias Parado"
      ];
    
      const linhas = filteredSkus.map(sku => [
        sku.referencia,
        sku.descricao,
        sku.saldo,
        sku.valorTotal,
        sku.ultimaMovimentacao,
        sku.diasParado
      ]);
    
      const csvContent = [
        cabecalho,
        ...linhas
      ]
        .map(row =>
          row
            .map(col => `"${col}"`)
            .join(";")
        )
        .join("\n");
    
     const BOM = "\uFEFF";

      const blob = new Blob(
        [BOM + csvContent],
        {
          type: "text/csv;charset=utf-8;"
        }
      );
    
      const url =
        window.URL.createObjectURL(blob);
    
      const link =
        document.createElement("a");
    
      link.href = url;
    
      link.download =
      `SKUs_Parados_${selectedDays}Dias_${new Date()
        .toLocaleDateString("pt-BR")
        .replaceAll("/", "-")}.csv`;
    
      document.body.appendChild(link);
    
      link.click();
    
      document.body.removeChild(link);
    
      window.URL.revokeObjectURL(url);
    };

    const limparFiltros = () => {
    setSearchTerm("");
    setSelectedDays(7);
  };
  
  return (
    <div className="space-y-5" id="dashboard-container">
      {/* SECTION 1: ENDEREÇAMENTO */}
      <div>
        <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
          <Layers className="w-3.5 h-3.5 text-slate-400" />
          Endereçamento Físico
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          
          <div className="bg-white border border-slate-200 border-t-2 border-t-blue-500 rounded p-3 shadow-2xs hover:border-slate-300 transition-colors">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-bold text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded flex items-center gap-1 uppercase">
                <MapPin className="w-3 h-3 text-blue-500" /> Ocupados
              </span>
            </div>
            <div className="text-2xl font-black font-sans text-slate-805 tracking-tight">
              {occupiedSlots}
            </div>
            <div className="text-[9px] text-slate-400 mt-0.5">De {totalSlots} posições no total</div>
          </div>

          <div className="bg-white border border-slate-200 border-t-2 border-t-emerald-500 rounded p-3 shadow-2xs hover:border-slate-300 transition-colors">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-bold text-emerald-850 bg-emerald-50 px-1.5 py-0.5 rounded flex items-center gap-1 uppercase">
                <Layers className="w-3 h-3 text-emerald-500" /> Livres
              </span>
            </div>
            <div className="text-2xl font-black font-sans text-slate-800 tracking-tight">
              {freeSlots}
            </div>
            <div className="text-[9px] text-slate-400 mt-0.5">Prontas para armazenar</div>
          </div>

          <div className="bg-white border border-slate-200 border-t-2 border-t-amber-500 rounded p-3 shadow-2xs hover:border-slate-300 transition-colors">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-bold text-amber-800 bg-amber-50 px-1.5 py-0.5 rounded flex items-center gap-1 uppercase">
                <TrendingUp className="w-3 h-3 text-amber-500" /> Ocupação %
              </span>
            </div>
            <div className="text-2xl font-black font-sans text-slate-800 tracking-tight">
              {occupationRate.toFixed(1)}%
            </div>
            <div className="text-[9px] text-slate-400 mt-0.5">Otimização de espaço físico</div>
          </div>

          <div className="bg-white border border-slate-200 border-t-2 border-t-teal-500 rounded p-3 shadow-2xs hover:border-slate-350 transition-colors">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-bold text-teal-850 bg-teal-50 px-1.5 py-0.5 rounded flex items-center gap-1 uppercase">
                <Package className="w-3 h-3 text-teal-500" /> Itens SKUs
              </span>
            </div>
            <div className="text-2xl font-black font-sans text-slate-800 tracking-tight">
              {uniqueSKUs}
            </div>
            <div className="text-[9px] text-slate-400 mt-0.5"> SKUs com saldo físico armazenado</div>
          </div>

          <div className="bg-white border border-slate-200 border-t-2 border-t-blue-650 rounded p-3 shadow-2xs hover:border-slate-350 transition-colors">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-bold text-blue-800 bg-blue-50 px-1.5 py-0.5 rounded flex items-center gap-1 uppercase">
                <Database className="w-3 h-3 text-blue-500" /> Saldo Total
              </span>
            </div>
            <div className="text-2xl font-black font-sans text-slate-850 tracking-tight">
              {totalStoredQuantity.toLocaleString()}
            </div>
            <div className="text-[9px] text-slate-400 mt-0.5">Peças físicas alocadas</div>
          </div>

        </div>
      </div>

      {/* SECTION 2: HISTÓRICO */}
      <div>
        <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
          <RefreshCw className="w-3.5 h-3.5 text-slate-400" />
          Log de Movimentações Recentes
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">

          <div
            onClick={() => {
              setDrawerDays(7);
              setSelectedDays(7);
              setDrawerOpen(true);
            }}
            className="
              bg-white
              border
              border-slate-200
              border-t-2
              border-t-slate-500
              rounded
              p-3
              shadow-2xs
              hover:border-slate-300
              hover:shadow-md
              transition-all
              cursor-pointer
            ">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-bold text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded flex items-center gap-1 uppercase">
                <RefreshCw className="w-3 h-3 text-blue-500" /> SKUs PARADOS 7 DIAS
              </span>
            </div>
            <div className="text-2xl font-black font-sans text-slate-800 tracking-tight">
              {skusParados7Dias}
            </div>
            <div className="text-[9px] text-slate-400 mt-0.5">SKUs sem movimentos nos ultimos 7 dias</div>
          </div>

          <div
            onClick={() => {
              setDrawerDays(30);
              setSelectedDays(30);
              setDrawerOpen(true);
            }}
            className="
              bg-white
              border
              border-slate-200
              border-t-2
              border-t-emerald-400
              rounded
              p-3
              shadow-2xs
              hover:border-slate-300
              hover:shadow-md
              transition-all
              cursor-pointer
            "
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-bold text-emerald-805 bg-emerald-50 px-1.5 py-0.5 rounded flex items-center gap-1 uppercase">
                <ArrowUpRight className="w-3 h-3 text-emerald-555" /> SKUs PARADOS 30 DIAS
              </span>
            </div>
            <div className="text-2xl font-black font-sans text-emerald-600 tracking-tight">
              {skusParados30Dias}
            </div>
            <div className="text-[9px] text-slate-400 mt-0.5">SKUs sem movimentos nos ultimos 30 dias</div>
          </div>

          <div className="bg-white border border-slate-200 border-t-2 border-t-red-400 rounded p-3 shadow-2xs hover:border-slate-350 transition-colors">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-bold text-red-800 bg-red-50 px-1.5 py-0.5 rounded flex items-center gap-1 uppercase">
                <ArrowDownRight className="w-3 h-3 text-red-500" /> MOVIMENTAÇÕES HOJE
              </span>
            </div>
            <div className="text-2xl font-black font-sans text-red-650 tracking-tight">
              {movementsToday}
            </div>
            <div className="text-[9px] text-slate-400 mt-0.5">Lançamentos realizados hoje</div>
          </div>

          <div className="bg-white border border-slate-200 border-t-2 border-t-slate-400 rounded p-3 shadow-2xs hover:border-slate-350 transition-colors">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-bold text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded flex items-center gap-1 uppercase">
                <Clock className="w-3 h-3 text-blue-500" /> ÚLTIMA SINCRONIA
              </span>
            </div>
            <div className="text-sm font-black font-mono text-slate-800 tracking-tight pt-1 leading-none">
              {lastSync ? `${lastSync.data} ${lastSync.hora}` : "--"}
            </div>
            <div className="text-[9px] text-slate-400 mt-1">Última atualização registrada</div>
          </div>

          <div className="bg-white border border-slate-200 border-t-2 border-t-slate-450 rounded p-3 shadow-2xs hover:border-slate-350 transition-colors">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-bold text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded flex items-center gap-1 uppercase font-semibold">
                <User className="w-3 h-3 text-blue-500" /> OPERADOR MAIS ATIVO
              </span>
            </div>
            <div className="text-xs font-black text-slate-800 tracking-tight pt-1 leading-none truncate font-sans">
              {topOperator[0]}
            </div>
            <div className="text-[9px] text-slate-400 mt-1">
              {topOperator[1]} movimentações hoje
            </div>
          </div>

        </div>
      </div>

      {/* SECTION 3: DIVERGÊNCIAS */}
      <div>
        <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 text-slate-400" />
          Gestão de Divergências
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">

          <div className="bg-white border border-slate-200 border-t-2 border-t-red-500 rounded p-3 shadow-2xs hover:border-red-200 transition-colors">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-bold text-red-700 bg-red-50 px-1.5 py-0.5 rounded flex items-center gap-1 uppercase">
                <AlertTriangle className="w-3 h-3 text-red-500" /> Pendentes
              </span>
            </div>
            <div className="text-2xl font-black font-sans text-red-650 tracking-tight">
              {divAbertas}
            </div>
            <div className="text-[9px] text-slate-400 mt-0.5">Erros de saldo ou conflito de vaga</div>
          </div>

          <div className="bg-white border border-slate-200 border-t-2 border-t-emerald-500 rounded p-3 shadow-2xs hover:border-slate-300 transition-colors">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-bold text-emerald-800 bg-emerald-50 px-1.5 py-0.5 rounded flex items-center gap-1 uppercase">
                <CheckCircle className="w-3 h-3 text-emerald-600" /> Reconciliadas
              </span>
            </div>
            <div className="text-2xl font-black font-sans text-slate-800 tracking-tight">
              {divCorrigidas}
            </div>
            <div className="text-[9px] text-slate-400 mt-0.5">Ajustado por correção manual</div>
          </div>

          <div className="bg-white border border-slate-200 border-t-2 border-t-blue-500 rounded p-3 shadow-2xs hover:border-slate-300 transition-colors">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-bold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded flex items-center gap-1 uppercase">
                <Percent className="w-3 h-3 text-blue-500" /> Tempo Médio
              </span>
            </div>
            <div className="text-2xl font-black font-sans text-blue-600 tracking-tight">
               {tempoMedio} dias
            </div>
            <div className="text-[9px] text-slate-400 mt-0.5">Resolução de divergências</div>
          </div>

        </div>
      </div>

      {true && (
        <div>
          <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5 pt-2">
            <Layers className="w-3.5 h-3.5 text-indigo-500" />
            Indicadores Estoque 1  (Em baixo Transporte)
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div className="bg-white border border-slate-200 border-t-2 border-t-indigo-500 rounded p-3 shadow-2xs hover:border-indigo-300 transition-colors">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-bold text-indigo-850 bg-indigo-50 px-1.5 py-0.5 rounded flex items-center gap-1 uppercase">
                  Paletes Ocupados E1 (Em baixo Transporte)
                </span>
              </div>
              <div className="text-2xl font-black font-sans text-slate-800 tracking-tight">
                {occupiedPalletsE1}
              </div>
              <div className="text-[9px] text-slate-400 mt-0.5">Posições do Estoque 1 com saldo</div>
            </div>

            <div className="bg-white border border-slate-200 border-t-2 border-t-blue-500 rounded p-3 shadow-2xs hover:border-blue-300 transition-colors">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-bold text-blue-800 bg-blue-50 px-1.5 py-0.5 rounded flex items-center gap-1 uppercase font-semibold">
                  Saldo Total E1 (Em baixo Transporte)
                </span>
              </div>
              <div className="text-2xl font-black font-sans text-slate-800 tracking-tight font-mono">
                {slots.filter(s => s.estoque === "1").reduce((acc, s) => acc + s.saldo, 0).toLocaleString()} <span className="text-xs text-slate-400">pçs</span>
              </div>
              <div className="text-[9px] text-slate-400 mt-0.5">Total de peças armazenadas no Estoque 1</div>
            </div>

            <div className="bg-white border border-slate-200 border-t-2 border-t-violet-500 rounded p-3 shadow-2xs hover:border-violet-300 transition-colors">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-bold text-violet-850 bg-violet-50 px-1.5 py-0.5 rounded flex items-center gap-1 uppercase">
                  SKUs E1 (Em baixo Transporte)
                </span>
              </div>
              <div className="text-2xl font-black font-sans text-slate-800 tracking-tight">
                {new Set(slots.filter(s => s.estoque === "1" && s.saldo > 0).map(s => s.referencia)).size}
              </div>
              <div className="text-[9px] text-slate-400 mt-0.5 font-medium">Referências armazenadas no Estoque 1</div>
            </div>

            <div className="bg-white border border-slate-200 border-t-2 border-t-pink-500 rounded p-3 shadow-2xs hover:border-pink-300 transition-colors">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-bold text-pink-850 bg-pink-50 px-1.5 py-0.5 rounded flex items-center gap-1 uppercase">
                  Representatividade E1 (Em baixo Transporte)
                </span>
              </div>
              <div className="text-2xl font-black font-sans text-slate-800 tracking-tight">
                {totalStoredQuantity > 0 
                  ? ((slots.filter(s => s.estoque === "1").reduce((acc, s) => acc + s.saldo, 0) / totalStoredQuantity) * 100).toFixed(1)
                  : "0.0"
                }%
              </div>
              <div className="text-[9px] text-slate-400 mt-0.5">Do saldo total estocado no galpão</div>
            </div>
          </div>
        </div>
      )}

              {drawerOpen && (
          <>
            {/* Overlay */}
            <div
              className="fixed inset-0 bg-black/40 z-40"
              onClick={() => setDrawerOpen(false)}
            />
        
            {/* Drawer */}
            <div className="
              fixed
              top-0
              right-0
              h-full
              w-[900px]
              bg-white
              shadow-2xl
              z-50
              flex
              flex-col
              overflow-hidden
            ">
        
              <div className="px-6 py-4 border-b flex items-center justify-between bg-white">
        
                <div>
                  <h2 className="text-2xl font-bold text-slate-800">
                    SKUs Sem Movimentação
                  </h2>
                  
                  <p className="text-sm text-slate-500">
                    Monitoramento de estoque sem giro
                  </p>
                </div>
        
                <button
                  onClick={() => setDrawerOpen(false)}
                  className="px-3 py-1 rounded border"
                >
                  Fechar
                </button>
        
              </div>
        
              <div className="p-4 space-y-4">

                {/* Cards Resumo */}
                <div className="grid grid-cols-4 gap-3">
              
                  <div className="bg-slate-50 border rounded-lg p-3">
                    <div className="text-2xl font-black text-slate-800">
                      {filteredSkus.length}
                    </div>
                    <div className="text-xs text-slate-500 uppercase">
                      SKUs Parados
                    </div>
                  </div>
              
                  <div className="bg-slate-50 border rounded-lg p-3">
                    <div className="text-2xl font-black text-slate-800">
                      {
                        filteredSkus
                          .reduce((acc, sku) => acc + sku.saldo, 0)
                          .toLocaleString()
                      }
                    </div>
                    <div className="text-xs text-slate-500 uppercase">
                      Peças Paradas
                    </div>
                  </div>
              
                  <div className="bg-slate-50 border rounded-lg p-3">
                    <div className="text-2xl font-black text-emerald-600">
                      R$ {
                        filteredSkus
                          .reduce(
                            (acc, sku) =>
                              acc + sku.valorTotal,
                            0
                          )
                          .toLocaleString("pt-BR", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2
                          })
                      }
                    </div>
                    <div className="text-xs text-slate-500 uppercase">
                      Valor Parado
                    </div>
                  </div>
              
                  <div className="bg-slate-50 border rounded-lg p-3">
                    <div className="text-2xl font-black text-blue-600">
                      {uniqueSKUs > 0
                        ? (
                            (filteredSkus.length / uniqueSKUs) *
                            100
                          ).toFixed(1)
                        : "0"}
                      %
                    </div>
                    <div className="text-xs text-slate-500 uppercase">
                      Representatividade
                    </div>
                  </div>
              
                </div>
              
              </div>

              {/* Filtros */}
              <div className="flex items-center justify-between gap-4 flex-wrap">
              
                <div className="flex items-center gap-2">
              
                  <span className="text-sm text-slate-600 font-medium">
                    Período:
                  </span>
              
                  <button
                    onClick={() => setSelectedDays(7)}
                    className={`px-3 py-1 text-sm rounded ${
                      selectedDays === 7
                        ? "bg-blue-600 text-white"
                        : "border hover:bg-slate-50"
                    }`}
                  >
                    7 dias
                  </button>
              
                  <button
                  onClick={() => setSelectedDays(15)}
                  className={`px-3 py-1 text-sm rounded ${
                    selectedDays === 15
                      ? "bg-blue-600 text-white"
                      : "border hover:bg-slate-50"
                  }`}
                >
                  15 dias
                </button>
              
                  <button
                    onClick={() => setSelectedDays(30)}
                    className={`px-3 py-1 text-sm rounded ${
                      selectedDays === 30
                        ? "bg-blue-600 text-white"
                        : "border hover:bg-slate-50"
                    }`}
                  >
                    30 dias
                  </button>
              
                  <button
                    onClick={() => setSelectedDays(60)}
                    className={`px-3 py-1 text-sm rounded ${
                      selectedDays === 60
                        ? "bg-blue-600 text-white"
                        : "border hover:bg-slate-50"
                    }`}
                  >
                    60+
                  </button>
              
                </div>
              
                <div className="flex items-center gap-2">
              
                  <button
                    onClick={exportarCSV}
                    className="
                      px-3
                      py-2
                      text-sm
                      rounded
                      border
                      bg-emerald-50
                      text-emerald-700
                      hover:bg-emerald-100
                    "
                  >
                    Exportar CSV
                  </button>
              
                </div>

                  {(searchTerm || selectedDays !== 7) && (
                  <button
                    onClick={limparFiltros}
                    className="
                      px-3
                      py-2
                      text-sm
                      rounded
                      border
                      bg-slate-50
                      text-slate-700
                      hover:bg-slate-100
                    "
                  >
                    Limpar
                  </button>
                )}
                
              </div>

            <div className="relative">

              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar SKU ou descrição..."
                className="
                  w-full
                  border
                  rounded-lg
                  px-4
                  py-2
                  text-sm
                  focus:outline-none
                  focus:ring-2
                  focus:ring-blue-500
                "
              />  
          </div>
              
            <div className="border rounded-lg overflow-hidden">

            <div
              className="
                bg-slate-100
                px-4
                py-2
                grid
                grid-cols-[120px_1fr_120px_140px_120px_80px]
                text-xs
                font-bold
                text-slate-600
                uppercase
              "
            >
            
              <div>Referência</div>
              <div>Descrição</div>
              <div>Saldo</div>
              <div>Valor</div>
              <div>Últ. Mov.</div>
              <div>Dias</div>
            
            </div>
          
            <div className="max-h-[500px] overflow-auto">
          
              {filteredSkus
                .sort((a, b) => b.diasParado - a.diasParado)
                .slice(0, 50)
                .map((sku) => (
          
                <div
                  key={sku.referencia}
                  className="
                    px-4
                    py-3
                    grid
                    grid-cols-[120px_1fr_120px_140px_120px_80px]
                    border-t
                    hover:bg-slate-50
                    text-sm
                  "
                >
          
                  <div className="font-semibold">
                    {sku.referencia}
                  </div>
          
                  <div className="truncate">
                    {sku.descricao}
                  </div>
          
                  <div>
                    {sku.saldo.toLocaleString()}
                  </div>

                  <div className="font-medium text-emerald-700">
                   {sku.valorTotal > 0
                    ? sku.valorTotal.toLocaleString(
                        "pt-BR",
                        {
                          style: "currency",
                          currency: "BRL"
                        }
                      )
                    : "-"}
                  </div>

                    <div>
                      {sku.ultimaMovimentacao !== "-"
                        ? new Date(
                            `${sku.ultimaMovimentacao}T00:00:00`
                          ).toLocaleDateString("pt-BR")
                        : "-"}
                    </div>
                      
                      <div>
                        <span
                          className={`
                            px-2
                            py-1
                            rounded
                            text-xs
                            font-semibold
                      
                            ${
                              sku.diasParado >= 60
                                ? "bg-red-100 text-red-700"
                                : sku.diasParado >= 30
                                ? "bg-orange-100 text-orange-700"
                                : sku.diasParado >= 15
                                ? "bg-yellow-100 text-yellow-700"
                                : "bg-blue-100 text-blue-700"
                            }
                          `}
                        >
                          {sku.diasParado}
                        </span>
                      </div>
          
                </div>
          
              ))}
          
            </div>
          
          </div>         
              
            </div>
          </>
        )}
      
    </div>
  );
};
