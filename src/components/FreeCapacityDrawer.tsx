interface FreeCapacityDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  freePositions: number;
  totalPositions: number;
  freeSlotsE1: number;
  freeSlotsE2: number;
  freeSlotsE3: number;
}

export function FreeCapacityDrawer({
  isOpen,
  onClose,
  freePositions,
  totalPositions,
}: FreeCapacityDrawerProps) {
  if (!isOpen) return null;

  const freePercent =
    (freePositions / totalPositions) * 100;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40">

      <div className="w-full max-w-5xl bg-white h-full overflow-y-auto">

        <div className="sticky top-0 bg-white border-b px-6 py-4 flex justify-between items-center">

          <h2 className="text-2xl font-bold">
            Análise de Capacidade Disponível
          </h2>

          <button onClick={onClose}>
            X
          </button>

        </div>

        <div className="p-6">

          <section className="bg-white border rounded-xl p-5">

            <h3 className="text-lg font-bold mb-4">
              1. Capacidade Disponível
            </h3>
          
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          
              <div className="border rounded-xl p-4">
          
                <div className="text-xs uppercase text-slate-500">
                  Posições Livres
                </div>
          
                <div className="text-5xl font-black text-emerald-600">
                  {freePositions}
                </div>
          
              </div>
          
              <div className="border rounded-xl p-4">
          
                <div className="text-xs uppercase text-slate-500">
                  Capacidade Livre
                </div>
          
                <div className="text-5xl font-black text-emerald-600">
                  {freePercent.toFixed(1)}%
                </div>
          
              </div>
          
              <div className="border rounded-xl p-4">
          
                <div className="text-xs uppercase text-slate-500">
                  Capacidade Total
                </div>
          
                <div className="text-5xl font-black text-slate-800">
                  {totalPositions}
                </div>
          
              </div>
          
            </div>
          
          </section>

          <section className="bg-white border rounded-xl p-5 mt-6">

            <h3 className="text-lg font-bold mb-4">
              2. Status Operacional
            </h3>
          
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          
              <div
                className={`border rounded-xl p-4 ${
                  freePercent < 5
                    ? "bg-red-50 border-red-200"
                    : freePercent < 15
                    ? "bg-amber-50 border-amber-200"
                    : "bg-emerald-50 border-emerald-200"
                }`}
              >
          
                <div className="text-sm font-bold uppercase">
          
                  {freePercent < 5
                    ? "🔴 Crítico"
                    : freePercent < 15
                    ? "🟡 Atenção"
                    : "🟢 Saudável"}
          
                </div>
          
                <div className="mt-3 text-sm text-slate-700">
          
                  {freePercent < 5
                    ? "Baixíssima disponibilidade de espaço."
                    : freePercent < 15
                    ? "Monitoramento necessário."
                    : "Capacidade confortável para expansão."}
          
                </div>
          
              </div>
          
              <div className="lg:col-span-2 border rounded-xl p-4">
          
                <div className="text-sm font-bold text-slate-700 mb-3">
                  Disponibilidade Atual
                </div>
          
                <div className="w-full h-4 bg-slate-200 rounded-full overflow-hidden">
          
                  <div
                    className={`h-full ${
                      freePercent < 5
                        ? "bg-red-500"
                        : freePercent < 15
                        ? "bg-amber-500"
                        : "bg-emerald-500"
                    }`}
                    style={{
                      width: `${Math.min(freePercent, 100)}%`,
                    }}
                  />
          
                </div>
          
                <div className="grid grid-cols-3 gap-3 mt-4 text-center">
          
                  <div>
                    <div className="font-bold text-emerald-600">
                      🟢 Acima de 15%
                    </div>
          
                    <div className="text-xs text-slate-500">
                      Operação confortável
                    </div>
                  </div>
          
                  <div>
                    <div className="font-bold text-amber-600">
                      🟡 5% a 15%
                    </div>
          
                    <div className="text-xs text-slate-500">
                      Monitoramento
                    </div>
                  </div>
          
                  <div>
                    <div className="font-bold text-red-600">
                      🔴 Abaixo de 5%
                    </div>
          
                    <div className="text-xs text-slate-500">
                      Risco operacional
                    </div>
                  </div>
          
                </div>
          
              </div>
          
            </div>
          
            <div className="mt-4 border rounded-xl p-4 bg-slate-50">
          
              <p className="text-sm text-slate-700">
          
                Atualmente existem{" "}
                <strong>{freePositions}</strong>{" "}
                posições livres de um total de{" "}
                <strong>{totalPositions}</strong>{" "}
                posições físicas disponíveis.
          
                Isso representa{" "}
                <strong>{freePercent.toFixed(1)}%</strong>{" "}
                da capacidade total do estoque.
          
              </p>
          
            </div>
          
          </section>
          
        </div>

      </div>

    </div>
  );
}
