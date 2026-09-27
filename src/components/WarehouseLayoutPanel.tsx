import React, { useEffect, useMemo, useState } from "react";
import { Check, CircleAlert, Plus, Save, Trash2, Warehouse } from "lucide-react";
import { calcularPaletes } from "../lib/palletUtils";
import { isAdmin } from "../constants/permissions";
import { WarehouseLayoutEntry, WarehousePositionConfig, WarehouseSlot, Product } from "../types";
import { normalizeWarehouseLayoutEntries } from "../lib/warehouseLayout";

interface WarehouseLayoutPanelProps {
  layout: WarehouseLayoutEntry[];
  slots: WarehouseSlot[];
  positions: WarehousePositionConfig[];
  productsList: Product[];
  currentUser: any;
  loading?: boolean;
  saving?: boolean;
  loadError?: string | null;
  onSave: (entries: WarehouseLayoutEntry[]) => Promise<boolean>;
  onSavePositions: (entries: WarehousePositionConfig[]) => Promise<boolean>;
  onDeletePosition: (estoque: string, modulo: string, posicao: string) => Promise<boolean>;
  onDeleteModule: (estoque: string, modulo: string) => Promise<boolean>;
}

const normalizeModule = (value: string) =>
  value.trim();

const isCanonicalModule = (value: string) =>
  /^[1-9][0-9]*$/.test(value.trim());

const normalizePosition = (value: string) =>
  value.trim().toUpperCase();

const positionSort = (a: string, b: string) => {
  const letterA = a.charCodeAt(0);
  const letterB = b.charCodeAt(0);
  if (letterA !== letterB) return letterA - letterB;
  return Number(a.slice(1)) - Number(b.slice(1));
};

