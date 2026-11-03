import React, { useCallback, useEffect, useMemo, useState } from "react";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import { CalendarDays, FileSpreadsheet, FileText, Loader2, Search, RefreshCw, PackageSearch } from "lucide-react";
import { supabase } from "../lib/supabase";
import { guardedSupabaseRequest } from "../lib/supabaseRequestGuard";

type StockBalanceSnapshot = {
  snapshot_date: string;
  reference: string;
  description: string;
  pieces_e1: number;
  pieces_e2: number;
  pieces_e3: number;
  total_pieces: number;
  occupied_addresses: number;
  is_unidentified: boolean;
  created_at: string;
};

interface StockBalanceHistoryPanelProps {
  canExportReports: boolean;
  requestReportExportPermission?: () => Promise<boolean>;
}

const getLocalIsoDate = (date = new Date()): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const formatDate = (value: string): string => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  return `${match[3]}/${match[2]}/${match[1]}`;
};

const formatNumber = (value: number | null | undefined): string =>
  Number(value || 0).toLocaleString("pt-BR");

const formatTimestamp = (value: string | null | undefined): string => {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("pt-BR");
};

const normalizeSearchText = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleUpperCase("pt-BR")
    .trim();

const buildExportRows = (rows: StockBalanceSnapshot[]) => rows.map(row => ({
  Referencia: row.is_unidentified ? "SEM REFERENCIA" : row.reference,
  Descricao: row.description || "",
  Saldo_E1_Pecas: Number(row.pieces_e1 || 0),
  Saldo_E2_Pecas: Number(row.pieces_e2 || 0),
  Saldo_E3_Pecas: Number(row.pieces_e3 || 0),
  Saldo_Total_Pecas: Number(row.total_pieces || 0),
  Posicoes_Com_Saldo: Number(row.occupied_addresses || 0),
}));

