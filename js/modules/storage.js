// ─── WRAPPER INDEXEDDB ───
// Key-value store semplice su IndexedDB.
// Nome DB e store invariati rispetto a CSVXpressSmart_2026_tran per
// preservare i dati degli utenti installati (cfr. CLAUDE.md §6.2).

const DB_NAME = 'csvxpress_tran_2026';
const DB_VERSION = 1;
const STORE = 'kv';

function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE);
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export async function idbSet(k, v) {
  const db = await openDB();
  return new Promise((r, j) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(v, k);
    tx.oncomplete = r;
    tx.onerror = () => j(tx.error);
  });
}

export async function idbGet(k) {
  const db = await openDB();
  return new Promise((r, j) => {
    const tx = db.transaction(STORE, 'readonly');
    const q = tx.objectStore(STORE).get(k);
    q.onsuccess = () => r(q.result);
    q.onerror = () => j(q.error);
  });
}

export async function idbDel(k) {
  const db = await openDB();
  return new Promise((r, j) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(k);
    tx.oncomplete = r;
    tx.onerror = () => j(tx.error);
  });
}
