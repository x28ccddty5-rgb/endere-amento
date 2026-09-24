import React, { useEffect, useMemo, useState } from "react";
import { Check, CircleAlert, Plus, Save, Warehouse } from "lucide-react";
import { calcularPaletes } from "../lib/palletUtils";
import { isAdmin } from "../constants/permissions";
import { WarehouseLayoutEntry, WarehouseSlot, Product } from "../types";

interface WarehouseLayoutPanelProps {
  layout: WarehouseLayoutEntry[];
  slots: WarehouseSlot[];
  productsList: Product[];
  currentUser: any;
  loading?: boolean;
  saving?: boolean;
  loadError?: string | null;
  onSave: (entries: WarehouseLayoutEntry[]) => Promise<boolean>;
}

const normalizeModule = (value: string) =>
  value.trim().replace(/^0+/, "") || "0";

export const WarehouseLayoutPanel: React.FC<WarehouseLayoutPanelProps> = ({
  layout,
  slots,
  productsList,
  currentUser,
  loading = false,
  saving = false,
  loadError = null,
  onSave,
}) => {
  const [draft, setDraft] = useState<WarehouseLayoutEntry[]>(layout);
  const [newModule, setNewModule] = useState("");
  const [newCapacity, setNewCapacity] = useState("33");

  const admin = isAdmin(currentUser?.role);

  useEffect(() => {
    setDraft(layout);
  }, [layout]);

  const occupancyByModule = useMemo(() => {
    const productsByReference = new Map<string, Product>(
      productsList.map(product => [product.referencia.toUpperCase(), product])
    );

    const result: Record<string, number> = {};

    for (const slot of slots) {
      if (slot.estoque !== "1" || !slot.referencia || slot.saldo <= 0) {
        continue;
      }

      const product = productsByReference.get(slot.referencia.toUpperCase());
      if (!product?.paletizacao) continue;

      const modulo = String(Number(slot.modulo));
      result[modulo] =
        (result[modulo] || 0) +
        calcularPaletes(slot.saldo, product.paletizacao);
    }

    return result;
  }, [slots, productsList]);

  const updateEntry = (
    id: string,
    patch: Partial<WarehouseLayoutEntry>
  ) => {
    setDraft(current =>
      current.map(entry =>
        entry.id === id ? { ...entry, ...patch } : entry
      )
    );
  };

  const handleAddModule = () => {
    const modulo = normalizeModule(newModule);
    const capacidade = Number(newCapacity);

    if (!/^\d+$/.test(modulo) || Number(modulo) <= 0) {
      alert("Informe uma rua válida maior que zero.");
      return;
    }

    if (!Number.isInteger(capacidade) || capacidade <= 0) {
      alert("Informe uma capacidade inteira maior que zero.");
      return;
    }

    if (draft.some(entry => String(Number(entry.modulo)) === modulo)) {
      alert(`A rua ${modulo} já está cadastrada. Você pode ativá-la novamente.`);
      return;
    }

    setDraft(current => [
      ...current,
      {
        id: `1-${modulo}`,
        estoque: "1",
        modulo,
        capacidade,
        ativo: true,
      },
    ].sort((a, b) => Number(a.modulo) - Number(b.modulo)));

    setNewModule("");
    setNewCapacity("33");
  };

  const handleSave = async () => {
    if (!admin) {
      alert("Somente usuários Administrador podem alterar a configuração física.");
      return;
    }

    const seen = new Set<string>();

    for (const entry of draft) {
      const modulo = String(Number(entry.modulo));
      const capacidade = Number(entry.capacidade);
      const occupied = occupancyByModule[modulo] || 0;

      if (!/^\d+$/.test(modulo) || Number(modulo) <= 0) {
        alert(`A rua ${entry.modulo} é inválida.`);
        return;
      }

      if (seen.has(modulo)) {
        alert(`A rua ${modulo} está cadastrada mais de uma vez.`);
        return;
      }
      seen.add(modulo);

      if (!Number.isInteger(capacidade) || capacidade <= 0) {
        alert(`A capacidade da rua ${modulo} deve ser um número inteiro maior que zero.`);
        return;
      }

      if (!entry.ativo && occupied > 0) {
        alert(
          `A rua ${modulo} não pode ser desativada porque possui aproximadamente ` +
          `${occupied} palete(s) registrado(s).`
        );
        return;
      }

      if (entry.ativo && capacidade < occupied) {
        alert(
          `A capacidade da rua ${modulo} (${capacidade}) não pode ser menor que ` +
          `a ocupação estimada atual (${occupied}).`
        );
        return;
      }
    }

    await onSave(
      draft.map(entry => ({
        ...entry,
        modulo: String(Number(entry.modulo)),
        capacidade: Number(entry.capacidade),
      }))
    );
  };

  const totalCapacity = draft
    .filter(entry => entry.ativo)
    .reduce((total, entry) => total + Number(entry.capacidade || 0), 0);

  const totalOccupied = Object.keys(occupancyByModule).reduce(
    (total, modulo) => total + occupancyByModule[modulo],
    0
  );

  if (!admin) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6">
        <p className="text-sm font-black text-red-700 uppercase">
          Acesso restrito
        </p>
        <p className="mt-1 text-xs font-semibold text-red-600">
          Somente usuários Administrador podem configurar a estrutura física do estoque.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Warehouse className="h-5 w-5 text-blue-600" />
              <h2 className="text-base font-black uppercase tracking-tight text-slate-800">
                Configuração física do Estoque 1
              </h2>
            </div>
            <p className="mt-2 max-w-3xl text-xs font-medium leading-relaxed text-slate-500">
              Ative ou desative ruas e ajuste a capacidade física estimada em paletes.
              As posições antigas permanecem no banco; uma rua desativada apenas deixa
              de participar da operação e dos indicadores.
            </p>
          </div>

          <button
            type="button"
            onClick={handleSave}
            disabled={loading || saving || Boolean(loadError)}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-xs font-black uppercase text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {saving ? "Salvando..." : "Salvar configuração"}
          </button>
        </div>

        {loadError && (
          <div className="mt-4 flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-800">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-black uppercase">Configuração do banco indisponível</p>
              <p className="mt-1">
                {loadError} A tela está usando a configuração padrão atual e não permitirá
                salvar até que a estrutura do Supabase esteja disponível.
              </p>
            </div>
          </div>
        )}

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <span className="text-[10px] font-black uppercase text-slate-400">
              Ruas ativas
            </span>
            <strong className="mt-1 block text-2xl font-black text-slate-800">
              {draft.filter(entry => entry.ativo).length}
            </strong>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <span className="text-[10px] font-black uppercase text-slate-400">
              Capacidade ativa
            </span>
            <strong className="mt-1 block text-2xl font-black text-slate-800">
              {totalCapacity.toLocaleString("pt-BR")} paletes
            </strong>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <span className="text-[10px] font-black uppercase text-slate-400">
              Ocupação estimada
            </span>
            <strong className="mt-1 block text-2xl font-black text-slate-800">
              {totalOccupied.toLocaleString("pt-BR")} paletes
            </strong>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-[10px] font-black uppercase text-slate-500">
                  Estoque
                </th>
                <th className="px-4 py-3 text-[10px] font-black uppercase text-slate-500">
                  Rua
                </th>
                <th className="px-4 py-3 text-[10px] font-black uppercase text-slate-500">
                  Capacidade (paletes)
                </th>
                <th className="px-4 py-3 text-[10px] font-black uppercase text-slate-500">
                  Ocupação estimada
                </th>
                <th className="px-4 py-3 text-[10px] font-black uppercase text-slate-500">
                  Situação
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {draft.map(entry => {
                const occupied = occupancyByModule[String(Number(entry.modulo))] || 0;
                const overCapacity = entry.ativo && occupied > Number(entry.capacidade);

                return (
                  <tr key={entry.id} className={entry.ativo ? "" : "bg-slate-50/80"}>
                    <td className="px-4 py-3 text-xs font-black text-slate-700">
                      E{entry.estoque}
                    </td>
                    <td className="px-4 py-3 font-mono text-sm font-black text-slate-800">
                      R{entry.modulo}
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={entry.capacidade}
                        onChange={event =>
                          updateEntry(entry.id, {
                            capacidade: Number(event.target.value),
                          })
                        }
                        className="w-28 rounded border border-slate-300 bg-white px-2 py-1.5 text-xs font-black text-slate-800 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                      />
                    </td>
                    <td className="px-4 py-3 text-xs font-bold text-slate-600">
                      {occupied.toLocaleString("pt-BR")} paletes
                      {overCapacity && (
                        <span className="ml-2 text-[10px] font-black uppercase text-red-600">
                          acima da capacidade
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => updateEntry(entry.id, { ativo: !entry.ativo })}
                        className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-black uppercase transition ${
                          entry.ativo
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                            : "border-slate-200 bg-slate-100 text-slate-500 hover:bg-slate-200"
                        }`}
                      >
                        <span className={`h-2 w-2 rounded-full ${entry.ativo ? "bg-emerald-500" : "bg-slate-400"}`} />
                        {entry.ativo ? "Ativa" : "Inativa"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
        <div className="flex items-center gap-2">
          <Plus className="h-4 w-4 text-blue-600" />
          <h3 className="text-xs font-black uppercase text-slate-800">
            Adicionar nova rua
          </h3>
        </div>
        <p className="mt-1 text-[11px] font-medium text-slate-500">
          Para aumentar fisicamente o estoque no futuro, cadastre a nova rua aqui.
          Não é necessário alterar o código para que ela apareça no Gêmeo Digital.
        </p>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-[160px_220px_auto]">
          <input
            value={newModule}
            onChange={event => setNewModule(event.target.value)}
            placeholder="Nº da rua"
            inputMode="numeric"
            className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-800 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
          <input
            type="number"
            min={1}
            step={1}
            value={newCapacity}
            onChange={event => setNewCapacity(event.target.value)}
            placeholder="Capacidade"
            className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-800 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
          <button
            type="button"
            onClick={handleAddModule}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-black uppercase text-slate-700 transition hover:bg-slate-50"
          >
            <Plus className="h-4 w-4" />
            Adicionar rua
          </button>
        </div>

        <div className="mt-4 flex items-start gap-2 rounded-lg border border-blue-100 bg-blue-50 p-3 text-[11px] font-semibold leading-relaxed text-blue-800">
          <Check className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Desativar uma rua não apaga os registros físicos existentes no Supabase.
            Isso preserva histórico, divergências e integridade dos endereços.
          </span>
        </div>
      </div>
    </div>
  );
};
