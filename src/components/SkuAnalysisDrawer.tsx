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

  const portfolioHealth =
  top20Percent > 60
    ? "Alta Dependência"
    : top20Percent > 40
    ? "Moderadamente Concentrado"
    : "Diversificado";

  const portfolioCards =
  top20Percent > 60
    ? [
        {
          titulo: "Risco Comercial",
          texto:
            "Grande dependência de poucos SKUs para sustentar o volume armazenado.",
        },
        {
          titulo: "Risco Operacional",
          texto:
            "Oscilações de demanda podem gerar impactos relevantes na ocupação e produção.",
        },
        {
          titulo: "Flexibilidade",
          texto:
            "Baixa flexibilidade para absorver mudanças no mix de produtos.",
        },
      ]
    : top20Percent > 40
    ? [
        {
          titulo: "Risco Comercial",
          texto:
            "Existe concentração relevante, porém ainda distribuída entre diversos SKUs.",
        },
        {
          titulo: "Risco Operacional",
          texto:
            "A operação mantém equilíbrio entre volume e diversidade de produtos.",
        },
        {
          titulo: "Flexibilidade",
          texto:
            "Boa capacidade de adaptação a mudanças de demanda e portfólio.",
        },
      ]
    : [
        {
          titulo: "Risco Comercial",
          texto:
            "Baixa dependência dos principais SKUs.",
        },
        {
          titulo: "Risco Operacional",
          texto:
            "Estoque distribuído entre diferentes famílias de produtos.",
        },
        {
          titulo: "Flexibilidade",
          texto:
            "Alta capacidade de absorção de mudanças no mix operacional.",
        },
      ];
  
  const [selectedRanking, setSelectedRanking] =
  useState<10 | 20 | null>(null);

  const exportRankingCsv = (
  ranking: typeof top10Skus,
  nomeArquivo: string
) => {

  const headers = [
    "Referência",
    "Descrição",
    "Saldo",
    "Participação (%)"
  ];

  const rows = ranking.map((sku) => [
    sku.referencia,
    sku.descricao,
    sku.saldo,
    sku.percentual.toFixed(2)
  ]);

  const csvContent =
    "\uFEFF" +
    [headers, ...rows]
      .map((row) => row.join(";"))
      .join("\n");

  const blob = new Blob(
    [csvContent],
    {
      type: "text/csv;charset=utf-8;"
    }
  );

  const link =
    document.createElement("a");

  const url =
    URL.createObjectURL(blob);

  link.href = url;

  link.download =
    `${nomeArquivo}_${new Date()
      .toLocaleDateString("pt-BR")
      .replace(/\//g, "-")}.csv`;

  link.click();

  URL.revokeObjectURL(url);
};
  
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

          <section className="bg-white border rounded-xl p-5 mt-6">

            <h3 className="text-lg font-bold mb-4">
              3. Curva ABC
            </h3>
          
            <div className="border rounded-xl p-5 bg-amber-50 border-amber-200">
          
              <div className="text-xl font-bold text-amber-700">
                🚧 Em Consolidação
              </div>
          
              <p className="text-sm text-slate-700 mt-3">
                A análise ABC depende do acúmulo de histórico operacional para classificar os SKUs de acordo com sua relevância e movimentação.
              </p>
          
              <p className="text-sm text-slate-700 mt-2">
                Conforme o histórico for sendo construído, o sistema passará a identificar automaticamente os produtos Classe A, B e C.
              </p>
          
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
                    onClick={() =>
                      exportRankingCsv(
                        selectedRanking === 10
                          ? top10Skus
                          : top20Skus,
                        `Top${selectedRanking}_SKUs`
                      )
                    }
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

            <div className="border rounded-xl overflow-hidden">
              
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
          
      <section className="bg-white border rounded-xl p-5 mt-6">
    
      <h3 className="text-lg font-bold mb-4">
        4. Saúde do Portfólio
      </h3>
    
      <div className="border rounded-xl p-4 mb-4">
    
        <div className="text-xs uppercase text-slate-500">
          Classificação Atual
        </div>
    
        <div className={`text-4xl font-black ${concentrationColor}`}>
          {portfolioHealth}
        </div>
    
      </div>
    
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
    
        {portfolioCards.map((card) => (
    
          <div
            key={card.titulo}
            className="border rounded-xl p-4"
          >
    
            <div className="font-bold text-slate-800 mb-2">
              {card.titulo}
            </div>
    
            <div className="text-sm text-slate-600">
              {card.texto}
            </div>
    
          </div>
    
        ))}
    
      </div>
    
    </section>
          
        </div>

      </div>

    </div>
  );
}
