export interface Product {
  referencia: string;
  descricao: string;
  paletizacao?: number;
}

export interface WarehouseSlot {
  id: string; // Combine estoque-modulo-posicao
  estoque: string;
  modulo: string;
  posicao: string;
  referencia: string;
  descricao: string;
  saldo: number;
  dataChacote: string;
  ultimaData: string;
  ultimaHora: string;
  ultimoResponsavel: string;
}

export interface LancamentoRow {
  id: string; // frontend temp id
  data: string;
  estoque: string;
  modulo: string;
  posicao: string;
  referencia: string;
  quantidade: number | "";
  tipo: "Entrada" | "Saída";
  dataChacote: string;
  hora: string;
  responsavel: string;
}

export interface HistoricoMov {
  id: string;
  dataLancamento: string;
  quemLancou: string;
  data: string;
  estoque: string;
  modulo: string;
  posicao: string;
  referencia: string;
  quantidade: number;
  tipo: "Entrada" | "Saída";
  dataChacote: string;
  hora: string;
  responsavel: string;
}

export interface Divergencia {
  id: string;
  dataDivergencia: string;
  tipoDivergencia: string; // e.g., "Posição Ocupada", "Saldo Insuficiente", "Referência Inválida"
  estoque: string;
  modulo: string;
  posicao: string;
  refAtual: string;
  refNova: string;
  saldoAntes: number;
  movimentacao: number;
  saldoFinal: number;
  responsavel: string;
  status: "Aberta" | "Corrigida";
  dataChacote?: string;
  dataCorrecao?: string;
  corrigidoPor?: string;
  observacao?: string;
}

export type AppMode = "basico" | "avancado";
