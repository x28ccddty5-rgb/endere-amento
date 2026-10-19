/** Serializa gravações/exclusões do rascunho para uma gravação antiga não recriar
 * no Supabase um rascunho que acabou de ser excluído após um lote confirmado. */
let lancamentoDraftWriteQueue: Promise<void> = Promise.resolve();

export function enqueueLancamentoDraftWrite<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const result = lancamentoDraftWriteQueue.then(operation, operation);
  lancamentoDraftWriteQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
