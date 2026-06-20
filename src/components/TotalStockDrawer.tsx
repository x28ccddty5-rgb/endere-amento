interface TotalStockDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  totalSaldo: number;
}

export function TotalStockDrawer({
  isOpen,
  onClose,
  totalSaldo,
}: TotalStockDrawerProps) {

  if (!isOpen) return null;

  const stockTarget = 2000000;

  const stockEfficiency =
    (totalSaldo / stockTarget) * 100;
  
  const stockDifference =
    totalSaldo - stockTarget;

  const stockPressurePercent =
  Math.max(
    0,
    Math.min(
      ((stockEfficiency - 90) / 20) * 100,
      100
    )
  );
  
  const stockStatus =
  stockEfficiency > 105
    ? "critical"
    : stockEfficiency > 100
    ? "warning"
    : "healthy";

  const stockColor =
  stockStatus === "critical"
    ? "text-red-600"
    : stockStatus === "warning"
    ? "text-yellow-600"
    : "text-emerald-600";

  const stockTitle =
  stockStatus === "critical"
    ? "🔴 Estoque Acima da Capacidade Planejada"
    : stockStatus === "warning"
    ? "🟡 Estoque em Atenção"
    : "🟢 Estoque Saudável";

  const stockDescription =
  stockStatus === "critical"
    ? "O volume armazenado ultrapassou significativamente a meta operacional."
    : stockStatus === "warning"
    ? "O estoque encontra-se acima da meta definida para a unidade."
    : "O estoque opera dentro dos limites recomendados.";

  const riskCards =
  stockStatus === "critical"
    ? [
        {
          icon: "📦",
          title: "Capacidade Física",
          text: "O estoque aproxima-se do limite operacional da estrutura física.",
        },
        {
          icon: "💰",
          title: "Capital Imobilizado",
          text: "Maior volume financeiro retido em estoque.",
        },
        {
          icon: "🔄",
          title: "Flexibilidade",
          text: "Menor capacidade de absorver aumentos de produção.",
        },
      ]
    : stockStatus === "warning"
    ? [
        {
          icon: "📦",
          title: "Capacidade Física",
          text: "A ocupação permanece controlada, porém requer monitoramento.",
        },
        {
          icon: "💰",
          title: "Capital Imobilizado",
          text: "Existe aumento moderado do capital armazenado.",
        },
        {
          icon: "🔄",
          title: "Flexibilidade",
          text: "A operação ainda possui margem para absorção de demanda.",
        },
      ]
    : [
        {
          icon: "📦",
          title: "Capacidade Física",
          text: "Capacidade física operando dentro dos níveis recomendados.",
        },
        {
          icon: "💰",
          title: "Capital Imobilizado",
          text: "Volume saudável de recursos mantidos em estoque.",
        },
        {
          icon: "🔄",
          title: "Flexibilidade",
          text: "Alta capacidade de adaptação às variações operacionais.",
        },
      ];

  const executiveInsight =
  stockStatus === "critical"
    ? `O estoque atual encontra-se em ${totalSaldo.toLocaleString()} peças, operando em ${stockEfficiency.toFixed(1)}% da meta definida para a unidade. O volume armazenado ultrapassa significativamente o limite operacional recomendado, aumentando a pressão sobre capacidade física, capital imobilizado e flexibilidade operacional.`
    : stockStatus === "warning"
    ? `O estoque atual encontra-se em ${totalSaldo.toLocaleString()} peças, operando em ${stockEfficiency.toFixed(1)}% da meta definida para a unidade. Embora ainda não represente um cenário crítico, o excedente de ${stockDifference.toLocaleString()} peças exige monitoramento contínuo para evitar aumento da pressão operacional.`
    : `O estoque atual encontra-se em ${totalSaldo.toLocaleString()} peças, operando em ${stockEfficiency.toFixed(1)}% da meta definida para a unidade. O volume armazenado permanece dentro dos limites recomendados, garantindo capacidade operacional e flexibilidade para absorção de demanda.`;
  
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40">

      <div className="w-full max-w-5xl bg-white h-full overflow-y-auto">

        <div className="sticky top-0 bg-white border-b px-6 py-4 flex justify-between items-center">

          <h2 className="text-2xl font-bold">
            Análise de Saldo Total
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
          1. Eficiência do Estoque
        </h3>
      
        <div
          className={`border rounded-xl p-5 mb-4 ${
            stockStatus === "critical"
              ? "bg-red-50 border-red-200"
              : stockStatus === "warning"
              ? "bg-amber-50 border-amber-200"
              : "bg-emerald-50 border-emerald-200"
          }`}
        >
      
          <div className="text-xs uppercase font-bold mb-2">
            {stockTitle}
          </div>
      
          <div className={`text-4xl font-black ${stockColor}`}>
            {stockEfficiency.toFixed(1)}%
          </div>
      
          <div className="mt-3 text-sm text-slate-700">
            {stockDescription}
          </div>
      
        </div>
      
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      
          <div className="border rounded-xl p-4">
      
            <div className="text-xs uppercase text-slate-500 flex items-center gap-2">
              📦 Saldo Atual
            </div>
      
            <div className="text-4xl font-black text-slate-800">
              {totalSaldo.toLocaleString()}
            </div>
      
          </div>
      
          <div className="border rounded-xl p-4">
      
            <div className="text-xs uppercase text-slate-500 flex items-center gap-2">
              🎯 Meta Operacional
            </div>
      
            <div className="text-3xl font-black text-slate-800">
              {stockTarget.toLocaleString()}
            </div>
      
          </div>
      
          <div className="border rounded-xl p-4">
      
            <div className="text-xs uppercase text-slate-500 flex items-center gap-2">
              📈 Diferença
            </div>
      
            <div
              className={`text-4xl font-black ${
                stockStatus === "critical"
                ? "text-red-600"
                : stockStatus === "warning"
                ? "text-amber-500"
                : "text-emerald-600"
              }`}
            >
              {stockDifference > 0 ? "+" : ""}
              {stockDifference.toLocaleString()}
            </div>
      
          </div>
      
        </div>
      
      </section>

      <section className="bg-white border rounded-xl p-5 mt-6">

        <h3 className="text-lg font-bold mb-4">
          2. Pressão de Estoque
        </h3>
      
        <div className="border rounded-xl p-5">
      
          <div className="flex justify-between mb-2">
      
            <span className="text-sm font-medium text-slate-600">
              Meta Operacional
            </span>
      
            <span className={`font-bold ${stockColor}`}>
              {stockEfficiency.toFixed(1)}%
            </span>
      
          </div>
      
          <div className="relative w-full h-6 bg-slate-200 rounded-full overflow-hidden">

          {/* Linha da Meta (100%) */}
            <div
            className="absolute -top-6 text-xs font-bold text-slate-700"
            style={{ left: "50%", transform: "translateX(-50%)" }}
          >
            META
          </div>
        
          <div
            className={`h-full rounded-full shadow-sm ${
              stockStatus === "critical"
                ? "bg-red-500"
                : stockStatus === "warning"
                ? "bg-amber-500"
                : "bg-emerald-500"
            }`}
            style={{
              width: `${stockPressurePercent}%`,
            }}
          />
        
        </div>
      
          <div className="grid grid-cols-3 mt-4 text-center">
      
            <div>
              <div className="font-bold text-emerald-600">
                🟢 Até 100%
              </div>
      
              <div className="text-xs text-slate-500">
                Saudável
              </div>
            </div>
      
            <div>
              <div className="font-bold text-yellow-600">
                🟡 100% a 105%
              </div>
      
              <div className="text-xs text-slate-500">
                Atenção
              </div>
            </div>
      
            <div>
              <div className="font-bold text-red-600">
                🔴 Acima 105%
              </div>
      
              <div className="text-xs text-slate-500">
                Crítico
              </div>
            </div>

          <div
            className={`mt-6 border rounded-xl p-4 ${
              stockStatus === "critical"
                ? "bg-red-50 border-red-200"
                : stockStatus === "warning"
                ? "bg-amber-50 border-amber-200"
                : "bg-emerald-50 border-emerald-200"
            }`}
          >
          
            <div className="font-bold mb-2">
              {stockTitle}
            </div>
          
            <p className="text-sm text-slate-700">
              O estoque opera em
              <strong> {stockEfficiency.toFixed(1)}%</strong>
              da meta operacional,
              representando um excedente de
              <strong> {stockDifference.toLocaleString()} peças</strong>.
            </p>
          
          </div>
            
          </div>
      
        </div>
      
      </section>

      <section className="bg-white border rounded-xl p-5 mt-6">

        <h3 className="text-lg font-bold mb-4">
          3. Evolução do Estoque
        </h3>
      
        <div className="border rounded-xl p-5 bg-amber-50 border-amber-200">
      
          <div className="text-xl font-bold text-amber-700">
            🚧 Em Consolidação
          </div>
      
          <p className="text-sm text-slate-700 mt-3">
            A análise de evolução depende do acúmulo de histórico operacional para identificar tendências de crescimento ou redução do estoque.
          </p>
      
          <p className="text-sm text-slate-700 mt-2">
            Conforme a base histórica for construída, o sistema passará a exibir variação, tendência e projeções automáticas.
          </p>
      
        </div>
      
      </section>
          
        <section className="bg-white border rounded-xl p-5 mt-6">

        <h3 className="text-lg font-bold mb-4">
          4. Risco Operacional
        </h3>
      
        <div
          className={`border rounded-xl p-5 mb-4 ${
            stockStatus === "critical"
              ? "bg-red-50 border-red-200"
              : stockStatus === "warning"
              ? "bg-amber-50 border-amber-200"
              : "bg-emerald-50 border-emerald-200"
          }`}
        >
      
          <div className="font-bold text-lg mb-2">
            {stockTitle}
          </div>
      
          <div className="text-sm text-slate-700">
            {stockDescription}
          </div>
      
        </div>
      
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      
          {riskCards.map((card) => (
      
            <div
              key={card.title}
              className={`border rounded-xl p-5 ${
                stockStatus === "critical"
                  ? "bg-red-50 border-red-200"
                  : stockStatus === "warning"
                  ? "bg-amber-50 border-amber-200"
                  : "bg-emerald-50 border-emerald-200"
              }`}
            >
      
              <div className="text-3xl mb-3">
                {card.icon}
              </div>
      
              <div className="font-bold mb-2">
                {card.title}
              </div>
      
              <div className="text-sm text-slate-600">
                {card.text}
              </div>
      
            </div>
      
          ))}
      
        </div>
      
      </section>

        <section className="bg-white border rounded-xl p-5 mt-6">

        <h3 className="text-lg font-bold mb-4">
          5. Insight Executivo
        </h3>
      
        <div
          className={`border rounded-xl p-5 ${
            stockStatus === "critical"
              ? "bg-red-50 border-red-200"
              : stockStatus === "warning"
              ? "bg-amber-50 border-amber-200"
              : "bg-emerald-50 border-emerald-200"
          }`}
        >
      
          <div
            className={`font-bold text-xl mb-4 ${
              stockStatus === "critical"
                ? "text-red-700"
                : stockStatus === "warning"
                ? "text-amber-700"
                : "text-emerald-700"
            }`}
          >
            {stockTitle}
          </div>
      
          <p className="text-slate-700 leading-relaxed">
            {executiveInsight}
          </p>
      
        </div>
      
      </section>
          
        </div>

      </div>

    </div>
  );
}
