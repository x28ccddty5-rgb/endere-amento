import { X, Package, Layers, PieChart, AlertTriangle } from "lucide-react";

interface OccupancyAnalysisDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  occupiedPositions: number;
  totalPositions: number;
}

export function OccupancyAnalysisDrawer({
  isOpen,
  onClose,
  occupiedPositions,
  totalPositions,
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

            <div>
              EM CONSTRUÇÃO
            </div>
          </section>

          {/* PROJEÇÃO */}
          <section className="bg-white border rounded-xl p-5">
            <h3 className="text-lg font-bold mb-4">
              3. Projeção de Capacidade
            </h3>

            <div>
              EM CONSTRUÇÃO
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
