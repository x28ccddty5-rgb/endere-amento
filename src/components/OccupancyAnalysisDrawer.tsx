import { X, Package, Layers, PieChart, AlertTriangle } from "lucide-react";

interface OccupancyAnalysisDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  occupiedPositions: number;
  totalPositions: number;
  history: any[];
}

export function OccupancyAnalysisDrawer({
  isOpen,
  onClose,
  occupiedPositions,
  totalPositions,
  history,
}: OccupancyAnalysisDrawerProps) {
  if (!isOpen) return null;

  const freePositions = totalPositions - occupiedPositions;
  const occupancyPercent =
    totalPositions > 0
      ? (occupiedPositions / totalPositions) * 100
      : 0;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40">
      <div className="w-full max-w-5xl bg-white h-full overflow-y-auto shadow-2xl">
        
        {/* Header */}
        <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between z-10">
          <div>
            <h2 className="text-2xl font-bold">
              Análise de Eficiência de Ocupação
            </h2>
            <p className="text-sm text-gray-500">
              Visão geral da capacidade física do estoque
            </p>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100"
          >
            <X size={22} />
          </button>
        </div>

        <div className="p-6 space-y-6">
          
          {/* RESUMO EXECUTIVO */}
          <section className="bg-white border rounded-xl p-5">
            <h3 className="text-lg font-bold mb-4">
              1. Resumo Executivo
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">

              <div className="border rounded-xl p-4">
                <Package className="mb-2 text-blue-600" />
                <p className="text-xs uppercase text-gray-500">
                  Posições Ocupadas
                </p>
                <p className="text-4xl font-bold">
                  {occupiedPositions}
                </p>
              </div>

              <div className="border rounded-xl p-4">
                <Layers className="mb-2 text-gray-600" />
                <p className="text-xs uppercase text-gray-500">
                  Capacidade Física
                </p>
                <p className="text-4xl font-bold">
                  {totalPositions}
                </p>
              </div>

              <div className="border rounded-xl p-4">
                <PieChart className="mb-2 text-green-600" />
                <p className="text-xs uppercase text-gray-500">
                  Utilização
                </p>
                <p className="text-4xl font-bold">
                  {occupancyPercent.toFixed(1)}%
                </p>
              </div>

              <div className="border rounded-xl p-4">
                <AlertTriangle className="mb-2 text-orange-500" />
                <p className="text-xs uppercase text-gray-500">
                  Livres
                </p>
                <p className="text-4xl font-bold">
                  {freePositions}
                </p>
              </div>

            </div>
          </section>

          {/* STATUS GERAL */}
          <section className="bg-white border rounded-xl p-5">
            <h3 className="text-lg font-bold mb-4">
              2. Status Geral
            </h3>

            <div className="space-y-4">

  {/* Status Atual */}
  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

    <div className="border rounded-xl p-4 bg-red-50 border-red-200">
      <div className="text-sm font-bold text-red-600 uppercase">
        Status Atual
      </div>

      <div className="text-3xl font-black text-red-700 mt-2">
        {occupancyPercent >= 95
          ? "CRÍTICO"
          : occupancyPercent >= 85
          ? "ATENÇÃO"
          : "SAUDÁVEL"}
      </div>

      <div className="text-sm text-slate-600 mt-3">
        {occupancyPercent.toFixed(1)}% da capacidade utilizada
      </div>

      <div className="text-sm text-slate-600">
        {occupiedPositions.toLocaleString()} de{" "}
        {totalPositions.toLocaleString()} posições ocupadas
      </div>

      <div className="text-sm font-semibold text-red-700 mt-2">
        Restam apenas {freePositions.toLocaleString()} posições livres
      </div>
    </div>

    {/* Barra */}
    <div className="lg:col-span-2 border rounded-xl p-4">

      <div className="text-sm font-bold text-slate-700 mb-3">
        Nível de Utilização
      </div>

      <div className="w-full h-4 bg-slate-200 rounded-full overflow-hidden">
        <div
          className={`h-full ${
            occupancyPercent >= 95
              ? "bg-red-500"
              : occupancyPercent >= 85
              ? "bg-amber-500"
              : "bg-emerald-500"
          }`}
          style={{
            width: `${Math.min(occupancyPercent, 100)}%`,
          }}
        />
      </div>

      <div className="grid grid-cols-3 gap-3 mt-4 text-center">

        <div>
          <div className="font-bold text-emerald-600">
            🟢 Até 85%
          </div>

          <div className="text-xs text-slate-500">
            Até {Math.floor(totalPositions * 0.85).toLocaleString()} posições
          </div>
        </div>

        <div>
          <div className="font-bold text-amber-600">
            🟡 85% a 95%
          </div>

          <div className="text-xs text-slate-500">
            {Math.floor(totalPositions * 0.85).toLocaleString()}
            {" - "}
            {Math.floor(totalPositions * 0.95).toLocaleString()}
          </div>
        </div>

        <div>
          <div className="font-bold text-red-600">
            🔴 Acima de 95%
          </div>

          <div className="text-xs text-slate-500">
            Acima de {Math.floor(totalPositions * 0.95).toLocaleString()}
          </div>
        </div>

      </div>

    </div>

  </div>

      {/* Insight */}
      <div className="border rounded-xl p-4 bg-slate-50">
        <p className="text-sm text-slate-700 leading-relaxed">
          O estoque opera com{" "}
          <strong>{occupancyPercent.toFixed(1)}%</strong> da capacidade física.
          Restam apenas <strong>{freePositions}</strong> posições disponíveis.
          {occupancyPercent >= 95
            ? " A operação encontra-se em nível crítico de ocupação, reduzindo a flexibilidade para recebimentos e absorção de aumentos de produção."
            : occupancyPercent >= 85
            ? " A ocupação exige monitoramento constante para evitar restrições operacionais."
            : " A capacidade disponível ainda permite absorver crescimento com segurança."}
        </p>
      </div>
    
    </div>
          </section>

          {/* PROJEÇÃO */}
          <section className="bg-white border rounded-xl p-5">
          
            <h3 className="text-lg font-bold mb-4">
              3. Projeção de Capacidade
            </h3>
          
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
          
              <div className="flex items-center gap-3 mb-3">
                <AlertTriangle className="w-5 h-5 text-amber-600" />
          
                <div className="font-bold text-amber-800">
                  Em aprendizado
                </div>
              </div>
          
              <p className="text-sm text-slate-700 leading-relaxed">
                Os dados de ocupação estão sendo consolidados para gerar projeções
                confiáveis de capacidade.
              </p>
          
              <p className="text-sm text-slate-700 leading-relaxed mt-2">
                A estimativa de saturação será liberada automaticamente após a
                consolidação da base histórica de ocupação.
              </p>
          
              <div className="mt-4 grid grid-cols-3 gap-3">
          
                <div className="bg-white border rounded-lg p-3">
                  <div className="text-xs text-slate-500 uppercase">
                    Base Histórica
                  </div>
          
                  <div className="text-2xl font-black text-slate-700">
                    Em coleta
                  </div>
                </div>
          
                <div className="bg-white border rounded-lg p-3">
                  <div className="text-xs text-slate-500 uppercase">
                    Tendência
                  </div>
          
                  <div className="text-2xl font-black text-slate-700">
                    —
                  </div>
                </div>
          
                <div className="bg-white border rounded-lg p-3">
                  <div className="text-xs text-slate-500 uppercase">
                    Saturação
                  </div>
          
                  <div className="text-2xl font-black text-slate-700">
                    —
                  </div>
                </div>
          
              </div>
          
            </div>
          
          </section>

          {/* PRESSÃO */}
          <section className="bg-white border rounded-xl p-5">
            <h3 className="text-lg font-bold mb-4">
              4. Principais Pressões do Estoque
            </h3>

            <div>
              EM CONSTRUÇÃO
            </div>
          </section>

        </div>
      </div>
    </div>
  );
}
