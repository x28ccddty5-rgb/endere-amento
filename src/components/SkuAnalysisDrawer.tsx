interface SkuAnalysisDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  uniqueSKUs: number;
}

export function SkuAnalysisDrawer({
  isOpen,
  onClose,
  uniqueSKUs,
}: SkuAnalysisDrawerProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40">

      <div className="w-full max-w-5xl bg-white h-full overflow-y-auto">

        <div className="sticky top-0 bg-white border-b px-6 py-4 flex justify-between items-center">

          <h2 className="text-2xl font-bold">
            Análise de Diversidade de Estoque
          </h2>

          <button
            onClick={onClose}
            className="text-xl"
          >
            ×
          </button>

        </div>

        <div className="p-6">

          <section className="bg-white border rounded-xl p-5">

            <h3 className="text-lg font-bold mb-4">
              1. Visão Geral dos SKUs
            </h3>

            <div className="grid grid-cols-3 gap-4">

              <div className="border rounded-xl p-4">

                <div className="text-xs uppercase text-slate-500">
                  SKUs Ativos
                </div>

                <div className="text-5xl font-black text-slate-800">
                  {uniqueSKUs}
                </div>

              </div>

              <div className="border rounded-xl p-4">

                <div className="text-xs uppercase text-slate-500">
                  Base sem Giro
                </div>

                <div className="text-5xl font-black text-slate-400">
                  —
                </div>

              </div>

              <div className="border rounded-xl p-4">

                <div className="text-xs uppercase text-slate-500">
                  Base com Giro
                </div>

                <div className="text-5xl font-black text-slate-400">
                  —
                </div>

              </div>

            </div>

          </section>

        </div>

      </div>

    </div>
  );
}
