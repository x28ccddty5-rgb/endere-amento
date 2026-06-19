interface FreeCapacityDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  freePositions: number;
  totalPositions: number;
  freeSlotsE1: number;
  freeSlotsE2: number;
  freeSlotsE3: number;
}

export function FreeCapacityDrawer({
  isOpen,
  onClose,
  freePositions,
  totalPositions,
}: FreeCapacityDrawerProps) {
  if (!isOpen) return null;

  const freePercent =
    (freePositions / totalPositions) * 100;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40">

      <div className="w-full max-w-5xl bg-white h-full overflow-y-auto">

        <div className="sticky top-0 bg-white border-b px-6 py-4 flex justify-between items-center">

          <h2 className="text-2xl font-bold">
            Análise de Capacidade Disponível
          </h2>

          <button onClick={onClose}>
            X
          </button>

        </div>

        <div className="p-6">

          <div className="border rounded-xl p-5">

            <div className="text-sm text-slate-500">
              LIVRES
            </div>

            <div className="text-5xl font-black">
              {freePositions}
            </div>

            <div className="text-xl text-emerald-600 font-bold">
              {freePercent.toFixed(1)}%
            </div>

          </div>

        </div>

      </div>

    </div>
  );
}
