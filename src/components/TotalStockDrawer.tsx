import type { HistoricoMov } from "../types";
import { parseChacoteDate } from "../lib/consultorEngine";

interface TotalStockDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  totalSaldo: number;
  history: HistoricoMov[];
}

export function TotalStockDrawer({
  isOpen,
  onClose,
  totalSaldo,
  history,
}: TotalStockDrawerProps) {
  if (!isOpen) return null;

  const entradas = history
    .filter(item => item.tipo === "Entrada")
    .reduce((sum, item) => sum + Math.max(0, Number(item.quantidade) || 0), 0);

  const saidas = history
    .filter(item => item.tipo === "Saída")
    .reduce((sum, item) => sum + Math.max(0, Number(item.quantidade) || 0), 0);

  const movimentacaoLiquida = entradas - saidas;
  const movimentacaoBruta = entradas + saidas;

  const timestamps = history
    .map(item => parseChacoteDate(item.data))
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);

  const firstTimestamp = timestamps[0];
  const lastTimestamp = timestamps[timestamps.length - 1];

  const elapsedDays =
    firstTimestamp !== undefined && lastTimestamp !== undefined
      ? Math.max(
          1,
          Math.floor(
            (lastTimestamp - firstTimestamp) /
              (1000 * 60 * 60 * 24)
          ) + 1
        )
      : 60;

  const averageNetPerDay = movimentacaoLiquida / elapsedDays;
  const projection30 = Math.max(0, totalSaldo + averageNetPerDay * 30);

  const trend =
    averageNetPerDay > 0.5
      ? "crescimento"
      : averageNetPerDay < -0.5
        ? "redução"
        : "estabilidade";

  const trendColor =
    trend === "crescimento"
      ? "text-amber-600"
      : trend === "redução"
        ? "text-emerald-600"
        : "text-slate-700";

  const projectionDifference = projection30 - totalSaldo;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40">
      <div className="w-full max-w-5xl bg-white h-full overflow-y-auto">
        <div className="sticky top-0 bg-white border-b px-6 py-4 flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-bold text-slate-800">
              Análise de Saldo Total
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Saldo atual e comportamento real das movimentações registradas.
            </p>
          </div>

          <button
            onClick={onClose}
            className="text-xl px-2 py-1 rounded hover:bg-slate-100"
          >
            ×
          </button>
        </div>

        <div className="p-6 space-y-6">
          <section className="bg-white border rounded-xl p-5">
            <h3 className="text-lg font-bold mb-4">
              1. Saldo Atual
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="border rounded-xl p-4 bg-slate-50">
                <div className="text-xs uppercase text-slate-500">
                  Saldo físico atual
                </div>
                <div className="text-4xl font-black text-slate-800 mt-1">
                  {totalSaldo.toLocaleString("pt-BR")}
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  peças armazenadas
                </div>
              </div>

              <div className="border rounded-xl p-4">
                <div className="text-xs uppercase text-slate-500">
                  Movimentação bruta
                </div>
                <div className="text-3xl font-black text-blue-600 mt-1">
                  {movimentacaoBruta.toLocaleString("pt-BR")}
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  peças movimentadas no histórico carregado
                </div>
              </div>

              <div className="border rounded-xl p-4">
                <div className="text-xs uppercase text-slate-500">
                  Tendência líquida
                </div>
                <div className={`text-3xl font-black ${trendColor} mt-1`}>
                  {movimentacaoLiquida > 0 ? "+" : ""}
                  {movimentacaoLiquida.toLocaleString("pt-BR")}
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  entrada menos saída
                </div>
              </div>
            </div>
          </section>

          <section className="bg-white border rounded-xl p-5">
            <h3 className="text-lg font-bold mb-4">
              2. Comportamento das Movimentações
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="border rounded-xl p-4">
                <div className="text-xs uppercase text-slate-500">Entradas</div>
                <div className="text-3xl font-black text-emerald-600 mt-1">
                  {entradas.toLocaleString("pt-BR")}
                </div>
              </div>

              <div className="border rounded-xl p-4">
                <div className="text-xs uppercase text-slate-500">Saídas</div>
                <div className="text-3xl font-black text-red-600 mt-1">
                  {saidas.toLocaleString("pt-BR")}
                </div>
              </div>

              <div className="border rounded-xl p-4">
                <div className="text-xs uppercase text-slate-500">
                  Média líquida/dia
                </div>
                <div className={`text-3xl font-black ${trendColor} mt-1`}>
                  {averageNetPerDay > 0 ? "+" : ""}
                  {averageNetPerDay.toFixed(1)}
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  peças por dia
                </div>
              </div>

              <div className="border rounded-xl p-4">
                <div className="text-xs uppercase text-slate-500">
                  Período carregado
                </div>
                <div className="text-3xl font-black text-slate-700 mt-1">
                  {elapsedDays}
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  dias de histórico
                </div>
              </div>
            </div>

            <div className="mt-4 border rounded-xl p-4 bg-slate-50">
              <p className="text-sm text-slate-700 leading-relaxed">
                O estoque apresenta tendência de{" "}
                <strong className={trendColor}>{trend}</strong> no período
                analisado. A leitura considera somente movimentações
                efetivamente registradas no histórico.
              </p>
            </div>
          </section>

          <section className="bg-white border rounded-xl p-5">
            <h3 className="text-lg font-bold mb-4">
              3. Projeção Simples de Saldo
            </h3>

            <div className="border rounded-xl p-5 bg-slate-50">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white border rounded-lg p-4">
                  <div className="text-xs uppercase text-slate-500">
                    Saldo atual
                  </div>
                  <div className="text-3xl font-black text-slate-700 mt-1">
                    {totalSaldo.toLocaleString("pt-BR")}
                  </div>
                </div>

                <div className="bg-white border rounded-lg p-4">
                  <div className="text-xs uppercase text-slate-500">
                    Projeção em 30 dias
                  </div>
                  <div className={`text-3xl font-black ${trendColor} mt-1`}>
                    {projection30.toLocaleString("pt-BR", {
                      maximumFractionDigits: 0,
                    })}
                  </div>
                </div>

                <div className="bg-white border rounded-lg p-4">
                  <div className="text-xs uppercase text-slate-500">
                    Variação projetada
                  </div>
                  <div className={`text-3xl font-black ${trendColor} mt-1`}>
                    {projectionDifference > 0 ? "+" : ""}
                    {projectionDifference.toLocaleString("pt-BR", {
                      maximumFractionDigits: 0,
                    })}
                  </div>
                </div>
              </div>

              <p className="text-sm text-slate-600 leading-relaxed mt-4">
                Esta projeção é uma extrapolação do ritmo líquido observado no
                histórico carregado. Não é previsão de vendas, produção ou
                demanda e deve ser usada como indicador de tendência.
              </p>
            </div>
          </section>

          <section className="bg-white border rounded-xl p-5">
            <h3 className="text-lg font-bold mb-4">
              4. Insight Executivo
            </h3>

            <div className="border rounded-xl p-5 bg-slate-50">
              <p className="text-slate-700 leading-relaxed">
                O estoque possui atualmente{" "}
                <strong>{totalSaldo.toLocaleString("pt-BR")} peças</strong>.
                No período carregado, foram registradas{" "}
                <strong>{entradas.toLocaleString("pt-BR")} peças de entrada</strong>
                {" "}e{" "}
                <strong>{saidas.toLocaleString("pt-BR")} peças de saída</strong>,
                resultando em uma tendência líquida de{" "}
                <strong>{trend}</strong>.
              </p>

              {history.length === 0 && (
                <p className="text-sm text-amber-700 mt-3">
                  Não há histórico de movimentações disponível para calcular
                  tendência ou projeção.
                </p>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
