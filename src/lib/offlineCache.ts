const DB_NAME = "porto-brasil-offline";
const DB_VERSION = 1;
const STORE_NAME = "snapshots";

type CacheKey = "slots" | "products" | "history" | "divergencias";

interface SnapshotRecord {
  key: CacheKey;
  savedAt: number;
  value: unknown;
}

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

export async function saveOfflineSnapshot<T>(key: CacheKey, value: T): Promise<void> {
  try {
    const db = await openDb();

    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put({
        key,
        savedAt: Date.now(),
        value,
      } satisfies SnapshotRecord);

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });

    db.close();
  } catch (error) {
    console.warn(`Não foi possível atualizar o cache offline de ${key}.`, error);
  }
}

export async function readOfflineSnapshot<T>(key: CacheKey): Promise<T | null> {
  try {
    const db = await openDb();

    const record = await new Promise<SnapshotRecord | undefined>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(key);

      request.onsuccess = () => resolve(request.result as SnapshotRecord | undefined);
      request.onerror = () => reject(request.error);
    });

    db.close();
    return (record?.value as T | undefined) ?? null;
  } catch (error) {
    console.warn(`Não foi possível ler o cache offline de ${key}.`, error);
    return null;
  }
}
