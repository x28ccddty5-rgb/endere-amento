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

    const totalSaldo = slots.reduce(
    (acc, slot) => acc + slot.saldo,
    0
  );

    const skuMap = new Map();
    slots.forEach((slot) => {
  if (!slot.referencia || slot.saldo <= 0) return;

  const existing = skuMap.get(slot.referencia);

  if (existing) {
    existing.saldo += slot.saldo;
  } else {
    skuMap.set(slot.referencia, {
      referencia: slot.referencia,
      descricao: slot.descricao,
      saldo: slot.saldo,
    });
  }
});

  const skuRanking = Array.from(
  skuMap.values()
)
  .map((sku) => ({
    ...sku,
    percentual:
      totalSaldo > 0
        ? (sku.saldo / totalSaldo) * 100
        : 0,
  }))
  .sort((a, b) => b.saldo - a.saldo);
  
  const top20Skus =
  skuRanking.slice(0, 20);
  
  const top20Percent =
  top20Skus.reduce(
    (acc, sku) => acc + sku.percentual,
    0
  );

  const remainingPercent =
  100 - top20Percent;
  
  
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
