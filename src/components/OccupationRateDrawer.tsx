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

    const saturationLevel =
  occupationRate <= 85
    ? "healthy"
    : occupationRate <= 95
    ? "attention"
    : "critical";
  
  const saturationColor =
  saturationLevel === "healthy"
    ? "text-emerald-600"
    : saturationLevel === "attention"
    ? "text-amber-500"
    : "text-red-600";

    const saturationContent =
  saturationLevel === "healthy"
    ? {
        title: "🟢 Operação Saudável",
        color: "emerald",
        description:
          "A ocupação encontra-se dentro da faixa recomendada para operação.",

        impacts: [
          "Maior flexibilidade operacional",
          "Menor necessidade de remanejamentos",
          "Melhor velocidade de armazenagem",
          "Capacidade para absorver crescimento",
        ],

        insight:
          "A ocupação física encontra-se dentro da faixa recomendada, proporcionando flexibilidade operacional e capacidade para absorver novas demandas sem impacto significativo na produtividade.",
      }
    : saturationLevel === "attention"
    ? {
        title: "🟡 Operação em Atenção",
        color: "amber",
        description:
          "A ocupação aproxima-se do limite recomendado para operação.",

        impacts: [
          "Redução gradual da flexibilidade operacional",
          "Aumento de movimentações internas",
          "Maior necessidade de consolidação",
          "Monitoramento constante da capacidade",
        ],

        insight:
          "A ocupação física opera próxima ao limite recomendado. O cenário exige monitoramento contínuo para evitar aumento de movimentações internas e perda gradual de eficiência operacional.",
      }
    : {
        title: "🔴 Saturação Operacional",
        color: "red",
        description:
          "A ocupação ultrapassa o limite recomendado para operação.",

        impacts: [
          "Dificuldade para novas armazenagens",
          "Aumento de remanejamentos",
          "Perda de produtividade operacional",
          "Necessidade urgente de consolidação",
        ],

        insight:
          "A ocupação física encontra-se em nível crítico de saturação. A continuidade do crescimento sem ações corretivas poderá gerar restrições operacionais e impactos diretos na produtividade.",
      };
  
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40">

      <div className="w-full max-w-5xl bg-white h-full overflow-y-auto">

        <div className="sticky top-0 bg-white border-b px-6 py-4 flex justify-between items-center">

          <h2 className="text-2xl font-bold">
            Análise de Ocupação (%)
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
            1. Ocupação Atual
          </h3>
        
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
        
            <div className="font-bold text-amber-800 text-xl mb-3">
              🟡 Em Consolidação
            </div>
        
            <p className="text-sm text-slate-700">
              Os dados de ocupação e metas operacionais estão sendo consolidados.
            </p>
        
            <p className="text-sm text-slate-700 mt-2">
              A análise será disponibilizada automaticamente após a formação da base histórica.
            </p>
        
            <div className="grid grid-cols-3 gap-3 mt-4">
        
              <div className="bg-white border rounded-lg p-3">
                <div className="text-xs uppercase text-slate-500">
                  Meta Recomendada
                </div>
                <div className="text-3xl font-black text-slate-800">
                  85%
                </div>
              </div>
        
              <div className="bg-white border rounded-lg p-3">
                <div className="text-xs uppercase text-slate-500">
                  Ocupação Atual
                </div>
                <div className="text-3xl font-black text-slate-400">
                  —
                </div>
              </div>
        
              <div className="bg-white border rounded-lg p-3">
                <div className="text-xs uppercase text-slate-500">
                  Desvio
                </div>
                <div className="text-3xl font-black text-slate-400">
                  —
                </div>
              </div>
        
            </div>
        
          </div>
        
        </section>

          <section className="bg-white border rounded-xl p-5 mt-6">

            <h3 className="text-lg font-bold mb-4">
              2. Status de Saturação
            </h3>
          
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
          
              <div className="font-bold text-amber-800 text-xl mb-3">
                🟡 Em Consolidação
              </div>
          
              <p className="text-sm text-slate-700">
                O status de saturação será calculado automaticamente após a consolidação dos dados operacionais.
              </p>
          
              <div className="grid grid-cols-3 gap-3 mt-4">
          
                <div className="bg-white border rounded-lg p-3 text-center">
                  <div className="font-bold text-emerald-600">
                    🟢 Até 85%
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    Operação saudável
                  </div>
                </div>
          
                <div className="bg-white border rounded-lg p-3 text-center">
                  <div className="font-bold text-amber-500">
                    🟡 85% a 95%
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    Monitoramento
                  </div>
                </div>
          
                <div className="bg-white border rounded-lg p-3 text-center">
                  <div className="font-bold text-red-600">
                    🔴 Acima de 95%
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    Saturação
                  </div>
                </div>
          
              </div>
          
            </div>
          
          </section>

          <section className="bg-white border rounded-xl p-5 mt-6">

          <h3 className="text-lg font-bold mb-4">
            3. Evolução da Ocupação
          </h3>
        
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
        
            <div className="font-bold text-amber-800 text-xl mb-3">
              🟡 Em Consolidação
            </div>
        
            <p className="text-sm text-slate-700">
              Os dados históricos de ocupação estão sendo consolidados para gerar análises de tendência confiáveis.
            </p>
        
            <p className="text-sm text-slate-700 mt-2">
              A evolução será disponibilizada automaticamente após a formação da base histórica operacional.
            </p>
        
            <div className="grid grid-cols-3 gap-3 mt-4">
        
              <div className="bg-white border rounded-lg p-3">
                <div className="text-xs uppercase text-slate-500">
                  Base Histórica
                </div>
        
                <div className="text-2xl font-black text-slate-700">
                  Em coleta
                </div>
              </div>
        
              <div className="bg-white border rounded-lg p-3">
                <div className="text-xs uppercase text-slate-500">
                  Tendência
                </div>
        
                <div className="text-2xl font-black text-slate-400">
                  —
                </div>
              </div>
        
              <div className="bg-white border rounded-lg p-3">
                <div className="text-xs uppercase text-slate-500">
                  Variação
                </div>
        
                <div className="text-2xl font-black text-slate-400">
                  —
                </div>
              </div>
        
            </div>
        
          </div>
        
        </section>

        <section className="bg-white border rounded-xl p-5 mt-6">

          <h3 className="text-lg font-bold mb-4">
            4. Consequências da Saturação
          </h3>
        
          <div className="border rounded-xl p-5 bg-slate-50">
        
            <div className="text-xl font-bold mb-2">
              {saturationContent.title}
            </div>
        
            <div className="text-sm text-slate-600 mb-5">
              Ocupação atual: {occupationRate.toFixed(1)}%
            </div>
        
            <div className="text-sm text-slate-700 mb-5">
              {saturationContent.description}
            </div>
        
            <div className="grid grid-cols-2 gap-3">
        
              {saturationContent.impacts.map((impact) => (
                <div
                  key={impact}
                  className="border rounded-lg p-3 bg-white"
                >
                  {impact}
                </div>
              ))}
        
            </div>
        
          </div>
        
        </section>

        <section className="bg-white border rounded-xl p-5 mt-6">

          <h3 className="text-lg font-bold mb-4">
            5. Insight Executivo
          </h3>
        
          <div className="bg-slate-50 border rounded-xl p-5">
        
            <p className="text-sm leading-relaxed text-slate-700">
        
              A ocupação física do estoque encontra-se em{" "}
              <strong>{occupationRate.toFixed(1)}%</strong>.
        
            </p>
        
            <p className="text-sm leading-relaxed text-slate-700 mt-3">
        
              {saturationContent.insight}
        
            </p>
        
          </div>
        
        </section>
          
        </div>

      </div>

    </div>
  );
}