export const StockBalanceHistoryPanel: React.FC<StockBalanceHistoryPanelProps> = ({
  canExportReports,
  requestReportExportPermission,
}) => {
  const [selectedDate, setSelectedDate] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [snapshotRows, setSnapshotRows] = useState<StockBalanceSnapshot[]>([]);
  const [latestSnapshotDate, setLatestSnapshotDate] = useState("");
  const [capturedAt, setCapturedAt] = useState("");
  const [loadingLatest, setLoadingLatest] = useState(true);
  const [loadingRows, setLoadingRows] = useState(false);
  const [error, setError] = useState("");
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    let active = true;

    const loadLatestSnapshotDate = async () => {
      setLoadingLatest(true);
      const response = await guardedSupabaseRequest("stock-balance-history.latest", () =>
        supabase
          .from("stock_balance_snapshots")
          .select("snapshot_date")
          .order("snapshot_date", { ascending: false })
          .limit(1)
          .maybeSingle()
      );

      if (!active) return;
      if (response.error) {
        setError(response.blocked
          ? "A leitura do histórico está temporariamente bloqueada. Atualize o aplicativo e tente novamente."
          : `Não foi possível localizar a última fotografia: ${response.error.message}`);
        setSelectedDate(getLocalIsoDate());
      } else {
        const latest = String(response.data?.snapshot_date || "");
        setLatestSnapshotDate(latest);
        setSelectedDate(latest || getLocalIsoDate());
      }
      setLoadingLatest(false);
      setInitialized(true);
    };

    void loadLatestSnapshotDate();
    return () => { active = false; };
  }, []);

  const loadSnapshots = useCallback(async (date: string) => {
    if (!date) return;
    setLoadingRows(true);
    setError("");

    // O catálogo atual tem 202 referências. A leitura diária é pequena e única;
    // a busca por referência/descrição é local, evitando uma consulta por tecla.
    const pageSize = 500;
    const maxPages = 10;
    const collected: StockBalanceSnapshot[] = [];

    for (let page = 0; page < maxPages; page += 1) {
      const from = page * pageSize;
      const response = await guardedSupabaseRequest("stock-balance-history.read", () =>
        supabase
          .from("stock_balance_snapshots")
          .select("snapshot_date,reference,description,pieces_e1,pieces_e2,pieces_e3,total_pieces,occupied_addresses,is_unidentified,created_at")
          .eq("snapshot_date", date)
          .order("reference", { ascending: true })
          .range(from, from + pageSize - 1)
      );

      if (response.error) {
        setSnapshotRows([]);
        setCapturedAt("");
        setError(response.blocked
          ? "A consulta foi temporariamente bloqueada para evitar repetição de solicitações. Tente novamente mais tarde."
          : `Erro ao consultar saldo histórico: ${response.error.message}`);
        setLoadingRows(false);
        return;
      }

      const batch = (response.data || []) as StockBalanceSnapshot[];
      collected.push(...batch);
      if (batch.length < pageSize) break;
    }

    if (collected.length >= pageSize * maxPages) {
      setSnapshotRows([]);
      setCapturedAt("");
      setError("A fotografia ultrapassou o limite de segurança da consulta. Solicite a revisão do limite de paginação.");
      setLoadingRows(false);
      return;
    }

    setSnapshotRows(collected);
    setCapturedAt(collected[0]?.created_at || "");
    setLoadingRows(false);
  }, []);

  useEffect(() => {
    if (!initialized || !selectedDate) return;
    void loadSnapshots(selectedDate);
  }, [initialized, selectedDate, loadSnapshots]);

  const rows = useMemo(() => {
    const term = normalizeSearchText(appliedSearch);
    if (!term) return snapshotRows;
    return snapshotRows.filter(row =>
      normalizeSearchText(row.reference).includes(term) ||
      normalizeSearchText(row.description).includes(term) ||
      (row.is_unidentified && normalizeSearchText("sem referencia").includes(term))
    );
  }, [snapshotRows, appliedSearch]);

  const totals = useMemo(() => rows.reduce((acc, row) => ({
    skuCount: acc.skuCount + 1,
    piecesE1: acc.piecesE1 + Number(row.pieces_e1 || 0),
    piecesE2: acc.piecesE2 + Number(row.pieces_e2 || 0),
    piecesE3: acc.piecesE3 + Number(row.pieces_e3 || 0),
    totalPieces: acc.totalPieces + Number(row.total_pieces || 0),
  }), { skuCount: 0, piecesE1: 0, piecesE2: 0, piecesE3: 0, totalPieces: 0 }), [rows]);

  const confirmExportPermission = async (): Promise<boolean> => {
    if (!canExportReports) {
      window.alert("Seu perfil não possui a permissão de exportação de relatórios.");
      return false;
    }
    if (requestReportExportPermission && !(await requestReportExportPermission())) return false;
    return true;
  };

  const exportExcel = async () => {
    if (rows.length === 0 || !(await confirmExportPermission())) return;

    const workbook = XLSX.utils.book_new();
    const details = XLSX.utils.json_to_sheet(buildExportRows(rows));
    details["!cols"] = [
      { wch: 18 }, { wch: 52 }, { wch: 18 }, { wch: 18 },
      { wch: 18 }, { wch: 20 }, { wch: 20 },
    ];
    XLSX.utils.book_append_sheet(workbook, details, "Saldo por SKU");

    const summary = XLSX.utils.aoa_to_sheet([
      ["Relatório de saldo histórico por SKU"],
      ["Data da fotografia", formatDate(selectedDate)],
      ["Capturado em", formatTimestamp(capturedAt)],
      ["Filtro aplicado", appliedSearch || "Todos os SKUs"],
      ["SKUs exibidos", totals.skuCount],
      ["Saldo E1 (peças)", totals.piecesE1],
      ["Saldo E2 (peças)", totals.piecesE2],
      ["Saldo E3 (peças)", totals.piecesE3],
      ["Saldo total exibido (peças)", totals.totalPieces],
      ["Critério", "Fotografia consolidada no fechamento diário; saldos somados por referência."],
    ]);
    summary["!cols"] = [{ wch: 34 }, { wch: 72 }];
    XLSX.utils.book_append_sheet(workbook, summary, "Resumo");
    XLSX.writeFile(workbook, `Saldo_Historico_SKU_${selectedDate}.xlsx`);
  };

  const exportPdf = async () => {
    if (rows.length === 0 || !(await confirmExportPermission())) return;

    const document = new jsPDF({ orientation: "landscape", format: "a4" });
    const pageWidth = document.internal.pageSize.getWidth();
    const pageHeight = document.internal.pageSize.getHeight();
    document.setFillColor(15, 23, 42);
    document.rect(0, 0, pageWidth, 26, "F");
    document.setTextColor(255, 255, 255);
    document.setFont("helvetica", "bold");
    document.setFontSize(8);
    document.text("PORTO BRASIL CERAMICA | GESTAO DE ARMAZENAGEM", 14, 8);
    document.setFontSize(16);
    document.text("Saldo historico por SKU", 14, 18);
    document.setFont("helvetica", "normal");
    document.setFontSize(8);
    document.text(`Data da fotografia: ${formatDate(selectedDate)}  |  Capturado em: ${formatTimestamp(capturedAt)}`, 14, 32);
    document.text(`Filtro: ${appliedSearch || "Todos os SKUs"}  |  SKUs exibidos: ${formatNumber(totals.skuCount)}  |  Saldo exibido: ${formatNumber(totals.totalPieces)} pecas`, 14, 38);

    autoTable(document, {
      startY: 44,
      margin: { top: 44, bottom: 14, left: 14, right: 14 },
      head: [["Referencia", "Descricao", "E1 (pecas)", "E2 (pecas)", "E3 (pecas)", "Saldo total", "Posicoes"]],
      body: rows.map(row => [
        row.is_unidentified ? "SEM REFERENCIA" : row.reference,
        row.description || "-",
        formatNumber(row.pieces_e1),
        formatNumber(row.pieces_e2),
        formatNumber(row.pieces_e3),
        formatNumber(row.total_pieces),
        formatNumber(row.occupied_addresses),
      ]),
      styles: { font: "helvetica", fontSize: 7, cellPadding: 2, overflow: "linebreak", textColor: [51, 65, 85] },
      headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: "bold", fontSize: 7 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: { 0: { cellWidth: 25 }, 1: { cellWidth: 93 }, 2: { cellWidth: 25 }, 3: { cellWidth: 25 }, 4: { cellWidth: 25 }, 5: { cellWidth: 28 }, 6: { cellWidth: 19 } },
      didDrawPage: () => {
        document.setDrawColor(203, 213, 225);
        document.line(14, pageHeight - 10, pageWidth - 14, pageHeight - 10);
        document.setTextColor(100, 116, 139);
        document.setFont("helvetica", "normal");
        document.setFontSize(7);
        document.text("Fotografia diaria do estoque - dados consolidados por referencia", 14, pageHeight - 5);
        document.text(`Pagina ${document.getNumberOfPages()}`, pageWidth - 14, pageHeight - 5, { align: "right" });
      },
    });

    document.save(`Saldo_Historico_SKU_${selectedDate}.pdf`);
  };

  const applySearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAppliedSearch(searchInput.trim());
  };

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 p-4 sm:p-5">
        <div>
          <div className="flex items-center gap-2">
            <PackageSearch className="h-5 w-5 text-blue-600" />
            <h3 className="text-sm font-black text-slate-800">Saldo histórico por SKU</h3>
          </div>
          <p className="mt-1 text-xs text-slate-500">Consulte o saldo consolidado por referência ou descrição no fechamento de cada dia.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canExportReports && (
            <>
              <button type="button" onClick={() => void exportPdf()} disabled={loadingRows || rows.length === 0}
                className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] font-bold text-rose-700 disabled:opacity-40">
                <FileText className="h-3.5 w-3.5" /> PDF
              </button>
              <button type="button" onClick={() => void exportExcel()} disabled={loadingRows || rows.length === 0}
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] font-bold text-emerald-700 disabled:opacity-40">
                <FileSpreadsheet className="h-3.5 w-3.5" /> Excel
              </button>
            </>
          )}
        </div>
      </div>

      <form onSubmit={applySearch} className="grid grid-cols-1 gap-3 border-b border-slate-100 bg-slate-50 p-4 sm:grid-cols-[180px_minmax(0,1fr)_auto_auto] sm:items-end">
        <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">
          Data da fotografia
          <span className="mt-1 flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5">
            <CalendarDays className="h-4 w-4 shrink-0 text-slate-400" />
            <input type="date" value={selectedDate} max={latestSnapshotDate || getLocalIsoDate()} onChange={event => setSelectedDate(event.target.value)}
              className="w-full min-w-0 bg-transparent text-sm font-bold text-slate-700 outline-none" />
          </span>
        </label>
        <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">
          Referencia ou descricao
          <span className="mt-1 flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3">
            <Search className="h-4 w-4 shrink-0 text-slate-400" />
            <input value={searchInput} onChange={event => setSearchInput(event.target.value)}
              placeholder="Ex.: 33101G ou parte da descricao"
              className="w-full min-w-0 bg-transparent text-sm font-semibold text-slate-700 outline-none" />
          </span>
        </label>
        <button type="submit" disabled={loadingRows || loadingLatest}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 text-xs font-bold uppercase tracking-wide text-white disabled:opacity-50">
          {loadingRows ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          Consultar
        </button>
        <button type="button" onClick={() => { setSearchInput(""); setAppliedSearch(""); if (latestSnapshotDate) setSelectedDate(latestSnapshotDate); }}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600">
          <RefreshCw className="h-3.5 w-3.5" /> Limpar
        </button>
      </form>

      <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-4">
        <div className="rounded-lg bg-slate-50 p-3">
          <div className="text-[9px] font-black uppercase text-slate-400">SKUs exibidos</div>
          <div className="mt-1 text-lg font-black tabular-nums text-slate-800">{formatNumber(totals.skuCount)}</div>
        </div>
        <div className="rounded-lg bg-slate-50 p-3">
          <div className="text-[9px] font-black uppercase text-slate-400">Saldo E1</div>
          <div className="mt-1 text-lg font-black tabular-nums text-slate-800">{formatNumber(totals.piecesE1)}</div>
        </div>
        <div className="rounded-lg bg-slate-50 p-3">
          <div className="text-[9px] font-black uppercase text-slate-400">Saldo E2 + E3</div>
          <div className="mt-1 text-lg font-black tabular-nums text-slate-800">{formatNumber(totals.piecesE2 + totals.piecesE3)}</div>
        </div>
        <div className="rounded-lg border border-blue-100 bg-blue-50 p-3">
          <div className="text-[9px] font-black uppercase text-blue-600">Saldo total exibido</div>
          <div className="mt-1 text-lg font-black tabular-nums text-blue-900">{formatNumber(totals.totalPieces)}</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-3 text-[10px] text-slate-400">
        <span>Fotografia: {selectedDate ? formatDate(selectedDate) : "-"}</span>
        <span>Capturada em: {formatTimestamp(capturedAt)}</span>
      </div>

      {error && <div className="mx-4 mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700">{error}</div>}

      {!loadingRows && !error && snapshotRows.length === 0 && (
        <div className="border-t border-dashed border-slate-200 px-5 py-10 text-center">
          <CalendarDays className="mx-auto h-7 w-7 text-slate-300" />
          <p className="mt-2 text-sm font-bold text-slate-600">Nenhuma fotografia encontrada para esta data.</p>
          <p className="mt-1 text-xs text-slate-400">Não estimamos saldos em datas sem captura. O histórico confiável começa na implantação desta rotina.</p>
          {latestSnapshotDate && <p className="mt-2 text-[10px] font-bold text-slate-500">Última fotografia disponível: {formatDate(latestSnapshotDate)}</p>}
        </div>
      )}

      {!loadingRows && !error && snapshotRows.length > 0 && rows.length === 0 && (
        <div className="border-t border-dashed border-slate-200 px-5 py-8 text-center">
          <Search className="mx-auto h-6 w-6 text-slate-300" />
          <p className="mt-2 text-sm font-bold text-slate-600">Nenhum SKU corresponde à referência ou descrição informada.</p>
          <p className="mt-1 text-xs text-slate-400">A fotografia de {formatDate(selectedDate)} existe; revise o texto da pesquisa.</p>
        </div>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto border-t border-slate-100">
          <table className="min-w-[850px] w-full text-left text-xs">
            <thead className="bg-slate-50 text-[10px] font-black uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Referencia</th>
                <th className="px-4 py-3">Descricao</th>
                <th className="px-4 py-3 text-right">E1</th>
                <th className="px-4 py-3 text-right">E2</th>
                <th className="px-4 py-3 text-right">E3</th>
                <th className="px-4 py-3 text-right">Saldo total</th>
                <th className="px-4 py-3 text-right">Posicoes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(row => (
                <tr key={`${row.snapshot_date}:${row.reference}`} className="hover:bg-slate-50">
                  <td className="whitespace-nowrap px-4 py-3 font-mono font-black text-slate-800">{row.is_unidentified ? "SEM REFERENCIA" : row.reference}</td>
                  <td className="min-w-[280px] px-4 py-3 font-semibold text-slate-600">{row.description || "-"}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-600">{formatNumber(row.pieces_e1)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-600">{formatNumber(row.pieces_e2)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-600">{formatNumber(row.pieces_e3)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-black tabular-nums text-blue-800">{formatNumber(row.total_pieces)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-500">{formatNumber(row.occupied_addresses)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {loadingRows && <div className="flex items-center justify-center gap-2 py-6 text-xs font-semibold text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Consultando fotografia diária...</div>}

      <div className="border-t border-slate-100 px-4 py-3 text-[10px] leading-relaxed text-slate-400">
        O saldo representa a soma das peças por referência em todas as posições no fechamento da data selecionada. As fotografias anteriores à implantação não são preenchidas artificialmente.
      </div>
    </section>
  );
};
