/**
 * Calcula quantos paletes uma quantidade ocupa.
 *
 * Regra operacional:
 * - Menor que 0,5 palete = não contabiliza
 * - Maior ou igual a 0,5 = arredonda para cima
 */
export function calcularPaletes(
  saldo: number,
  paletizacao?: number
): number {
  if (!paletizacao || paletizacao <= 0) {
    return 0;
  }

  const resultado = saldo / paletizacao;

  if (resultado < 0.5) {
    return 0;
  }

  return Math.ceil(resultado);
}