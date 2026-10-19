/**
 * Limita chamadas repetidas ao Supabase quando uma consulta falha.
 *
 * - No máximo 5 tentativas por operação, com 10 s entre tentativas.
 * - Erros permanentes (schema, permissões, dados inválidos, HTTP 4xx) abrem
 *   o circuito imediatamente, pois repetir a mesma consulta não vai corrigi-los.
 * - Depois de esgotadas as tentativas, a operação fica bloqueada até recarregar
 *   a aplicação. Isso impede efeitos React/reconexões de gerar um ciclo infinito.
 * - Chamadas simultâneas da mesma operação compartilham a mesma Promise.
 */

export const SUPABASE_MAX_ATTEMPTS = 5;
export const SUPABASE_RETRY_DELAY_MS = 10_000;

export interface SupabaseRequestError {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
  status?: number | string | null;
  name?: string;
}

export interface SupabaseRequestResult<T> {
  data: T | null;
  error: SupabaseRequestError | null;
  status?: number;
}

export interface GuardedSupabaseResult<T> extends SupabaseRequestResult<T> {
  blocked?: boolean;
}

interface RequestState<T> {
  inFlight?: Promise<GuardedSupabaseResult<T>>;
  blocked: boolean;
  lastResult?: GuardedSupabaseResult<T>;
}

interface CircuitState {
  blocked: boolean;
  lastResult?: GuardedSupabaseResult<unknown>;
}

// operationKey identifica a consulta exata (incluindo página/filtros); circuitKey
// compartilha a trava entre consultas da mesma família quando o erro é repetido.
const requestStates = new Map<string, RequestState<unknown>>();
const circuitStates = new Map<string, CircuitState>();

const wait = (milliseconds: number) =>
  new Promise<void>(resolve => setTimeout(resolve, milliseconds));

const normalizeError = (error: unknown): SupabaseRequestError => {
  if (error && typeof error === "object") {
    return error as SupabaseRequestError;
  }

  return { message: String(error ?? "Erro desconhecido") };
};

const isPermanentError = (error: SupabaseRequestError): boolean => {
  const status = Number(error.status ?? (error as any).statusCode ?? 0);
  if (status === 408 || status === 429) return false;
  if (status >= 400 && status < 500) return true;

  const code = String(error.code ?? "").toUpperCase();
  if (/^(22|23|28|42)[A-Z0-9]{3}$/.test(code)) return true;
  if (/^PGRST2\d{2}$/.test(code) || /^PGRST3\d{2}$/.test(code)) return true;

  const message = `${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`;
  return /column .* does not exist|relation .* does not exist|schema cache|permission denied|invalid input syntax|violates foreign key|violates not-null|duplicate key|no unique or exclusion constraint/i.test(message);
};

/**
 * Extrai o tipo de `data` diretamente do retorno da consulta.
 * Isso evita que o TypeScript alargue `data` para `unknown` ao inferir o
 * genérico a partir do thenable usado pelo Supabase.
 */
type SupabaseResponseOf<TRequest> = TRequest extends () => infer TResult
  ? Awaited<TResult>
  : never;

type SupabaseRequestData<TRequest> = SupabaseResponseOf<TRequest> extends { data: infer TData }
  ? Exclude<TData, null>
  : unknown;

/** Executa uma consulta Supabase com tentativas limitadas e circuit breaker. */
export async function guardedSupabaseRequest<
  TRequest extends () => PromiseLike<any>,
>(
  operationKey: string,
  request: TRequest,
  circuitKey: string = operationKey,
): Promise<GuardedSupabaseResult<SupabaseRequestData<TRequest>>> {
  type T = SupabaseRequestData<TRequest>;
  const circuit = circuitStates.get(circuitKey);
  if (circuit?.blocked && circuit.lastResult) {
    return { ...circuit.lastResult, blocked: true } as GuardedSupabaseResult<T>;
  }

  let state = requestStates.get(operationKey) as RequestState<T> | undefined;
  if (state?.blocked && state.lastResult) {
    return { ...state.lastResult, blocked: true };
  }
  if (state?.inFlight) return state.inFlight;

  if (!state) {
    state = { blocked: false };
    requestStates.set(operationKey, state as RequestState<unknown>);
  }

  const activeState = state;
  const run = async (): Promise<GuardedSupabaseResult<T>> => {
    for (let attempt = 1; attempt <= SUPABASE_MAX_ATTEMPTS; attempt += 1) {
      let result: GuardedSupabaseResult<T>;

      try {
        const response = await request() as SupabaseRequestResult<T>;
        const responseError = response.error
          ? {
              ...normalizeError(response.error),
              status: response.status ?? response.error.status,
            }
          : null;
        result = { data: response.data, error: responseError, blocked: false };
      } catch (caught) {
        result = { data: null, error: normalizeError(caught), blocked: false };
      }

      if (!result.error) {
        // Não permita que uma consulta concorrente bem-sucedida feche um circuito
        // já aberto por outra consulta da mesma família.
        if (!circuitStates.get(circuitKey)?.blocked) circuitStates.delete(circuitKey);
        activeState.blocked = false;
        activeState.lastResult = undefined;
        return result;
      }

      activeState.lastResult = result;
      const permanent = isPermanentError(result.error);
      const outOfAttempts = attempt >= SUPABASE_MAX_ATTEMPTS;

      if (permanent || outOfAttempts) {
        activeState.blocked = true;
        result.blocked = true;
        circuitStates.set(circuitKey, {
          blocked: true,
          lastResult: result as GuardedSupabaseResult<unknown>,
        });
        console.error(
          `[SupabaseGuard] ${operationKey}: circuito '${circuitKey}' aberto após ${attempt} tentativa(s). ` +
          "Novas chamadas automáticas desta operação foram bloqueadas até recarregar a aplicação.",
          result.error,
        );
        return result;
      }

      await wait(SUPABASE_RETRY_DELAY_MS);
    }

    // Proteção defensiva: o loop sempre termina pelo sucesso ou pelo limite.
    activeState.blocked = true;
    const result = activeState.lastResult ?? {
      data: null,
      error: { message: "Limite de tentativas do Supabase atingido." },
      blocked: true,
    };
    circuitStates.set(circuitKey, {
      blocked: true,
      lastResult: result as GuardedSupabaseResult<unknown>,
    });
    return { ...result, blocked: true };
  };

  const promise = run();
  activeState.inFlight = promise;

  try {
    return await promise;
  } finally {
    if (activeState.inFlight === promise) {
      activeState.inFlight = undefined;
      if (!activeState.blocked && requestStates.get(operationKey) === activeState) {
        requestStates.delete(operationKey);
      }
    }
  }
}
