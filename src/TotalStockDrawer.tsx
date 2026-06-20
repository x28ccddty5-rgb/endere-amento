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

        </div>

      </div>

    </div>
  );
}
