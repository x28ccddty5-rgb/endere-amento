import { X, AlertTriangle, CheckCircle, Gauge } from "lucide-react";

interface OccupationRateDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  occupationRate: number;
}

export function OccupationRateDrawer({
  isOpen,
  onClose,
  occupationRate,
}: OccupationRateDrawerProps) {
  if (!isOpen) return null;

  const status =
    occupationRate >= 95
      ? {
          label: "CRÍTICO",
          color: "text-red-700",
          bg: "bg-red-50",
          border: "border-red-200",
          icon: AlertTriangle,
          message:
            "A ocupação está acima do nível de saturação operacional. A prioridade passa a ser consolidação, liberação de posições e controle de novos recebimentos.",
        }
      : occupationRate >= 85
        ? {
            label: "ATENÇÃO",
            color: "text-amber-700",
            bg: "bg-amber-50",
            border: "border-amber-200",
            icon: AlertTriangle,
            message:
              "A ocupação entrou na faixa de monitoramento. A operação ainda possui margem, mas a consolidação e a organização do estoque passam a ter impacto direto na flexibilidade.",
          }
        : {
            label: "SAUDÁVEL",
            color: "text-emerald-700",
            bg: "bg-emerald-50",
            border: "border-emerald-200",
            icon: CheckCircle,
            message:
              "A ocupação permanece abaixo do nível de atenção. Existe margem física para absorver novas necessidades sem indicar saturação pela métrica atual.",
          };

  const Icon = status.icon;
  const markerPosition =
    occupationRate <= 85
      ? (Math.max(0, occupationRate) / 85) * 70
      : occupationRate <= 95
        ? 70 + ((occupationRate - 85) / 10) * 20
        : Math.min(100, 90 + ((occupationRate - 95) / 5) * 10);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40">
      <div className="w-full max-w-4xl bg-white h-full overflow-y-auto">
        <div className="sticky top-0 bg-white border-b px-6 py-4 flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-bold text-slate-800">
              Análise de Ocupação (%)
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Leitura da ocupação física atual do endereçamento.
            </p>
          </div>

          <button
            onClick={onClose}
            className="text-xl px-2 py-1 rounded hover:bg-slate-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <section className={`border rounded-xl p-5 ${status.bg} ${status.border}`}>
            <div className="flex items-center gap-3">
              <Icon className={`w-6 h-6 ${status.color}`} />
              <div>
                <div className={`text-lg font-black ${status.color}`}>
                  {status.label}
                </div>
                <div className="text-sm text-slate-700">
                  Ocupação física atual
                </div>
              </div>
            </div>

            <div className={`text-6xl font-black ${status.color} mt-5`}>
              {occupationRate.toFixed(1)}%
            </div>

            <p className="text-sm text-slate-700 leading-relaxed mt-4">
              {status.message}
            </p>
          </section>

          <section className="border rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <Gauge className="w-5 h-5 text-indigo-600" />
              <h3 className="text-lg font-bold text-slate-800">
                Faixas operacionais
              </h3>
            </div>

            <div className="relative w-full h-8 rounded-full overflow-hidden flex">
              <div className="w-[70%] bg-emerald-500" />
              <div className="w-[20%] bg-amber-500" />
              <div className="w-[10%] bg-red-500" />
              <div
                className="absolute top-0 bottom-0 w-1 bg-white border border-slate-800 z-20"
                style={{ left: `${markerPosition}%` }}
              />
            </div>

            <div className="grid grid-cols-3 gap-3 mt-4 text-center">
              <div>
                <div className="font-bold text-emerald-600">🟢 Até 85%</div>
                <div className="text-xs text-slate-500">Faixa saudável</div>
              </div>
              <div>
                <div className="font-bold text-amber-600">🟡 85% a 95%</div>
                <div className="text-xs text-slate-500">Monitoramento</div>
              </div>
              <div>
                <div className="font-bold text-red-600">🔴 Acima de 95%</div>
                <div className="text-xs text-slate-500">Saturação</div>
              </div>
            </div>
          </section>

          <section className="border rounded-xl p-5 bg-slate-50">
            <h3 className="text-lg font-bold text-slate-800 mb-3">
              Leitura gerencial
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="bg-white border rounded-lg p-4">
                <div className="text-xs uppercase text-slate-500">
                  Margem até 85%
                </div>
                <div className="text-2xl font-black text-slate-700 mt-1">
                  {Math.max(0, 85 - occupationRate).toFixed(1)} p.p.
                </div>
              </div>

              <div className="bg-white border rounded-lg p-4">
                <div className="text-xs uppercase text-slate-500">
                  Margem até 95%
                </div>
                <div className="text-2xl font-black text-slate-700 mt-1">
                  {Math.max(0, 95 - occupationRate).toFixed(1)} p.p.
                </div>
              </div>

              <div className="bg-white border rounded-lg p-4">
                <div className="text-xs uppercase text-slate-500">
                  Situação
                </div>
                <div className={`text-2xl font-black ${status.color} mt-1`}>
                  {status.label}
                </div>
              </div>
            </div>

            <p className="text-sm text-slate-600 mt-4 leading-relaxed">
              A evolução histórica e a projeção de saturação ficam na análise
              detalhada de capacidade, onde são usados os snapshots reais de
              ocupação registrados no sistema. Isso evita duplicar indicadores
              ou apresentar projeções sem base histórica.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
