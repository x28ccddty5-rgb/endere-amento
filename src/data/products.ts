import { Product } from "../types";

const RAW_CATALOG: Product[] = [
  { referencia: "092", descricao: "P RASO COUP" },
  { referencia: "094", descricao: "P SOBREM COUP" },
  { referencia: "095", descricao: "PIRES CAFÉ COUP" },
  { referencia: "096", descricao: "PIRES CHÁ COUP" },
  { referencia: "1022601G", descricao: "CANECA BOJUDA COUP STONEWARE 250ML" },
  { referencia: "111", descricao: "SOUSPLAT MARRAKECH" },
  { referencia: "111401G", descricao: "TIGELA M ORGÂNICO STONEWARE" },
  { referencia: "127G", descricao: "CORPO DE PROVA P/ BINIL AZULEJO STONEWARE" },
  { referencia: "131401G", descricao: "CANECA ORGÂNICO" },
  { referencia: "132", descricao: "P RASO ROMA" },
  { referencia: "132601G", descricao: "CANECA BOJUDA COUP STONEWARE Ø 8,5x8,5 CM" },
  { referencia: "133", descricao: "P FUNDO ROMA" },
  { referencia: "134", descricao: "P SOBREM ROMA" },
  { referencia: "134610", descricao: "CANECA ORGÂNICA MÉDIA C/ CABO PEQUENO" },
  { referencia: "135", descricao: "PIRES CAFÉ ROMA" },
  { referencia: "136", descricao: "PIRES CHÁ ROMA" },
  { referencia: "137", descricao: "TRAV ROMA G" },
  { referencia: "138", descricao: "TRAV ROMA M" },
  { referencia: "139", descricao: "BOWL ROMAFECH" },
  { referencia: "140", descricao: "TIG ROMA G" },
  { referencia: "141", descricao: "TIG ROMA M" },
  { referencia: "145", descricao: "XÍC CAFÉ BASIC" },
  { referencia: "146", descricao: "XÍC CHÁ BASIC" },
  { referencia: "154", descricao: "P SOBREM ATENAS" },
  { referencia: "155", descricao: "PIRES CAFÉ ATENAS" },
  { referencia: "159", descricao: "BOWL ATENASAB" },
  { referencia: "201401G", descricao: "P MASSA ORGÂNICO Ø 28x6,5 CM" },
  { referencia: "21401G", descricao: "P RASO ORGÂNICO" },
  { referencia: "21701G", descricao: "P RASO AZEVICHE" },
  { referencia: "22601G", descricao: "P RASO COUP STONEWARE" },
  { referencia: "22701G", descricao: "P RASO NEO" },
  { referencia: "23101G", descricao: "PRATO RASO BIO" },
  { referencia: "23102G", descricao: "P RASO BIO MAIOR" },
  { referencia: "232601G", descricao: "CANECA COUP STONEWARE GRANDE" },
  { referencia: "232602G", descricao: "CANECA COUP STONEWARE GRANDE C/ CABO MÉDIO" },
  { referencia: "234", descricao: "P SOBREM MÔNACO" },
  { referencia: "23401", descricao: "CANECA POIS" },
  { referencia: "24101", descricao: "P RASO RISQUÉ" },
  { referencia: "243P", descricao: "P FUNDO WINDSOR PINTADO" },
  { referencia: "245P", descricao: "PIRES CAFÉ WINDSOR PINTADO" },
  { referencia: "26101G", descricao: "P RASO LINHAS Ø 27,5cm" },
  { referencia: "26201G", descricao: "P RASO ROMA STONEWARE" },
  { referencia: "26601G", descricao: "P RASO MADELEINE STONEWARE" },
  { referencia: "27901G", descricao: "P RASO ORGÂNICO ECO 27,5CM" },
  { referencia: "284", descricao: "P SOBREMESA PLISSÉ" },
  { referencia: "296", descricao: "PIRES CHÁ MARRAKECH" },
  { referencia: "302", descricao: "P RASO PÉRGAMO" },
  { referencia: "310", descricao: "XÍC CAFÉ FLAT" },
  { referencia: "311", descricao: "XÍC CHÁ FLAT" },
  { referencia: "31401G", descricao: "P FUNDO ORGÂNICO" },
  { referencia: "32601G", descricao: "P FUNDO COUP STONEWARE" },
  { referencia: "32701G", descricao: "P FUNDO NEO" },
  { referencia: "33101G", descricao: "PRATO FUNDO BIO" },
  { referencia: "33102G", descricao: "P FUNDO BIO MAIOR" },
  { referencia: "36101G", descricao: "P FUNDO BIO LINHAS" },
  { referencia: "36201G", descricao: "P FUNDO ROMA STONEWARE" },
  { referencia: "36601G", descricao: "P FUNDO MADELEINE STONEWARE" },
  { referencia: "369", descricao: "BOWL ARGOSFECH" },
  { referencia: "37901G", descricao: "P FUNDO ORGÂNICO ECO 21,5CM" },
  { referencia: "392601G", descricao: "COPO DE CAFÉ COUP STONEWARE" },
  { referencia: "401401G", descricao: "TRAV RETANGULAR BIO STONEWARE 33X13" },
  { referencia: "406401G", descricao: "TRAV RETANGULAR M JUTA STONEWARE 27x16 CM" },
  { referencia: "411401G", descricao: "COPO P ORGÂNICO STONEWARE" },
  { referencia: "41401G", descricao: "P SOBREM ORGÂNICO" },
  { referencia: "421401G", descricao: "TRAV OVAL RASA G ORGÂNICO STONEWARE 36x13 CM" },
  { referencia: "42501", descricao: "P SOBREM DAISY" },
  { referencia: "42601G", descricao: "P SOBREM COUP STONEWARE" },
  { referencia: "42701G", descricao: "P SOBREM NEO" },
  { referencia: "43101G", descricao: "PRATO SOBREMESA BIO" },
  { referencia: "431401G", descricao: "CUMBUCA ORGÂNICO STONEWARE 17,5x5,5 CM" },
  { referencia: "43201", descricao: "PRATO DE SOBREMESA MEZCLA" },
  { referencia: "432601G", descricao: "CUMBUCA COUP STONEWARE 13,5 x 5,5 CM" },
  { referencia: "432701G", descricao: "CUMBUCA NEO STONEWARE 12,4x5,4 CM" },
  { referencia: "436101G", descricao: "CUMBUCA LINHAS" },
  { referencia: "44101", descricao: "P SOBREM RISQUÉ" },
  { referencia: "441401G", descricao: "TRAV OVAL FUNDA G ORGÂNICO STONEWARE 32x16 CM" },
  { referencia: "451401G", descricao: "RAMEQUIM P ORGÂNICO STONEWARE 6,8x3,2 CM" },
  { referencia: "453", descricao: "P FUNDO COUP" },
  { referencia: "46101G", descricao: "P SOBREM BIO LINHAS" },
  { referencia: "461401G", descricao: "RAMEQUIM M ORGÂNICO STONEWARE 9x3 CM" },
  { referencia: "46201G", descricao: "P SOBREM ROMA STONEWARE" },
  { referencia: "46601G", descricao: "P SOBREM MADELEINE STONEWARE" },
  { referencia: "466101G", descricao: "RAMEQUIM M LINHAS STONEWARE 9x5 CM" },
  { referencia: "466401G", descricao: "RAMEQUIM M JUTA STONEWARE 11x2,2 CM" },
  { referencia: "47501G", descricao: "P SOBREM OCEAN STONEWARE" },
  { referencia: "47901G", descricao: "P SOBREM ORGÂNICO ECO 19CM" },
  { referencia: "481401G", descricao: "TRAV OVAL RASA M ORGÂNICO STONEWARE 30x20 CM" },
  { referencia: "482", descricao: "P RASO ACANTHUS" },
  { referencia: "483101G", descricao: "TRAV OVAL RASA M BIO STONEWARE 30x20 CM" },
  { referencia: "484", descricao: "P SOBREM ACANTHUS" },
  { referencia: "485", descricao: "PIRES CAFÉ ACANTHUS" },
  { referencia: "486", descricao: "PIRES CHÁ ACANTHUS" },
  { referencia: "489", descricao: "BOWL ACANTHUSAB" },
  { referencia: "501401G", descricao: "TRAV RETANGULAR P ORGÂNICO STONEWARE 22x9,5 CM" },
  { referencia: "506401G", descricao: "TRAV RETANGULAR P JUTA STONEWARE 14x18 CM" },
  { referencia: "511", descricao: "XÍC CHÁ FLOR DE LIS" },
  { referencia: "51101", descricao: "PIRES CAFÉ SEVILHA" },
  { referencia: "511401G", descricao: "TRAV OVAL RASA P ORGÂNICO STONEWARE 23x11 CM" },
  { referencia: "51401G", descricao: "PIRES CAFÉ ORGÂNICO" },
  { referencia: "521401G", descricao: "TRAV OVAL RASA MINI ORGÂNICO STONEWARE 16,5x8 CM" },
  { referencia: "52601G", descricao: "PIRES CAFÉ COUP STONEWARE" },
  { referencia: "53101G", descricao: "PIRES DE CAFÉ BIO" },
  { referencia: "531401G", descricao: "P RASO OVAL ORGÂNICO STONEWARE Ø 29x2,5 CM" },
  { referencia: "54101", descricao: "PIRES CAFÉ RISQUÉ" },
  { referencia: "541401G", descricao: "P SOBREM OVAL ORGÂNICO STONEWARE Ø 22,5x2,5 CM" },
  { referencia: "551401G", descricao: "CUMBUCA OVAL ORGÂNICO 14,5x12 CM" },
  { referencia: "56201G", descricao: "PIRES CAFÉ ROMA STONEWARE" },
  { referencia: "56601G", descricao: "PIRES CAFÉ MADELEINE STONEWARE" },
  { referencia: "571401G", descricao: "XÍC CAFÉ CAMICADO 90 ML" },
  { referencia: "572601G", descricao: "XÍC CAFÉ BOJUDA 90 ML" },
  { referencia: "582", descricao: "P RASO ESPARTA" },
  { referencia: "586", descricao: "PIRES CHÁ ESPARTA" },
  { referencia: "592", descricao: "P RASO MADELEINE" },
  { referencia: "593", descricao: "P FUNDO MADELEINE" },
  { referencia: "593101G", descricao: "PRATO DE PÃO Ø 15,5 X 1,6 CM" },
  { referencia: "594", descricao: "P SOBREM MADELEINE" },
  { referencia: "595", descricao: "PIRES CAFÉ MADELEINE" },
  { referencia: "596", descricao: "PIRES CHÁ MADELEINE" },
  { referencia: "599", descricao: "BOWL MADELEINEFECH" },
  { referencia: "127", descricao: "CORPO DE PROVA P/ BINIL AZULEJO" }
];

export const PRODUCT_CATALOG: Product[] = RAW_CATALOG.map(p => ({
  ...p,
  referencia: p.referencia.toUpperCase()
}));

export function findProductInList(ref: string, list: Product[]): Product | undefined {
  const code = ref.trim().toUpperCase().replace(/^S/i, "");
  // 1. Try exact match
  let found = list.find(p => p.referencia.toUpperCase() === code);
  if (found) return found;

  // 2. Try numeric match (e.g. "92" matches "092")
  const numericCode = parseInt(code, 10);
  if (!isNaN(numericCode) && /^\d+$/.test(code)) {
    found = list.find(p => {
      const dbNum = parseInt(p.referencia, 10);
      return !isNaN(dbNum) && /^\d+$/.test(p.referencia) && dbNum === numericCode;
    });
  }
  return found;
}

export function lookupProduct(ref: string): Product | undefined {
  return findProductInList(ref, PRODUCT_CATALOG);
}
