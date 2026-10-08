import React, { useState } from "react";
import { HistoricoMov, WarehouseSlot } from "../types";
interface SkuAnalysisDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  uniqueSKUs: number;
  slots: WarehouseSlot[];
  history: HistoricoMov[];
}

export function SkuAnalysisDrawer({
  isOpen,
  onClose,
  uniqueSKUs,
  slots,
  history,
}: SkuAnalysisDrawerProps) {
  const [selectedRanking, setSelectedRanking] =
    useState<10 | 20 | null>(null);

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

  const abcAnalysis = (() => {
    const movementBySku = new Map<string, {
      referencia: string;
      descricao: string;
      movimentacao: number;
    }>();

    history.forEach(movement => {
      const referencia = (movement.referencia || "").trim().toUpperCase();
      const quantidade = Math.abs(Number(movement.quantidade) || 0);

      if (!referencia || quantidade <= 0) return;

      const current = movementBySku.get(referencia) || {
        referencia,
        descricao:
          slots.find(
            slot => String(slot.referencia || "").trim().toUpperCase() === referencia
          )?.descricao || "-",
        movimentacao: 0,
      };

      current.movimentacao += quantidade;
      movementBySku.set(referencia, current);
    });

    const ranking = [...movementBySku.values()]
      .sort((a, b) => b.movimentacao - a.movimentacao);

    const totalMovimentacao = ranking.reduce(
      (sum, item) => sum + item.movimentacao,
      0
    );

    let acumulado = 0;

    const classified = ranking.map(item => {
      acumulado += item.movimentacao;
      const percentualAcumulado =
        totalMovimentacao > 0
          ? (acumulado / totalMovimentacao) * 100
          : 0;

      return {
        ...item,
        percentual: totalMovimentacao > 0
          ? (item.movimentacao / totalMovimentacao) * 100
          : 0,
        percentualAcumulado,
        classe:
          percentualAcumulado <= 70
            ? "A"
            : percentualAcumulado <= 90
              ? "B"
              : "C",
      };
    });

    return {
      ranking: classified,
      totalMovimentacao,
      classeA: classified.filter(item => item.classe === "A").length,
      classeB: classified.filter(item => item.classe === "B").length,
      classeC: classified.filter(item => item.classe === "C").length,
      shareA: classified
        .filter(item => item.classe === "A")
        .reduce((sum, item) => sum + item.percentual, 0),
      shareB: classified
        .filter(item => item.classe === "B")
        .reduce((sum, item) => sum + item.percentual, 0),
      shareC: classified
        .filter(item => item.classe === "C")
        .reduce((sum, item) => sum + item.percentual, 0),
    };
  })();
  
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
              3. Curva ABC por Movimentação
            </h3>

            {abcAnalysis.totalMovimentacao <= 0 ? (
              <div className="border rounded-xl p-5 bg-slate-50">
                <div className="font-bold text-slate-800">
                  Sem movimentações suficientes
                </div>
                <p className="text-sm text-slate-600 mt-2">
                  A Curva ABC precisa de movimentações registradas para
                  classificar os SKUs por relevância operacional.
                </p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <div className="border rounded-xl p-4 bg-slate-50">
                    <div className="text-xs uppercase text-slate-500">
                      Movimentação analisada
                    </div>
                    <div className="text-3xl font-black text-slate-800 mt-1">
                      {abcAnalysis.totalMovimentacao.toLocaleString("pt-BR")}
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      peças movimentadas no histórico carregado
                    </div>
                  </div>

                  <div className="border rounded-xl p-4">
                    <div className="text-xs uppercase text-slate-500">
                      Classe A
                    </div>
                    <div className="text-3xl font-black text-red-600 mt-1">
                      {abcAnalysis.classeA}
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      {abcAnalysis.shareA.toFixed(1)}% da movimentação
                    </div>
                  </div>

                  <div className="border rounded-xl p-4">
                    <div className="text-xs uppercase text-slate-500">
                      Classe B
                    </div>
                    <div className="text-3xl font-black text-amber-600 mt-1">
                      {abcAnalysis.classeB}
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      {abcAnalysis.shareB.toFixed(1)}% da movimentação
                    </div>
                  </div>

                  <div className="border rounded-xl p-4">
                    <div className="text-xs uppercase text-slate-500">
                      Classe C
                    </div>
                    <div className="text-3xl font-black text-slate-600 mt-1">
                      {abcAnalysis.classeC}
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      {abcAnalysis.shareC.toFixed(1)}% da movimentação
                    </div>
                  </div>
                </div>

                <div className="mt-4 border rounded-xl overflow-hidden">
                  <div className="grid grid-cols-[80px_1fr_140px_120px_120px] bg-slate-100 px-4 py-2 text-[10px] font-bold uppercase text-slate-600">
                    <div>Classe</div>
                    <div>SKU</div>
                    <div>Movimentação</div>
                    <div>Participação</div>
                    <div>Acumulado</div>
                  </div>

                  <div className="max-h-[320px] overflow-auto">
                    {abcAnalysis.ranking.slice(0, 30).map(item => (
                      <div
                        key={item.referencia}
                        className="grid grid-cols-[80px_1fr_140px_120px_120px] px-4 py-2 border-t text-xs"
                      >
                        <div className="font-black">{item.classe}</div>
                        <div className="font-mono">{item.referencia}</div>
                        <div>{item.movimentacao.toLocaleString("pt-BR")} pçs</div>
                        <div>{item.percentual.toFixed(1)}%</div>
                        <div>{item.percentualAcumulado.toFixed(1)}%</div>
                      </div>
                    ))}
                  </div>
                </div>

                <p className="text-xs text-slate-500 mt-3">
                  Critério: Pareto por volume absoluto de movimentações do
                  histórico carregado. Classe A até 70% acumulado, B até 90% e
                  C acima de 90%. A classificação é operacional e deve ser
                  recalculada conforme a janela histórica disponível.
                </p>
              </>
            )}
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
    
      <div
      className={`border rounded-xl p-5 mb-4 ${
        top20Percent > 60
          ? "bg-red-50 border-red-200"
          : top20Percent > 40
          ? "bg-amber-50 border-amber-200"
          : "bg-emerald-50 border-emerald-200"
      }`}
    >
    
      <div className="text-xs uppercase font-bold mb-2">
    
        {top20Percent > 60
          ? "🔴 Alta Dependência"
          : top20Percent > 40
          ? "🟡 Portfólio em Atenção"
          : "🟢 Portfólio Diversificado"}
    
      </div>
    
      <div className={`text-4xl font-black ${concentrationColor}`}>
        {portfolioHealth}
      </div>
    
      <div className="mt-3 text-sm text-slate-700">
    
        {top20Percent > 60
          ? "Grande parte do estoque está concentrada em poucos SKUs, aumentando a exposição operacional."
          : top20Percent > 40
          ? "Existe concentração relevante, porém ainda distribuída entre diversos produtos."
          : "O estoque apresenta boa distribuição entre os SKUs armazenados."}
    
      </div>
    
    </div>
    
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
    
        {portfolioCards.map((card) => (
    
          <div
          key={card.titulo}
          className={`border rounded-xl p-5 ${
            top20Percent > 60
              ? "bg-red-50 border-red-200"
              : top20Percent > 40
              ? "bg-amber-50 border-amber-200"
              : "bg-emerald-50 border-emerald-200"
          }`}
        >
        
          <div
          className={`text-3xl mb-3 ${
            top20Percent > 60
              ? "text-red-600"
              : top20Percent > 40
              ? "text-amber-600"
              : "text-emerald-600"
          }`}
        >
        
            {card.titulo === "Risco Comercial"
              ? "📈"
              : card.titulo === "Risco Operacional"
              ? "⚙️"
              : "🔄"}
        
          </div>
        
          <div
            className={`font-bold mb-2 ${
              top20Percent > 60
                ? "text-red-700"
                : top20Percent > 40
                ? "text-amber-700"
                : "text-emerald-700"
            }`}
          >
            {card.titulo}
          </div>
        
          <div className="text-sm text-slate-600">
            {card.texto}
          </div>
        
        </div>
    
        ))}
    
      </div>
    
    </section>

        <section className="bg-white border rounded-xl p-5 mt-6">

        <h3 className="text-lg font-bold mb-4">
          5. Conclusão Estratégica
        </h3>

        <div
        className={`border rounded-xl p-5 ${
          top20Percent > 60
            ? "bg-red-50 border-red-200"
            : top20Percent > 40
            ? "bg-amber-50 border-amber-200"
            : "bg-emerald-50 border-emerald-200"
        }`}
      >

          <div
          className={`font-bold text-xl mb-4 ${
            top20Percent > 60
              ? "text-red-700"
              : top20Percent > 40
              ? "text-amber-700"
              : "text-emerald-700"
          }`}
        >
        
          {top20Percent > 60
            ? "🔴 Portfólio com Alta Dependência"
            : top20Percent > 40
            ? "🟡 Portfólio Moderadamente Concentrado"
            : "🟢 Portfólio Diversificado"}
        
        </div>

          <p className="text-slate-700 leading-relaxed">

          Os <strong>20 principais SKUs</strong> representam{" "}
          <strong>{top20Percent.toFixed(1)}%</strong>{" "}
          do volume armazenado.
        
          Atualmente existem{" "}
          <strong>{uniqueSKUs}</strong>{" "}
          SKUs ativos no estoque.
        
        </p>
        
        <p className="text-slate-700 leading-relaxed mt-4">
        
          {top20Percent > 60
            ? "A concentração elevada indica forte dependência dos principais produtos. Alterações de demanda nesses itens podem impactar significativamente a operação."
            : top20Percent > 40
            ? "Existe concentração relevante, porém distribuída entre diversos produtos. O cenário permanece equilibrado e operacionalmente saudável."
            : "A distribuição dos volumes encontra-se bem pulverizada entre os SKUs ativos, reduzindo riscos de dependência operacional."}
        
        </p>
        
        <p className="text-slate-700 leading-relaxed mt-4">
        
          {top20Percent > 60
            ? "Recomenda-se monitoramento contínuo dos produtos dominantes e avaliação periódica da diversificação do portfólio."
            : top20Percent > 40
            ? "Recomenda-se acompanhamento da evolução da concentração para garantir manutenção do equilíbrio atual."
            : "O portfólio apresenta boa distribuição e flexibilidade para absorver mudanças de mercado e produção."}
        
        </p>

          </div>

      </section>
          
        </div>

      </div>

    </div>
  );
}
