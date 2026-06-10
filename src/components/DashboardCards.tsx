import React from "react";
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
  appMode?: string;
}

export const DashboardCards: React.FC<DashboardCardsProps> = ({ slots, history, divergencias, appMode }) => {
  // 1. Calculate slot statuses
  const totalSlots = slots.length;
  const occupiedSlots = slots.filter(s => s.saldo > 0).length;
  const freeSlots = totalSlots - occupiedSlots;
  const occupationRate = totalSlots > 0 ? (occupiedSlots / totalSlots) * 100 : 0;

  // 2. SKUs & Total Quantities
  const uniqueSKUs = new Set(slots.filter(s => s.saldo > 0).map(s => s.referencia)).size;
  const totalStoredQuantity = slots.reduce((acc, s) => acc + s.saldo, 0);

  // 3. Movement logs
  const totalMovements = history.length;
  const totalEntradas = history.filter(h => h.tipo === "Entrada").reduce((acc, h) => acc + h.quantidade, 0);
  const totalSaidas = history.filter(h => h.tipo === "Saída").reduce((acc, h) => acc + h.quantidade, 0);

  const lastMovementDate = history.length > 0 
    ? [...history].sort((a, b) => `${b.data}T${b.hora}`.localeCompare(`${a.data}T${a.hora}`))[0].data 
    : "00/01/1900";

  const lastUser = history.length > 0 
    ? [...history].sort((a, b) => `${b.data}T${b.hora}`.localeCompare(`${a.data}T${a.hora}`))[0].responsavel 
    : "Sem Registro";

  // 4. Divergencias
  const divAbertas = divergencias.filter(d => d.status === "Aberta").length;
  const divCorrigidas = divergencias.filter(d => d.status === "Corrigida").length;
  const totalDivs = divergencias.length;
  const correctionRate = totalDivs > 0 ? (divCorrigidas / totalDivs) * 100 : 100;

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
            <div className="text-[9px] text-slate-400 mt-0.5">Referências cadastradas</div>
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

          <div className="bg-white border border-slate-200 border-t-2 border-t-slate-500 rounded p-3 shadow-2xs hover:border-slate-300 transition-colors">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-bold text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded flex items-center gap-1 uppercase">
                <RefreshCw className="w-3 h-3 text-blue-500" /> Movimentações
              </span>
            </div>
            <div className="text-2xl font-black font-sans text-slate-800 tracking-tight">
              {totalMovements}
            </div>
            <div className="text-[9px] text-slate-400 mt-0.5">Registros processados local</div>
          </div>

          <div className="bg-white border border-slate-200 border-t-2 border-t-emerald-400 rounded p-3 shadow-2xs hover:border-slate-350 transition-colors">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-bold text-emerald-805 bg-emerald-50 px-1.5 py-0.5 rounded flex items-center gap-1 uppercase">
                <ArrowUpRight className="w-3 h-3 text-emerald-555" /> Entradas
              </span>
            </div>
            <div className="text-2xl font-black font-sans text-emerald-600 tracking-tight">
              +{totalEntradas.toLocaleString()}
            </div>
            <div className="text-[9px] text-slate-400 mt-0.5">Silos abastecidos</div>
          </div>

          <div className="bg-white border border-slate-200 border-t-2 border-t-red-400 rounded p-3 shadow-2xs hover:border-slate-350 transition-colors">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-bold text-red-800 bg-red-50 px-1.5 py-0.5 rounded flex items-center gap-1 uppercase">
                <ArrowDownRight className="w-3 h-3 text-red-500" /> Saídas
              </span>
            </div>
            <div className="text-2xl font-black font-sans text-red-650 tracking-tight">
              -{totalSaidas.toLocaleString()}
            </div>
            <div className="text-[9px] text-slate-400 mt-0.5">Consumo ou quebras</div>
          </div>

          <div className="bg-white border border-slate-200 border-t-2 border-t-slate-400 rounded p-3 shadow-2xs hover:border-slate-350 transition-colors">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-bold text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded flex items-center gap-1 uppercase">
                <Clock className="w-3 h-3 text-blue-500" /> Sincronia
              </span>
            </div>
            <div className="text-sm font-black font-mono text-slate-800 tracking-tight pt-1 leading-none">
              {lastMovementDate}
            </div>
            <div className="text-[9px] text-slate-400 mt-1">Data da transmissão</div>
          </div>

          <div className="bg-white border border-slate-200 border-t-2 border-t-slate-450 rounded p-3 shadow-2xs hover:border-slate-350 transition-colors">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-bold text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded flex items-center gap-1 uppercase font-semibold">
                <User className="w-3 h-3 text-blue-500" /> Operador
              </span>
            </div>
            <div className="text-xs font-black text-slate-800 tracking-tight pt-1 leading-none truncate font-sans">
              {lastUser}
            </div>
            <div className="text-[9px] text-slate-400 mt-1">Responsável pela ação</div>
          </div>

        </div>
      </div>

      {/* SECTION 3: DIVERGÊNCIAS */}
      <div>
        <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 text-slate-400" />
          Acurácia & Divergências de Estoque
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
                <Percent className="w-3 h-3 text-blue-500" /> Acurácia Física
              </span>
            </div>
            <div className="text-2xl font-black font-sans text-blue-600 tracking-tight">
              {correctionRate.toFixed(1)}%
            </div>
            <div className="text-[9px] text-slate-400 mt-0.5">Conformidade do estoque físico</div>
          </div>

        </div>
      </div>

      {appMode === "avancado" && (
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
                {
                  slots
                    .filter(
                      s =>
                        s.estoque === 1 &&
                        s.saldo > 0
                    )
                    .length
                }
              </div>
              <div className="text-[9px] text-slate-400 mt-0.5">Corredores ativos com saldo de paletes</div>
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
              <div className="text-[9px] text-slate-400 mt-0.5">Total de peças estocadas no chão</div>
            </div>

            <div className="bg-white border border-slate-200 border-t-2 border-t-violet-500 rounded p-3 shadow-2xs hover:border-violet-300 transition-colors">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-bold text-violet-850 bg-violet-50 px-1.5 py-0.5 rounded flex items-center gap-1 uppercase">
                  SKUs E1 (Em baixo Transporte)
                </span>
              </div>
              <div className="text-2xl font-black font-sans text-slate-800 tracking-tight">
                {new Set(slots.filter(s => s.estoque === 1 && s.saldo > 0).map(s => s.referencia)).size}
              </div>
              <div className="text-[9px] text-slate-400 mt-0.5 font-medium">Tipos de SKU diferentes em vão livre</div>
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
    </div>
  );
};
