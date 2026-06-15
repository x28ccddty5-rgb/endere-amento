import React from "react";

interface VerticalModuleMapProps {
  selectedEstoque: string;
  selectedModule: number;
}

export const VerticalModuleMap: React.FC<VerticalModuleMapProps> = ({
  selectedEstoque,
  selectedModule,
}) => {

  const rows = [
    { rua: "E", andar1: "E1", andar2: "E2" },
    { rua: "D", andar1: "D1", andar2: "D2" },
    { rua: "C", andar1: "C1", andar2: "C2" },
    { rua: "B", andar1: "B1", andar2: "B2" },
    { rua: "A", andar1: "A1", andar2: "A2" },
  ];

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">

      <div className="bg-slate-800 text-white px-4 py-3">
        <h3 className="font-black">
          Módulo {selectedModule}
        </h3>
      </div>

      <div className="grid grid-cols-3 text-center">

        <div className="bg-slate-100 p-3 font-bold text-slate-500">
          Rua
        </div>

        <div className="bg-slate-100 p-3 font-bold text-slate-500">
          1º Andar
        </div>

        <div className="bg-slate-100 p-3 font-bold text-slate-500">
          2º Andar
        </div>

        {rows.map((row) => (
          <React.Fragment key={row.rua}>
            <div className="border p-4 font-black text-slate-700">
              {row.rua}
            </div>

            <div className="border p-4 bg-blue-50">
              {row.andar1}
            </div>

            <div className="border p-4 bg-blue-50">
              {row.andar2}
            </div>
          </React.Fragment>
        ))}

      </div>

      <div className="bg-slate-200 text-center py-3 font-bold text-slate-600">
        CORREDOR
      </div>

    </div>
  );
};
