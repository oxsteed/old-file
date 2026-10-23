const pending = new Map();

/** Consume the bounded, local-only OS share once, including StrictMode remounts. */
export function takeSharedJobDraft(id) {
  if (!/^[a-f0-9-]{36}$/i.test(id || ''))
    return Promise.reject(new Error('Invalid share'));
  if (pending.has(id)) return pending.get(id);
  const promise = new Promise((resolve, reject) => {
    const open = indexedDB.open('oxsteed-share-target', 1);
    open.onupgradeneeded = () =>
      open.result.createObjectStore('drafts', { keyPath: 'id' });
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('drafts', 'readwrite'),
        store = tx.objectStore('drafts');
      const get = store.get(id);
      let value;
      get.onsuccess = () => {
        value = get.result;
        store.delete(id);
      };
      tx.oncomplete = () => {
        db.close();
        if (!value || value.createdAt < Date.now() - 30 * 60000)
          reject(new Error('Share expired'));
        else resolve(value);
      };
      tx.onabort = tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    };
  });
  pending.set(id, promise);
  // Retain only the in-flight hand-off briefly for React's development remount.
  promise.then(
    () => setTimeout(() => pending.delete(id), 1000),
    () => pending.delete(id),
  );
  return promise;
}
