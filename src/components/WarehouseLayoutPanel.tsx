import React, { useEffect, useMemo, useState } from "react";
import { Check, CircleAlert, Plus, Save, Warehouse } from "lucide-react";
import { calcularPaletes } from "../lib/palletUtils";
import { isAdmin } from "../constants/permissions";
import {
  E2_BLOCKED_POSITIONS,
  E3_BLOCKED_POSITIONS,
  E3_EXTRA_POSITIONS,
} from "../constants/layout";
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

const E23_BASE_POSITIONS: Record<"2" | "3", string[]> = {
  "2": ["A1", "B1", "C1", "D1", "E1", "A2", "B2", "C2", "D2", "E2"],
  "3": ["A1", "B1", "C1", "D1", "E1", "F1", "A2", "B2", "C2", "D2", "E2", "F2"],
};

const E23_MODULE_LIMITS = { "2": 172, "3": 112 } as const;

const normalizeModule = (value: string) =>
  value.trim().replace(/^0+/, "") || "0";

const getDefaultE23Layout = (
  estoque: "2" | "3",
  slots: WarehouseSlot[]
): WarehouseLayoutEntry[] => {
  const moduleNumbers = new Set<number>();

  for (let module = 1; module <= E23_MODULE_LIMITS[estoque]; module += 1) {
    moduleNumbers.add(module);
  }

  slots
    .filter(slot => slot.estoque === estoque)
    .forEach(slot => {
      const module = Number(slot.modulo);
      if (Number.isInteger(module) && module > 0) moduleNumbers.add(module);
    });

  return [...moduleNumbers]
    .sort((a, b) => a - b)
    .map(module => {
      const positions = getModulePositions(estoque, String(module), slots);
      return {
        id: `${estoque}-${module}`,
        estoque,
        modulo: String(module),
        capacidade: positions.length,
        ativo: true,
      };
    });
};

