import React from "react";

interface VerticalModuleMapProps {
  rows: {
    rua: string;
    andar1: string;
    andar2: string;
  }[];
  selectedModule: number;
}

export const VerticalModuleMap: React.FC<VerticalModuleMapProps> = ({
  rows,
  selectedModule,
}) => {

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
