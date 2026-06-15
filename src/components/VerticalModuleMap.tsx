import React from "react";

interface VerticalModuleMapProps {
  rows: {
    rua: string;
    andar1: string;
    andar2: string;
  }[];

  selectedModule: number;

  selectedEstoque: string;

  blockedPositions: string[];
  
  getSlot: (
    est: string,
    modulo: string,
    posicao: string
  ) => any;

  onSelectSlot: (slot: any) => void;

  selectedSlotId: string | null;
}

export const VerticalModuleMap = ({
  rows,
  selectedModule,
  selectedEstoque,
  blockedPositions,
  getSlot,
  onSelectSlot,
  selectedSlotId,
}) => {

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">

      <div className="bg-slate-800 text-white px-4 py-3">
        <h3 className="font-black">
          Módulo {selectedModule}
        </h3>
      </div>

      <div
        className="grid text-center"
        style={{
          gridTemplateColumns: "70px 1fr 1fr"
        }}
      >

        <div className="bg-slate-100 p-3 font-bold text-slate-500">
          Rua
        </div>

        <div className="bg-slate-100 p-3 font-bold text-slate-500">
          1º Andar
        </div>

        <div className="bg-slate-100 p-3 font-bold text-slate-500">
          2º Andar
        </div>

        {rows.map((row) => {

        const slot1 = getSlot(
          selectedEstoque,
          String(selectedModule),
          row.andar1
        );
        
        const slot2 = getSlot(
          selectedEstoque,
          String(selectedModule),
          row.andar2
        );

      const blocked1 =
      blockedPositions.includes(row.andar1);
      
      const blocked2 =
      blockedPositions.includes(row.andar2);
        
        const dense1 = slot1.saldo >= 1000;
        const dense2 = slot2.saldo >= 1000;

        const selected1 = selectedSlotId === slot1.id;
        const selected2 = selectedSlotId === slot2.id;
        
        return (
          <React.Fragment key={row.rua}>
            <div className="border p-3 font-bold text-slate-700 flex items-center justify-center">
              {row.rua}
            </div>
            
            {blocked1 ? (

            <div className="border p-2 bg-red-50 text-red-600 flex flex-col items-center justify-center">
          
              <div className="text-lg">
                🚫
              </div>
          
              <div className="text-[10px] font-bold">
                BLOQ.
              </div>
          
            </div>
          
          ) : (
          
            <div
              onClick={() => onSelectSlot(slot1)}
              className={`border p-2 md:p-3 cursor-pointer transition
                ${
                  slot1.saldo === 0
                    ? "bg-slate-50 text-slate-400"
                    : dense1
                      ? "bg-blue-600 text-white"
                      : "bg-blue-100 text-blue-900"
                }
                ${
                  selected1
                    ? "ring-2 ring-blue-500 ring-offset-2"
                    : ""
                }
              `}
            >
          
              <div className="text-[10px] opacity-75">
                {row.andar1}
              </div>
          
              <div className="font-black text-xs md:text-sm leading-tight">
                {slot1.referencia || "—"}
              </div>
          
              <div className="text-[10px] opacity-75">
                {slot1.saldo > 0
                  ? `${slot1.saldo} pçs`
                  : "Vazio"}
              </div>
          
            </div>
          
          )}
           

            {blocked2 ? (

            <div className="border p-2 bg-red-50 text-red-600 flex flex-col items-center justify-center">
          
              <div className="text-lg">
                🚫
              </div>
          
              <div className="text-[10px] font-bold">
                BLOQ.
              </div>
          
            </div>
          
          ) : (
          
            <div
              onClick={() => onSelectSlot(slot2)}
              className={`border p-2 md:p-3 cursor-pointer transition
                ${
                  slot2.saldo === 0
                    ? "bg-slate-50 text-slate-400"
                    : dense1
                      ? "bg-blue-600 text-white"
                      : "bg-blue-100 text-blue-900"
                }
                ${
                  selected1
                    ? "ring-2 ring-blue-500 ring-offset-2"
                    : ""
                }
              `}
            >
          
              <div className="text-[10px] opacity-75">
                {row.andar1}
              </div>
          
              <div className="font-black text-xs md:text-sm leading-tight">
                {slot2.referencia || "—"}
              </div>
          
              <div className="text-[10px] opacity-75">
                {slot2.saldo > 0
                  ? `${slot2.saldo} pçs`
                  : "Vazio"}
              </div>
          
            </div>
          
          )}
            
          </React.Fragment>
          );
        })}

      </div>

      <div className="bg-slate-200 text-center py-3 font-bold text-slate-600">
        CORREDOR
      </div>

    </div>
  );
};