const getModulePositions = (
  estoque: "2" | "3",
  modulo: string,
  slots: WarehouseSlot[]
): string[] => {
  const moduleNumber = Number(modulo);
  const blocked =
    estoque === "2"
      ? E2_BLOCKED_POSITIONS[moduleNumber] || []
      : E3_BLOCKED_POSITIONS[moduleNumber] || [];
  const extras =
    estoque === "3" ? E3_EXTRA_POSITIONS[moduleNumber] || [] : [];

  const result = new Set<string>();

  E23_BASE_POSITIONS[estoque]
    .filter(position => !blocked.includes(position))
    .forEach(position => result.add(position));

  extras.forEach(position => result.add(position));

  slots
    .filter(
      slot =>
        slot.estoque === estoque &&
        String(Number(slot.modulo)) === String(moduleNumber) &&
        slot.posicao
    )
    .forEach(slot => result.add(slot.posicao.toUpperCase()));

  return [...result].sort((a, b) => {
    const letterA = a.charCodeAt(0);
    const letterB = b.charCodeAt(0);
    if (letterA !== letterB) return letterA - letterB;
    return Number(a.slice(1)) - Number(b.slice(1));
  });
};

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
  const [selectedEstoque, setSelectedEstoque] = useState<"1" | "2" | "3">("1");
  const [draft, setDraft] = useState<WarehouseLayoutEntry[]>(layout);
  const [newModule, setNewModule] = useState("");
  const [newCapacity, setNewCapacity] = useState("33");
  const [moduleSearch, setModuleSearch] = useState("");

  const admin = isAdmin(currentUser?.role);

  useEffect(() => {
    const normalized = [...layout];

    for (const estoque of ["2", "3"] as const) {
      const existing = normalized.filter(entry => entry.estoque === estoque);
      if (existing.length === 0) {
        normalized.push(...getDefaultE23Layout(estoque, slots));
      } else {
        const existingModules = new Set(existing.map(entry => String(Number(entry.modulo))));
        getDefaultE23Layout(estoque, slots).forEach(entry => {
          if (!existingModules.has(String(Number(entry.modulo)))) {
            normalized.push(entry);
          }
        });
      }
    }

    setDraft(
      normalized.sort(
        (a, b) =>
          Number(a.estoque) - Number(b.estoque) ||
          Number(a.modulo) - Number(b.modulo)
      )
    );
  }, [layout, slots]);

  const occupancyByModule = useMemo(() => {
    const productsByReference = new Map<string, Product>(
      productsList.map(product => [product.referencia.toUpperCase(), product])
    );

    const result: Record<string, number> = {};

    for (const slot of slots) {
      if (slot.estoque !== "1" || !slot.referencia || slot.saldo <= 0) continue;

      const product = productsByReference.get(slot.referencia.toUpperCase());
      if (!product?.paletizacao) continue;

      const modulo = String(Number(slot.modulo));
      result[modulo] =
        (result[modulo] || 0) +
        calcularPaletes(slot.saldo, product.paletizacao);
    }

    return result;
  }, [slots, productsList]);

  const positionsByModule = useMemo(() => {
    const result: Record<string, string[]> = {};

    for (const estoque of ["2", "3"] as const) {
      draft
        .filter(entry => entry.estoque === estoque)
        .forEach(entry => {
          result[`${estoque}-${entry.modulo}`] = getModulePositions(
            estoque,
            entry.modulo,
            slots
          );
        });
    }

    return result;
  }, [draft, slots]);

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
      alert("Informe uma rua/módulo válido maior que zero.");
      return;
    }

    if (!Number.isInteger(capacidade) || capacidade <= 0) {
      alert("Informe uma capacidade inteira maior que zero.");
      return;
    }

    if (
      draft.some(
        entry =>
          entry.estoque === selectedEstoque &&
          String(Number(entry.modulo)) === modulo
      )
    ) {
      alert(`O módulo ${modulo} já está cadastrado no Estoque ${selectedEstoque}.`);
      return;
    }

    setDraft(current => [
      ...current,
      {
        id: `${selectedEstoque}-${modulo}`,
        estoque: selectedEstoque,
        modulo,
        capacidade,
        ativo: true,
      },
    ].sort(
      (a, b) =>
        Number(a.estoque) - Number(b.estoque) ||
        Number(a.modulo) - Number(b.modulo)
    ));

    setNewModule("");
    setNewCapacity(selectedEstoque === "1" ? "33" : "10");
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
      const key = `${entry.estoque}-${modulo}`;

      if (!/^\d+$/.test(modulo) || Number(modulo) <= 0) {
        alert(`O módulo ${entry.modulo} é inválido.`);
        return;
      }

      if (seen.has(key)) {
        alert(`O módulo ${modulo} está cadastrado mais de uma vez no Estoque ${entry.estoque}.`);
        return;
      }
      seen.add(key);

      if (!Number.isInteger(capacidade) || capacidade <= 0) {
        alert(`A capacidade do módulo ${modulo} deve ser um número inteiro maior que zero.`);
        return;
      }

      if (entry.estoque === "1") {
        const occupied = occupancyByModule[modulo] || 0;
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

      if (entry.estoque !== "1") {
        const positionCount =
          positionsByModule[`${entry.estoque}-${entry.modulo}`]?.length || 0;

        if (entry.ativo && capacidade < positionCount) {
          alert(
            `O módulo ${entry.modulo} do Estoque ${entry.estoque} possui ` +
            `${positionCount} posições cadastradas no layout. A capacidade não pode ser menor que esse total.`
          );
          return;
        }
      }
    }

    await onSave(
      draft.map(entry => ({
        ...entry,
        estoque: String(entry.estoque).replace(/^E/i, ""),
        modulo: String(Number(entry.modulo)),
        capacidade: Number(entry.capacidade),
      }))
    );
  };

  const selectedEntries = useMemo(
    () =>
      draft
        .filter(entry => entry.estoque === selectedEstoque)
        .filter(entry =>
          !moduleSearch.trim() ||
          entry.modulo.includes(moduleSearch.replace(/\D/g, ""))
        )
        .sort((a, b) => Number(a.modulo) - Number(b.modulo)),
    [draft, selectedEstoque, moduleSearch]
  );

  const totalCapacity = selectedEntries
    .filter(entry => entry.ativo)
    .reduce((total, entry) => total + Number(entry.capacidade || 0), 0);

  const totalOccupied = Object.keys(occupancyByModule)
    .filter(key => selectedEstoque === "1" || key)
    .reduce((total, modulo) => {
      return selectedEstoque === "1"
        ? total + (occupancyByModule[modulo] || 0)
        : total;
    }, 0);

  if (!admin) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6">
        <p className="text-sm font-black text-red-700 uppercase">Acesso restrito</p>
        <p className="mt-1 text-xs font-semibold text-red-600">
          Somente usuários Administrador podem configurar a estrutura física do estoque.
        </p>
      </div>
    );
  }

  const isE1 = selectedEstoque === "1";

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Warehouse className="h-5 w-5 text-blue-600" />
              <h2 className="text-base font-black uppercase tracking-tight text-slate-800">
                Configuração física dos Estoques
              </h2>
            </div>
            <p className="mt-2 max-w-4xl text-xs font-medium leading-relaxed text-slate-500">
              O Estoque 1 mantém a configuração de capacidade em paletes. Nos Estoques 2 e 3,
              os módulos são configurados sem criar posições silenciosamente: a tela mostra a
              estrutura padrão, posições extras previstas no código e posições já cadastradas
              no Supabase.
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
                {loadError} A tela não permitirá salvar até que a estrutura do Supabase esteja disponível.
              </p>
            </div>
          </div>
        )}

        <div className="mt-5 flex flex-wrap gap-2">
          {(["1", "2", "3"] as const).map(estoque => (
            <button
              key={estoque}
              type="button"
              onClick={() => {
                setSelectedEstoque(estoque);
                setModuleSearch("");
              }}
              className={`rounded-lg border px-4 py-2 text-xs font-black uppercase transition ${
                selectedEstoque === estoque
                  ? "border-blue-600 bg-blue-600 text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              Estoque {estoque}
            </button>
          ))}
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <span className="text-[10px] font-black uppercase text-slate-400">
              {isE1 ? "Ruas ativas" : "Módulos ativos"}
            </span>
            <strong className="mt-1 block text-2xl font-black text-slate-800">
              {selectedEntries.filter(entry => entry.ativo).length}
            </strong>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <span className="text-[10px] font-black uppercase text-slate-400">
              {isE1 ? "Capacidade ativa" : "Posições configuradas"}
            </span>
            <strong className="mt-1 block text-2xl font-black text-slate-800">
              {totalCapacity.toLocaleString("pt-BR")}
              {isE1 ? " paletes" : ""}
            </strong>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <span className="text-[10px] font-black uppercase text-slate-400">
              {isE1 ? "Ocupação estimada" : "Módulos exibidos"}
            </span>
            <strong className="mt-1 block text-2xl font-black text-slate-800">
              {isE1 ? `${totalOccupied.toLocaleString("pt-BR")} paletes` : selectedEntries.length}
            </strong>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
        <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-xs font-black uppercase text-slate-800">
              {isE1 ? "Ruas do Estoque 1" : `Módulos do Estoque ${selectedEstoque}`}
            </h3>
            <p className="mt-1 text-[10px] font-medium text-slate-500">
              {isE1
                ? "Capacidade física estimada em paletes."
                : "As posições são derivadas do layout padrão, exceções do código e registros físicos existentes."}
            </p>
          </div>
          <input
            value={moduleSearch}
            onChange={event => setModuleSearch(event.target.value.replace(/\D/g, ""))}
            placeholder="Filtrar módulo"
            inputMode="numeric"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-800 outline-none focus:border-blue-500 sm:w-44"
          />
        </div>

        <div className="max-h-[min(62vh,560px)] overflow-auto">
          <table className="w-full min-w-[900px] text-left">
            <thead className="border-b border-slate-200 bg-white">
              <tr>
                <th className="px-4 py-3 text-[10px] font-black uppercase text-slate-500">Estoque</th>
                <th className="px-4 py-3 text-[10px] font-black uppercase text-slate-500">
                  {isE1 ? "Rua" : "Módulo"}
                </th>
                <th className="px-4 py-3 text-[10px] font-black uppercase text-slate-500">
                  {isE1 ? "Capacidade (paletes)" : "Posições"}
                </th>
                <th className="px-4 py-3 text-[10px] font-black uppercase text-slate-500">
                  Capacidade configurada
                </th>
                <th className="px-4 py-3 text-[10px] font-black uppercase text-slate-500">Situação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {selectedEntries.map(entry => {
                const positions =
                  !isE1
                    ? positionsByModule[`${entry.estoque}-${entry.modulo}`] || []
                    : [];
                const blockedPositions =
                  !isE1
                    ? entry.estoque === "2"
                      ? E2_BLOCKED_POSITIONS[Number(entry.modulo)] || []
                      : E3_BLOCKED_POSITIONS[Number(entry.modulo)] || []
                    : [];
                const extraPositions =
                  !isE1 && entry.estoque === "3"
                    ? E3_EXTRA_POSITIONS[Number(entry.modulo)] || []
                    : [];
                const positionCount = positions.length;
                const positionMismatch =
                  !isE1 && Number(entry.capacidade) !== positionCount;

                return (
                  <tr key={entry.id} className={entry.ativo ? "" : "bg-slate-50/80"}>
                    <td className="px-4 py-3 text-xs font-black text-slate-700">E{entry.estoque}</td>
                    <td className="px-4 py-3 font-mono text-sm font-black text-slate-800">
                      {isE1 ? `R${entry.modulo}` : `M${entry.modulo}`}
                    </td>
                    <td className="px-4 py-3">
                      {isE1 ? (
                        <span className="text-xs font-bold text-slate-500">—</span>
                      ) : (
                        <div className="flex max-w-[430px] flex-wrap gap-1">
                          {positions.map(position => (
                            <span
                              key={position}
                              className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-black ${
                                extraPositions.includes(position)
                                  ? "border-blue-200 bg-blue-50 text-blue-700"
                                  : "border-slate-200 bg-slate-50 text-slate-600"
                              }`}
                            >
                              {position}
                              {extraPositions.includes(position) ? " • extra" : ""}
                            </span>
                          ))}
                          {blockedPositions.map(position => (
                            <span
                              key={`blocked-${position}`}
                              className="rounded border border-red-200 bg-red-50 px-1.5 py-0.5 font-mono text-[10px] font-black text-red-600 line-through"
                            >
                              {position} • bloqueada
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="number"
                        min={isE1 ? 1 : positionCount || 1}
                        step={1}
                        value={entry.capacidade}
                        onChange={event =>
                          updateEntry(entry.id, {
                            capacidade: Number(event.target.value),
                          })
                        }
                        className="w-28 rounded border border-slate-300 bg-white px-2 py-1.5 text-xs font-black text-slate-800 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                      />
                      {!isE1 && positionMismatch && (
                        <span className="ml-2 text-[9px] font-black uppercase text-amber-700">
                          {positionCount} detectadas
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
                        {entry.ativo ? "Ativo" : "Inativo"}
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
          <h3 className="text-xs font-black uppercase text-slate-800">Adicionar novo módulo/rua</h3>
        </div>
        <p className="mt-1 text-[11px] font-medium text-slate-500">
          A nova entrada é criada somente na configuração física. Para E2/E3, as posições exibidas
          continuam sendo derivadas da estrutura conhecida e dos registros existentes.
        </p>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-[160px_220px_auto]">
          <input
            value={newModule}
            onChange={event => setNewModule(event.target.value)}
            placeholder={isE1 ? "Nº da rua" : "Nº do módulo"}
            inputMode="numeric"
            className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-800 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
          <input
            type="number"
            min={1}
            step={1}
            value={newCapacity}
            onChange={event => setNewCapacity(event.target.value)}
            placeholder={isE1 ? "Capacidade" : "Qtd. posições"}
            className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-800 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
          <button
            type="button"
            onClick={handleAddModule}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-black uppercase text-slate-700 transition hover:bg-slate-50"
          >
            <Plus className="h-4 w-4" />
            Adicionar
          </button>
        </div>

        <div className="mt-4 flex items-start gap-2 rounded-lg border border-blue-100 bg-blue-50 p-3 text-[11px] font-semibold leading-relaxed text-blue-800">
          <Check className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Nenhuma posição física do E2/E3 é criada automaticamente pela configuração. O layout
            apenas centraliza a visão dos módulos, posições e estado ativo/inativo.
          </span>
        </div>
      </div>
    </div>
  );
};
