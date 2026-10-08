import { X, Package, Layers, PieChart, AlertTriangle } from "lucide-react";

interface OccupancyAnalysisDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  occupiedPositions: number;
  totalPositions: number;
  occupiedSlotsE1: number;
  occupiedSlotsE2: number;
  occupiedSlotsE3: number;
  occupancyHistory: Array<{
    snapshot_date: string;
    occupied_positions: number;
    free_positions: number;
    total_positions: number;
    occupancy_percent: number;
    total_pieces: number;
  }>;
}

export function OccupancyAnalysisDrawer({
  isOpen,
  onClose,
  occupiedPositions,
  totalPositions,
  occupiedSlotsE1,
  occupiedSlotsE2,
  occupiedSlotsE3,
  occupancyHistory,
}: OccupancyAnalysisDrawerProps) {
  if (!isOpen) return null;

  const freePositions = totalPositions - occupiedPositions;
  const occupancyPercent =
    totalPositions > 0
      ? (occupiedPositions / totalPositions) * 100
      : 0;

    const occupancyDistribution = [
  {
    nome: "Estoque 1",
    valor: occupiedSlotsE1,
    percentual:
      occupiedPositions > 0
        ? (occupiedSlotsE1 / occupiedPositions) * 100
        : 0,
  },
  {
    nome: "Estoque 2",
    valor: occupiedSlotsE2,
    percentual:
      occupiedPositions > 0
        ? (occupiedSlotsE2 / occupiedPositions) * 100
        : 0,
  },
  {
    nome: "Estoque 3",
    valor: occupiedSlotsE3,
    percentual:
      occupiedPositions > 0
        ? (occupiedSlotsE3 / occupiedPositions) * 100
        : 0,
  },
].sort((a, b) => b.percentual - a.percentual);

    const maxOccupancyPercentage =
    occupancyDistribution[0]?.percentual || 100;

    let occupancyMarkerPosition = 0;
    
    if (occupancyPercent <= 85) {
      occupancyMarkerPosition =
        (occupancyPercent / 85) * 70;
    }
    else if (occupancyPercent <= 95) {
      occupancyMarkerPosition =
        70 + ((occupancyPercent - 85) / 10) * 20;
    }
    else {
      occupancyMarkerPosition =
        90 + ((Math.min(occupancyPercent, 100) - 95) / 5) * 10;
    }
    
    occupancyMarkerPosition = Math.min(
      occupancyMarkerPosition,
      100
    );

    const validSnapshots = occupancyHistory
      .filter(item =>
        item.snapshot_date &&
        Number.isFinite(Number(item.occupied_positions)) &&
        Number.isFinite(Number(item.total_positions))
      )
      .sort((a, b) =>
        a.snapshot_date.localeCompare(b.snapshot_date)
      );

    const regressionPoints = validSnapshots.map(snapshot => ({
      x: new Date(`${snapshot.snapshot_date}T00:00:00`).getTime() / (1000 * 60 * 60 * 24),
      y: Number(snapshot.occupied_positions),
    })).filter(point => Number.isFinite(point.x));

    let occupancyTrendPerDay = 0;
    if (regressionPoints.length >= 2) {
      const meanX =
        regressionPoints.reduce((sum, point) => sum + point.x, 0) /
        regressionPoints.length;
      const meanY =
        regressionPoints.reduce((sum, point) => sum + point.y, 0) /
        regressionPoints.length;
      const denominator = regressionPoints.reduce(
        (sum, point) => sum + Math.pow(point.x - meanX, 2),
        0
      );

      if (denominator > 0) {
        occupancyTrendPerDay =
          regressionPoints.reduce(
            (sum, point) => sum + (point.x - meanX) * (point.y - meanY),
            0
          ) / denominator;
      }
    }

    const projectedOccupied30 = Math.max(
      0,
      occupiedPositions + occupancyTrendPerDay * 30
    );
    const projectedOccupancy30 =
      totalPositions > 0
        ? (projectedOccupied30 / totalPositions) * 100
        : 0;
    const saturationTarget = totalPositions * 0.95;

    const daysTo95 =
      occupancyTrendPerDay > 0 && occupiedPositions < saturationTarget
        ? (saturationTarget - occupiedPositions) / occupancyTrendPerDay
        : null;

    const occupancyStatus =
  occupancyPercent >= 95
    ? "critical"
    : occupancyPercent >= 85
    ? "warning"
    : "healthy";

    const occupancyStyles =
      occupancyStatus === "critical"
        ? {
            bg: "bg-red-50",
            border: "border-red-200",
            text: "text-red-700",
            label: "text-red-600",
          }
        : occupancyStatus === "warning"
        ? {
            bg: "bg-amber-50",
            border: "border-amber-200",
            text: "text-amber-700",
            label: "text-amber-600",
          }
        : {
            bg: "bg-emerald-50",
            border: "border-emerald-200",
            text: "text-emerald-700",
            label: "text-emerald-600",
          };
  
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

    <div
      className={`
        border rounded-xl p-4
        ${occupancyStyles.bg}
        ${occupancyStyles.border}
      `}
    >
      <div
      className={`
        text-sm font-bold uppercase
        ${occupancyStyles.label}
      `}
    >
        Status Atual
      </div>

      <div
        className={`
          text-3xl font-black mt-2
          ${occupancyStyles.text}
        `}
      >
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

      <div
        className={`
          text-sm font-semibold mt-2
          ${occupancyStyles.text}
        `}
      >
        Restam apenas {freePositions.toLocaleString()} posições livres
      </div>
    </div>

    {/* Barra */}
    <div className="lg:col-span-2 border rounded-xl p-4">

      <div className="text-sm font-bold text-slate-700 mb-3">
        Nível de Utilização
      </div>

      <div className="relative w-full h-6 rounded-full overflow-hidden flex">

        <div className="w-[70%] bg-emerald-500" />
      
        <div className="w-[20%] bg-amber-500" />
      
        <div className="w-[10%] bg-red-500" />
      
        <div
          className="absolute top-0 bottom-0 w-1 bg-white border border-slate-800 z-20"
          style={{
            left: `${occupancyMarkerPosition}%`,
          }}
        />
      
      </div>

      <div className="relative mt-2 h-5 text-xs">

        <span className="absolute left-0 text-emerald-600 font-semibold">
          0%
        </span>
      
        <span
          className="absolute text-emerald-600 font-semibold"
          style={{
            left: "70%",
            transform: "translateX(-50%)",
          }}
        >
          85%
        </span>
      
        <span
          className="absolute text-amber-600 font-semibold"
          style={{
            left: "90%",
            transform: "translateX(-50%)",
          }}
        >
          95%
        </span>
      
        <span className="absolute right-0 text-red-600 font-semibold">
          100%
        </span>
      
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

            <div className="border rounded-xl p-5 bg-slate-50">
              {validSnapshots.length < 2 ? (
                <>
                  <div className="font-bold text-slate-800">
                    Histórico ainda insuficiente
                  </div>
                  <p className="text-sm text-slate-600 leading-relaxed mt-2">
                    A projeção precisa de pelo menos dois registros de ocupação
                    em datas diferentes. O sistema já está preparado para
                    calcular a tendência assim que essa base existir.
                  </p>
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <div className="bg-white border rounded-lg p-3">
                      <div className="text-xs text-slate-500 uppercase">
                        Registros históricos
                      </div>
                      <div className="text-2xl font-black text-slate-700">
                        {validSnapshots.length}
                      </div>
                    </div>
                    <div className="bg-white border rounded-lg p-3">
                      <div className="text-xs text-slate-500 uppercase">
                        Ocupação atual
                      </div>
                      <div className="text-2xl font-black text-slate-700">
                        {occupancyPercent.toFixed(1)}%
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <div className="bg-white border rounded-lg p-3">
                      <div className="text-xs text-slate-500 uppercase">
                        Base histórica
                      </div>
                      <div className="text-2xl font-black text-slate-700">
                        {validSnapshots.length} dias
                      </div>
                    </div>

                    <div className="bg-white border rounded-lg p-3">
                      <div className="text-xs text-slate-500 uppercase">
                        Tendência
                      </div>
                      <div className={`text-2xl font-black ${
                        occupancyTrendPerDay > 0
                          ? "text-amber-600"
                          : occupancyTrendPerDay < 0
                            ? "text-emerald-600"
                            : "text-slate-700"
                      }`}>
                        {occupancyTrendPerDay > 0 ? "+" : ""}
                        {occupancyTrendPerDay.toFixed(2)}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        posições/dia
                      </div>
                    </div>

                    <div className="bg-white border rounded-lg p-3">
                      <div className="text-xs text-slate-500 uppercase">
                        Projeção 30 dias
                      </div>
                      <div className="text-2xl font-black text-slate-700">
                        {projectedOccupancy30.toFixed(1)}%
                      </div>
                    </div>

                    <div className="bg-white border rounded-lg p-3">
                      <div className="text-xs text-slate-500 uppercase">
                        Saturação 95%
                      </div>
                      <div className="text-2xl font-black text-slate-700">
                        {occupancyPercent >= 95
                          ? "Atingida"
                          : daysTo95 !== null
                            ? `${Math.max(1, Math.ceil(daysTo95))} dias`
                            : "Sem tendência"}
                      </div>
                    </div>
                  </div>

                  <p className="text-sm text-slate-600 leading-relaxed mt-4">
                    A projeção é uma extrapolação estatística da evolução real
                    dos snapshots de ocupação registrados no sistema. Ela não
                    representa previsão de produção, vendas ou demanda.
                  </p>

                  <div className="mt-4 text-xs text-slate-500">
                    Último snapshot:{" "}
                    <strong>{validSnapshots[validSnapshots.length - 1]?.snapshot_date}</strong>
                    {" • "}
                    Tendência calculada sobre os registros disponíveis.
                  </div>
                </>
              )}
            </div>
          </section>

          {/* PRESSÃO */}
          <section className="bg-white border rounded-xl p-5">

            <h3 className="text-lg font-bold mb-4">
              4. Distribuição da Ocupação
            </h3>
          
            <div className="space-y-4">

            {occupancyDistribution.map((item) => (
              <div
                key={item.nome}
                className="border rounded-xl p-4"
              >
                <div className="flex justify-between items-center mb-3">
          
                  <div>
                    <div className="font-bold text-slate-800">
                      {item.nome}
                    </div>
          
                    <div className="text-sm text-slate-500">
                      {item.valor.toLocaleString()} posições ocupadas
                    </div>
                  </div>
          
                  <div className="text-2xl font-black text-slate-800">
                    {item.percentual.toFixed(1)}%
                  </div>
          
                </div>
          
                <div className="w-full h-4 bg-slate-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-600 transition-all"
                    style={{
                      width: `${
                        (item.percentual / maxOccupancyPercentage) * 100
                      }%`,
                    }}
                  />
                </div>
          
              </div>
            ))}
          
          </div>
          
          <div className="mt-4 border rounded-xl p-4 bg-slate-50">
          
            <div className="font-bold text-slate-800 mb-2">
              Insight Executivo
            </div>
          
            <p className="text-sm text-slate-700">
              O <strong>{occupancyDistribution[0]?.nome}</strong>
              concentra{" "}
              <strong>
                {occupancyDistribution[0]?.percentual.toFixed(1)}%
              </strong>{" "}
              das posições ocupadas da empresa.
            </p>
          
            <p className="text-sm text-slate-700 mt-2">
              Os dois maiores estoques representam{" "}
              <strong>
                {(
                  (occupancyDistribution[0]?.percentual ?? 0) +
                  (occupancyDistribution[1]?.percentual ?? 0)
                ).toFixed(1)}%
              </strong>{" "}
              da ocupação física total.
            </p>
          
          </div>
              
          </section>

        </div>
      </div>
    </div>
  );
}
