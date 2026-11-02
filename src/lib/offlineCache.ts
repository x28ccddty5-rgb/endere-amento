const DB_NAME = "porto-brasil-offline";
const DB_VERSION = 1;
const STORE_NAME = "snapshots";

type CacheKey = "slots" | "products" | "history" | "divergencias";

interface SnapshotRecord {
  key: string;
  savedAt: number;
  authorizationFingerprint: string;
  value: unknown;
}

const scopedKey = (key: CacheKey, scope: string): string => `${scope}:${key}`;

const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB indisponível neste navegador."));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Falha ao abrir cache offline."));
  });

/**
 * Snapshots são isolados por usuário autenticado e pela matriz efetiva de permissões.
 * A troca/revogação de permissões torna snapshots antigos inelegíveis para fallback.
 * O escopo "legacy" existe somente para compatibilidade com chamadas antigas.
 */
export async function saveOfflineSnapshot<T>(
  key: CacheKey,
  value: T,
  scope = "legacy",
  authorizationFingerprint = "legacy",
): Promise<void> {
  let db: IDBDatabase | null = null;
  try {
    db = await openDb();

    await new Promise<void>((resolve, reject) => {
      const transaction = db!.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put({
        key: scopedKey(key, scope),
        savedAt: Date.now(),
        authorizationFingerprint,
        value,
      } satisfies SnapshotRecord);

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } catch (error) {
    console.warn(`Não foi possível atualizar o cache offline de ${key}.`, error);
  } finally {
    db?.close();
  }
}

export async function readOfflineSnapshot<T>(
  key: CacheKey,
  scope = "legacy",
  authorizationFingerprint = "legacy",
): Promise<T | null> {
  let db: IDBDatabase | null = null;
  try {
    db = await openDb();

    const record = await new Promise<SnapshotRecord | undefined>((resolve, reject) => {
      const transaction = db!.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(scopedKey(key, scope));

      request.onsuccess = () => resolve(request.result as SnapshotRecord | undefined);
      request.onerror = () => reject(request.error);
    });

    if (!record || record.authorizationFingerprint !== authorizationFingerprint) {
      return null;
    }

    return (record.value as T | undefined) ?? null;
  } catch (error) {
    console.warn(`Não foi possível ler o cache offline de ${key}.`, error);
    return null;
  } finally {
    db?.close();
  }
}

/** Remove somente os snapshots do usuário informado; nunca afeta outros usuários. */
export async function clearOfflineSnapshots(scope: string): Promise<void> {
  let db: IDBDatabase | null = null;
  try {
    db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const transaction = db!.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        if (String(cursor.key).startsWith(`${scope}:`)) cursor.delete();
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } catch (error) {
    console.warn("Não foi possível limpar os snapshots offline da sessão.", error);
  } finally {
    db?.close();
  }
}
