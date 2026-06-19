import React, { useState } from "react";
interface SkuAnalysisDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  uniqueSKUs: number;
  slots: WarehouseSlot[];
}

export function SkuAnalysisDrawer({
  isOpen,
  onClose,
  uniqueSKUs,
  slots,
}: SkuAnalysisDrawerProps) {
  if (!isOpen) return null;

    const totalSaldo = slots.reduce(
    (acc, slot) => acc + slot.saldo,
    0
  );

    const skuMap = new Map<
      string,
      {
        referencia: string;
        descricao: string;
        saldo: number;
      }
    >();

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

  const top10Skus =
  skuRanking.slice(0, 10);
  
  const top20Percent =
  top20Skus.reduce(
    (acc, sku) => acc + sku.percentual,
    0
  );

  const top10Percent =
  top10Skus.reduce(
    (acc, sku) => acc + sku.percentual,
    0
  );
  
  const remainingPercent =
  100 - top20Percent;

  const concentrationLevel =
  top20Percent > 60
    ? "Alta"
    : top20Percent > 40
    ? "Média"
    : "Baixa";

  const concentrationColor =
  top20Percent > 60
    ? "text-red-600"
    : top20Percent > 40
    ? "text-amber-600"
    : "text-emerald-600";
  
  const [selectedRanking, setSelectedRanking] =
  useState<10 | 20 | null>(null);
  
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
                Top 20 SKUs
              </div>
              
              <div className={`text-4xl font-black ${concentrationColor}`}>
              {top20Percent.toFixed(1)}%
              </div>
              
              <div className="text-xs text-slate-500 mt-2">
                Representatividade
              </div>

              </div>

              <div className="border rounded-xl p-4">

                <div className="text-xs uppercase text-slate-500">
                Demais SKUs
              </div>
              
              <div className="text-5xl font-black text-blue-600">
                {remainingPercent.toFixed(1)}%
              </div>
              
              <div className="text-xs text-slate-500 mt-2">
                Participação restante
              </div>
                
              </div>

            </div>

          </section>

          <section className="bg-white border rounded-xl p-5 mt-6">

            <h3 className="text-lg font-bold mb-4">
              2. Distribuição dos SKUs
            </h3>
          
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          
              <div
                onClick={() => setSelectedRanking(10)}
                className="border rounded-xl p-4 cursor-pointer hover:bg-slate-50"
              >
                <div className="text-xs uppercase text-slate-500">
                  Top 10 SKUs
                </div>
          
                <div className="text-4xl font-black text-blue-600">
                  {top10Percent.toFixed(1)}%
                </div>
          
                <div className="text-xs text-slate-500 mt-2">
                  Clique para visualizar
                </div>
              </div>
          
              <div
                onClick={() => setSelectedRanking(20)}
                className="border rounded-xl p-4 cursor-pointer hover:bg-slate-50"
              >
                <div className="text-xs uppercase text-slate-500">
                  Top 20 SKUs
                </div>
          
                <div className="text-4xl font-black text-emerald-600">
                  {top20Percent.toFixed(1)}%
                </div>
          
                <div className="text-xs text-slate-500 mt-2">
                  Clique para visualizar
                </div>
              </div>
          
              <div className="border rounded-xl p-4">
          
                <div className="text-xs uppercase text-slate-500">
                  Concentração
                </div>
          
                <div className={`text-4xl font-black ${concentrationColor}`}>
                  {concentrationLevel}
                </div>
          
                <div className="text-xs text-slate-500 mt-2">
                  Dependência dos principais SKUs
                </div>
          
              </div>
          
            </div>
          
          </section>

          {selectedRanking && (

            <section className="bg-white border rounded-xl p-5 mt-6">
          
              <div className="flex items-center justify-between mb-4">
          
                <h3 className="text-lg font-bold">
                  Top {selectedRanking} SKUs
                </h3>
          
                <div className="flex gap-2">

                  <button
                    className="px-3 py-1.5 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"
                  >
                    Exportar CSV
                  </button>
                
                  <button
                    onClick={() => setSelectedRanking(null)}
                    className="px-3 py-1.5 text-sm border rounded-lg hover:bg-slate-50"
                  >
                    Fechar
                  </button>
                
                </div>
          
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">

              <div className="border rounded-xl p-4 bg-slate-50">
            
                <div className="text-xs uppercase text-slate-500">
                  Participação
                </div>
            
                <div className={`text-4xl font-black ${concentrationColor}`}>
                  {selectedRanking === 10
                    ? top10Percent.toFixed(1)
                    : top20Percent.toFixed(1)}%
                </div>
            
                <div className="text-sm text-slate-500 mt-2">
                  Do estoque total armazenado
                </div>
            
              </div>
            
              <div className="border rounded-xl p-4 bg-slate-50">
            
                <div className="text-xs uppercase text-slate-500">
                  Impacto Operacional
                </div>
            
                <div className="text-sm text-slate-700 mt-2">
            
                  {selectedRanking === 10
                    ? "Os 10 principais SKUs concentram parcela relevante da operação e influenciam diretamente armazenagem, produção e movimentação."
                    : "Os 20 principais SKUs representam o núcleo operacional do estoque e concentram grande parte do volume armazenado."}
            
                </div>
            
              </div>
            
            </div>

                <div
                className="
                  bg-slate-100
                  px-4
                  py-3
                  grid
                  grid-cols-[140px_1fr_140px_100px]
                  text-xs
                  font-bold
                  uppercase
                  text-slate-600
                "
              >
        
                <div>Referência</div>
                <div>Descrição</div>
                <div>Saldo</div>
                <div>%</div>
        
              </div>

            <div className="max-h-[450px] overflow-auto">

        {(selectedRanking === 10
          ? top10Skus
          : top20Skus
        ).map((sku) => (

                  <div
            key={sku.referencia}
            className="
              px-4
              py-3
              grid
              grid-cols-[140px_1fr_140px_100px]
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

            <div className="font-semibold text-blue-600">
              {sku.percentual.toFixed(1)}%
            </div>

          </div>

          ))}

      </div>

    </div>

  </section>

)}
          
        </div>

      </div>

    </div>
  );
}