export const WarehouseLayoutPanel: React.FC<WarehouseLayoutPanelProps> = ({
  layout,
  slots,
  positions,
  productsList,
  currentUser,
  loading = false,
  saving = false,
  loadError = null,
  onSave,
  onSavePositions,
  onDeletePosition,
  onDeleteModule,
}) => {
  const [selectedEstoque, setSelectedEstoque] = useState<"1" | "2" | "3">("1");
  const [draft, setDraft] = useState<WarehouseLayoutEntry[]>(layout);
  const [positionDraft, setPositionDraft] = useState<WarehousePositionConfig[]>(positions);
  const [newModule, setNewModule] = useState("");
  const [newCapacity, setNewCapacity] = useState("33");
  const [moduleSearch, setModuleSearch] = useState("");
  const [newPositionByModule, setNewPositionByModule] = useState<Record<string, string>>({});

  const admin = isAdmin(currentUser?.role);

  useEffect(() => {
    setDraft(normalizeWarehouseLayoutEntries(layout));
  }, [layout]);

  useEffect(() => {
    setPositionDraft([...positions]);
  }, [positions]);

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
    const result: Record<string, WarehousePositionConfig[]> = {};

    positionDraft
      .filter(position => position.estoque === "2" || position.estoque === "3")
      .forEach(position => {
        const key = `${position.estoque}-${position.modulo}`;
        if (!result[key]) result[key] = [];
        result[key].push(position);
      });

    Object.values(result).forEach(list =>
      list.sort((a, b) => positionSort(a.posicao, b.posicao))
    );

    return result;
  }, [positionDraft]);

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

    if (!isCanonicalModule(modulo)) {
      alert("Informe o módulo sem zeros à esquerda. Exemplos válidos: 1, 2, 10, 172.");
      return;
    }

    if (
      draft.some(
        entry =>
          entry.estoque === selectedEstoque &&
          String(entry.modulo) === modulo
      )
    ) {
      alert(`O módulo ${modulo} já está cadastrado no Estoque ${selectedEstoque}.`);
      return;
    }

    const capacidadeInicial =
      selectedEstoque === "1"
        ? Number(newCapacity)
        : selectedEstoque === "2"
          ? 10
          : 12;

    if (selectedEstoque === "1" && (!Number.isInteger(capacidadeInicial) || capacidadeInicial <= 0)) {
      alert("Informe uma capacidade inteira maior que zero.");
      return;
    }

    setDraft(current =>
      [
        ...current,
        {
          id: `${selectedEstoque}-${modulo}`,
          estoque: selectedEstoque,
          modulo,
          capacidade: capacidadeInicial,
          ativo: true,
        },
      ].sort(
        (a, b) =>
          Number(a.estoque) - Number(b.estoque) ||
          Number(a.modulo) - Number(b.modulo)
      )
    );

    if (selectedEstoque === "2" || selectedEstoque === "3") {
      const defaultPositions =
        selectedEstoque === "2"
          ? ["A1", "A2", "B1", "B2", "C1", "C2", "D1", "D2", "E1", "E2"]
          : ["A1", "A2", "B1", "B2", "C1", "C2", "D1", "D2", "E1", "E2", "F1", "F2"];

      setPositionDraft(current =>
        [
          ...current,
          ...defaultPositions.map(posicao => ({
            id: `${selectedEstoque}-${modulo}-${posicao}`,
            estoque: selectedEstoque,
            modulo,
            posicao,
            ativo: true,
          })),
        ]
          .filter(
            (position, index, list) =>
              list.findIndex(item => item.id === position.id) === index
          )
          .sort(
            (a, b) =>
              Number(a.estoque) - Number(b.estoque) ||
              Number(a.modulo) - Number(b.modulo) ||
              positionSort(a.posicao, b.posicao)
          )
      );
    }

    setNewModule("");
    setNewCapacity("33");
  };

  const hasOccupancy = (estoque: string, modulo: string, posicao?: string) => {
    const normalizedEstoque = String(estoque).replace(/^E/i, "");
    const normalizedModulo = String(Number(modulo));

    return slots.some(slot =>
      String(slot.estoque).replace(/^E/i, "") === normalizedEstoque &&
      String(Number(slot.modulo)) === normalizedModulo &&
      (!posicao ||
        String(slot.posicao || "").trim().toUpperCase() === posicao.trim().toUpperCase()) &&
      Number(slot.saldo || 0) > 0
    );
  };

  const togglePosition = (id: string) => {
    const position = positionDraft.find(item => item.id === id);
    if (!position) return;

    if (position.ativo && hasOccupancy(position.estoque, position.modulo, position.posicao)) {
      alert(
        `A posição ${position.posicao} do módulo ${position.modulo} possui estoque registrado. ` +
        "Transfira o estoque antes de desativá-la."
      );
      return;
    }

    setPositionDraft(current =>
      current.map(item =>
        item.id === id ? { ...item, ativo: !item.ativo } : item
      )
    );
  };

  const handleAddPosition = (estoque: "2" | "3", modulo: string) => {
    const key = `${estoque}-${modulo}`;
    const posicao = normalizePosition(newPositionByModule[key] || "");

    if (!/^[A-Z]+[1-9][0-9]*$/.test(posicao)) {
      alert("Informe uma posição válida, por exemplo A1, B2 ou G1.");
      return;
    }

    if (positionDraft.some(
      position =>
        position.estoque === estoque &&
        String(Number(position.modulo)) === String(Number(modulo)) &&
        position.posicao === posicao
    )) {
      alert(`A posição ${posicao} já está cadastrada no módulo ${modulo}.`);
      return;
    }

    const next = [
      ...positionDraft,
      {
        id: `${estoque}-${Number(modulo)}-${posicao}`,
        estoque,
        modulo: String(Number(modulo)),
        posicao,
        ativo: true,
      },
    ].sort(
      (a, b) =>
        Number(a.estoque) - Number(b.estoque) ||
        Number(a.modulo) - Number(b.modulo) ||
        positionSort(a.posicao, b.posicao)
    );

    setNewPositionByModule(current => ({ ...current, [key]: "" }));
    setPositionDraft(next);
  };

  const handleSave = async () => {
    if (!admin) {
      alert("Somente usuários Administrador podem alterar a configuração física.");
      return;
    }

    const seen = new Set<string>();

    for (const entry of draft) {
      const modulo = String(entry.modulo).trim();
      const key = `${entry.estoque}-${modulo}`;

      if (!isCanonicalModule(modulo)) {
        alert(`O módulo ${entry.modulo} é inválido. Use somente números sem zeros à esquerda.`);
        return;
      }

      if (seen.has(key)) {
        alert(`O módulo ${modulo} está cadastrado mais de uma vez no Estoque ${entry.estoque}.`);
        return;
      }
      seen.add(key);

      if (entry.estoque === "1") {
        const capacidade = Number(entry.capacidade);

        // O Estoque 1 trabalha com capacidade média/estimada por rua.
        // A ocupação real pode ficar acima ou abaixo desse valor e isso
        // não deve impedir a configuração. Mantemos apenas a validação
        // estrutural de que a capacidade informada é um inteiro positivo.
        if (!Number.isInteger(capacidade) || capacidade <= 0) {
          alert(`A capacidade da rua ${modulo} deve ser um número inteiro maior que zero.`);
          return;
        }
      } else {
        const modulePositions =
          positionsByModule[`${entry.estoque}-${modulo}`] || [];
        const activePositionCount = modulePositions.filter(position => position.ativo).length;

        if (entry.ativo && activePositionCount === 0) {
          alert(
            `O módulo ${modulo} do Estoque ${entry.estoque} precisa ter pelo menos uma posição ativa.`
          );
          return;
        }

        if (!entry.ativo && hasOccupancy(entry.estoque, modulo)) {
          alert(
            `O módulo ${modulo} do Estoque ${entry.estoque} não pode ser desativado ` +
            "porque possui estoque registrado. Transfira o estoque antes."
          );
          return;
        }
      }
    }

    const layoutSaved = await onSave(
      draft.map(entry => {
        const normalizedEstoque = String(entry.estoque).replace(/^E/i, "");
        const normalizedModulo = String(entry.modulo).trim();
        const activePositionCount =
          normalizedEstoque === "1"
            ? Number(entry.capacidade)
            : (positionsByModule[`${normalizedEstoque}-${normalizedModulo}`] || [])
                .filter(position => position.ativo).length;

        return {
          ...entry,
          estoque: normalizedEstoque,
          modulo: normalizedModulo,
          capacidade: activePositionCount,
        };
      })
    );

    if (!layoutSaved) return;

    const positionsSaved = await onSavePositions(
      positionDraft.map(position => ({
        ...position,
        estoque: String(position.estoque).replace(/^E/i, ""),
        modulo: String(position.modulo).trim(),
        posicao: position.posicao.trim().toUpperCase(),
      }))
    );

    if (!positionsSaved) return;

    alert("Configuração física dos estoques salva com sucesso.");
  };

  const handleDeletePosition = async (
    position: WarehousePositionConfig
  ) => {
    if (!admin) return;

    if (hasOccupancy(position.estoque, position.modulo, position.posicao)) {
      alert(
        `A posição ${position.posicao} do módulo ${position.modulo} possui estoque registrado. ` +
        "Transfira o estoque antes de excluí-la."
      );
      return;
    }

    const confirmed = window.confirm(
      `Excluir a posição ${position.posicao} do módulo ${position.modulo} do Estoque ${position.estoque}?`
    );
    if (!confirmed) return;

    const deleted = await onDeletePosition(
      position.estoque,
      position.modulo,
      position.posicao
    );

    if (!deleted) return;

    setPositionDraft(current => current.filter(item => item.id !== position.id));
  };

  const handleDeleteModule = async (entry: WarehouseLayoutEntry) => {
    if (!admin) return;

    if (hasOccupancy(entry.estoque, entry.modulo)) {
      alert(
        `O módulo ${entry.modulo} do Estoque ${entry.estoque} possui estoque registrado. ` +
        "Transfira o estoque antes de excluí-lo."
      );
      return;
    }

    const confirmed = window.confirm(
      `Excluir o módulo ${entry.modulo} e todas as suas posições do Estoque ${entry.estoque}?`
    );
    if (!confirmed) return;

    const deleted = await onDeleteModule(entry.estoque, entry.modulo);

    if (!deleted) return;

    const normalizedModulo = String(Number(entry.modulo));
    setDraft(current =>
      current.filter(
        item =>
          !(
            item.estoque === entry.estoque &&
            String(Number(item.modulo)) === normalizedModulo
          )
      )
    );
    setPositionDraft(current =>
      current.filter(
        item =>
          !(
            item.estoque === entry.estoque &&
            String(Number(item.modulo)) === normalizedModulo
          )
      )
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

  const totalConfigured = isE1
    ? selectedEntries
        .filter(entry => entry.ativo)
        .reduce((total, entry) => total + Number(entry.capacidade || 0), 0)
    : selectedEntries.reduce(
        (total, entry) =>
          total +
          ((positionsByModule[`${entry.estoque}-${entry.modulo}`] || [])
            .filter(position => position.ativo).length),
        0
      );

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-4 md:p-6 shadow-xs">
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
              módulos e posições físicas vêm da configuração oficial do Supabase. Você pode
              ativar/desativar posições e adicionar novas posições sem alterar o código.
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

        <div className="mt-4 grid grid-cols-3 gap-2 sm:gap-3">
          <div className="min-w-0 rounded-lg border border-slate-200 bg-slate-50 p-2 sm:p-4">
            <span className="block truncate text-[8px] font-black uppercase leading-tight text-slate-400 sm:text-[10px]">
              {isE1 ? "Ruas ativas" : "Módulos ativos"}
            </span>
            <strong className="mt-1 block truncate text-base font-black text-slate-800 sm:text-2xl">
              {selectedEntries.filter(entry => entry.ativo).length}
            </strong>
          </div>
          <div className="min-w-0 rounded-lg border border-slate-200 bg-slate-50 p-2 sm:p-4">
            <span className="block truncate text-[8px] font-black uppercase leading-tight text-slate-400 sm:text-[10px]">
              {isE1 ? "Capacidade ativa" : "Posições configuradas"}
            </span>
            <strong className="mt-1 block truncate text-base font-black text-slate-800 sm:text-2xl">
              {totalConfigured.toLocaleString("pt-BR")}
              {isE1 ? <span className="ml-0.5 text-[9px] font-bold sm:text-sm">pal.</span> : ""}
            </strong>
          </div>
          <div className="min-w-0 rounded-lg border border-slate-200 bg-slate-50 p-2 sm:p-4">
            <span className="block truncate text-[8px] font-black uppercase leading-tight text-slate-400 sm:text-[10px]">
              {isE1 ? "Ocupação estimada" : "Módulos exibidos"}
            </span>
            <strong className="mt-1 block truncate text-base font-black text-slate-800 sm:text-2xl">
              {isE1 ? (
                <>
                  {totalOccupied.toLocaleString("pt-BR")}
                  <span className="ml-0.5 text-[9px] font-bold sm:text-sm">pal.</span>
                </>
              ) : (
                selectedEntries.length
              )}
            </strong>
          </div>
        </div>
      </div>

      {/* Add module/road first on mobile and desktop. */}
      <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-xs sm:p-5">
        <div className="flex items-center gap-2">
          <Plus className="h-4 w-4 shrink-0 text-blue-600" />
          <h3 className="text-xs font-black uppercase text-slate-800">Adicionar novo módulo/rua</h3>
        </div>
        <p className="mt-1 hidden text-[11px] font-medium text-slate-500 sm:block">
          Para E2/E3, um novo módulo já recebe automaticamente 10 posições no Estoque 2
          ou 12 posições no Estoque 3. Depois você pode ativar, desativar, excluir ou adicionar
          posições conforme a estrutura física real.
        </p>

        <div className={`mt-3 grid gap-2 ${
          isE1 ? "grid-cols-2 sm:grid-cols-[160px_220px_auto]" : "grid-cols-[1fr_auto] sm:grid-cols-[220px_auto]"
        }`}>
          <input
            value={newModule}
            onChange={event => setNewModule(event.target.value.replace(/[^0-9]/g, ""))}
            placeholder={isE1 ? "Nº da rua" : "Nº do módulo"}
            inputMode="numeric"
            className="min-w-0 rounded-lg border border-slate-300 px-3 py-2 text-base font-bold text-slate-800 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 sm:text-xs"
          />
          {isE1 && (
            <input
              type="number"
              min={1}
              step={1}
              value={newCapacity}
              onChange={event => setNewCapacity(event.target.value)}
              placeholder="Capacidade"
              className="min-w-0 rounded-lg border border-slate-300 px-3 py-2 text-base font-bold text-slate-800 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 sm:text-xs"
            />
          )}
          <button
            type="button"
            onClick={handleAddModule}
            className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-[10px] font-black uppercase text-slate-700 transition hover:bg-slate-50 ${
              isE1 ? "col-span-2 sm:col-span-1" : ""
            }`}
          >
            <Plus className="h-4 w-4" />
            Adicionar
          </button>
        </div>

        <div className="mt-3 hidden items-start gap-2 rounded-lg border border-blue-100 bg-blue-50 p-3 text-[11px] font-semibold leading-relaxed text-blue-800 sm:flex">
          <Check className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            As posições de E2/E3 são mantidas separadamente dos módulos. Clique em uma posição
            para ativar/desativar ou use "+ posição" para cadastrar uma nova.
          </span>
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
                : "As posições abaixo são a configuração física oficial deste módulo."}
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

        <div className="hidden md:block max-h-[min(62vh,560px)] overflow-auto">
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

                <th className="px-4 py-3 text-[10px] font-black uppercase text-slate-500">Situação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {selectedEntries.map(entry => {
                const modulePositions =
                  !isE1
                    ? positionsByModule[`${entry.estoque}-${entry.modulo}`] || []
                    : [];
                return (
                  <tr key={entry.id} className={entry.ativo ? "" : "bg-slate-50/80"}>
                    <td className="px-4 py-3 text-xs font-black text-slate-700">E{entry.estoque}</td>
                    <td className="px-4 py-3 font-mono text-sm font-black text-slate-800">
                      {isE1 ? `R${entry.modulo}` : `M${entry.modulo}`}
                    </td>
                    <td className="px-4 py-3">
                      {isE1 ? (
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
                      ) : (
                        <div className="space-y-2">
                          <div className="flex max-w-[560px] flex-wrap gap-1">
                            {modulePositions.map(position => (
                              <div key={position.id} className="inline-flex items-center gap-0.5">
                                <button
                                  type="button"
                                  onClick={() => togglePosition(position.id)}
                                  title={position.ativo ? "Desativar posição" : "Ativar posição"}
                                  className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-black transition ${
                                    position.ativo
                                      ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                                      : "border-slate-200 bg-slate-100 text-slate-400 line-through hover:bg-slate-200"
                                  }`}
                                >
                                  {position.posicao}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeletePosition(position)}
                                  title="Excluir posição"
                                  className="rounded border border-red-100 bg-white p-0.5 text-red-500 hover:bg-red-50"
                                >
                                  <Trash2 className="h-2.5 w-2.5" />
                                </button>
                              </div>
                            ))}
                          </div>
                          <div className="flex items-center gap-2">
                            <input
                              value={newPositionByModule[`${entry.estoque}-${entry.modulo}`] || ""}
                              onChange={event =>
                                setNewPositionByModule(current => ({
                                  ...current,
                                  [`${entry.estoque}-${entry.modulo}`]: event.target.value.toUpperCase(),
                                }))
                              }
                              placeholder="Nova posição"
                              className="w-28 rounded border border-slate-300 bg-white px-2 py-1 text-[10px] font-black uppercase text-slate-800 outline-none focus:border-blue-500"
                            />
                            <button
                              type="button"
                              onClick={() => handleAddPosition(entry.estoque as "2" | "3", entry.modulo)}
                              className="rounded border border-slate-300 bg-white px-2 py-1 text-[10px] font-black uppercase text-slate-600 hover:bg-slate-50"
                            >
                              + posição
                            </button>
                          </div>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            if (
                              entry.ativo &&
                              entry.estoque !== "1" &&
                              hasOccupancy(entry.estoque, entry.modulo)
                            ) {
                              alert(
                                `O módulo ${entry.modulo} do Estoque ${entry.estoque} possui estoque registrado. ` +
                                "Transfira o estoque antes de desativá-lo."
                              );
                              return;
                            }
                            updateEntry(entry.id, { ativo: !entry.ativo });
                          }}
                          className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-black uppercase transition ${
                            entry.ativo
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                              : "border-slate-200 bg-slate-100 text-slate-500 hover:bg-slate-200"
                          }`}
                        >
                          <span className={`h-2 w-2 rounded-full ${entry.ativo ? "bg-emerald-500" : "bg-slate-400"}`} />
                          {entry.ativo ? "Ativo" : "Inativo"}
                        </button>
                        {entry.estoque !== "1" && (
                          <button
                            type="button"
                            onClick={() => handleDeleteModule(entry)}
                            title="Excluir módulo"
                            className="inline-flex items-center gap-1 rounded border border-red-100 bg-white px-2 py-1.5 text-[10px] font-black uppercase text-red-600 hover:bg-red-50"
                          >
                            <Trash2 className="h-3 w-3" />
                            Excluir
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="md:hidden max-h-[58vh] overflow-y-auto p-3 space-y-3">
          {selectedEntries.map(entry => {
            const modulePositions =
              !isE1
                ? positionsByModule[`${entry.estoque}-${entry.modulo}`] || []
                : [];
            const activePositionCount = modulePositions.filter(position => position.ativo).length;

            return (
              <article
                key={entry.id}
                className={`rounded-xl border p-3 ${
                  entry.ativo
                    ? "border-slate-200 bg-white"
                    : "border-slate-200 bg-slate-50"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-[9px] font-black uppercase text-slate-400">
                      {isE1 ? "Rua" : `Estoque ${entry.estoque}`}
                    </div>
                    <div className="mt-0.5 font-mono text-lg font-black text-slate-800">
                      {isE1 ? `R${entry.modulo}` : `M${entry.modulo}`}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (
                          entry.ativo &&
                          entry.estoque !== "1" &&
                          hasOccupancy(entry.estoque, entry.modulo)
                        ) {
                          alert(
                            `O módulo ${entry.modulo} do Estoque ${entry.estoque} possui estoque registrado. ` +
                            "Transfira o estoque antes de desativá-lo."
                          );
                          return;
                        }
                        updateEntry(entry.id, { ativo: !entry.ativo });
                      }}
                      className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-[9px] font-black uppercase ${
                        entry.ativo
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-slate-200 bg-slate-100 text-slate-500"
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${entry.ativo ? "bg-emerald-500" : "bg-slate-400"}`} />
                      {entry.ativo ? "Ativo" : "Inativo"}
                    </button>

                    {entry.estoque !== "1" && (
                      <button
                        type="button"
                        onClick={() => handleDeleteModule(entry)}
                        className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-red-100 bg-red-50 px-2.5 text-[9px] font-black uppercase text-red-600"
                        title="Excluir módulo"
                      >
                        <Trash2 className="h-3 w-3" />
                        Excluir
                      </button>
                    )}
                  </div>
                </div>

                {isE1 ? (
                  <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="text-[9px] font-black uppercase text-slate-400">
                      Capacidade configurada
                    </div>
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
                      className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-black text-slate-800 outline-none focus:border-blue-500"
                    />
                  </div>
                ) : (
                  <>
                    <div className="mt-3 flex items-center justify-between">
                      <span className="text-[9px] font-black uppercase text-slate-400">
                        Posições
                      </span>
                      <span className="text-[10px] font-black text-slate-500">
                        {activePositionCount} ativas
                      </span>
                    </div>

                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {modulePositions.map(position => (
                        <div key={position.id} className="inline-flex items-center gap-0.5">
                          <button
                            type="button"
                            onClick={() => togglePosition(position.id)}
                            title={position.ativo ? "Desativar posição" : "Ativar posição"}
                            className={`min-h-8 rounded-md border px-2 font-mono text-[10px] font-black ${
                              position.ativo
                                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                : "border-slate-200 bg-slate-100 text-slate-400 line-through"
                            }`}
                          >
                            {position.posicao}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeletePosition(position)}
                            title="Excluir posição"
                            className="flex h-8 w-6 items-center justify-center rounded-md border border-red-100 bg-white text-red-500"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>

                    <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
                      <input
                        value={newPositionByModule[`${entry.estoque}-${entry.modulo}`] || ""}
                        onChange={event =>
                          setNewPositionByModule(current => ({
                            ...current,
                            [`${entry.estoque}-${entry.modulo}`]: event.target.value.toUpperCase(),
                          }))
                        }
                        placeholder="Nova posição (ex.: G1)"
                        className="h-10 min-w-0 rounded-lg border border-slate-300 bg-white px-3 text-[10px] font-black uppercase text-slate-800 outline-none focus:border-blue-500"
                      />
                      <button
                        type="button"
                        onClick={() => handleAddPosition(entry.estoque as "2" | "3", entry.modulo)}
                        className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-[9px] font-black uppercase text-slate-700"
                      >
                        + Posição
                      </button>
                    </div>
                  </>
                )}
              </article>
            );
          })}
        </div>
      </div>

    </div>
  );
};
