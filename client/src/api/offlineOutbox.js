// client/src/api/offlineOutbox.js
//
// IndexedDB-backed FIFO outbox for offline-first restaurant operations.
// Floor devices lose Wi-Fi mid-shift; mutations queued here replay in order
// when connectivity returns. Every queued mutation is idempotent-safe:
//   - checklist toggles: PATCH with explicit isDone
//   - run completion: 404/409 on replay treated as applied
//   - inventory adjustments: server-side clientOperationId dedupe
//   - quiz submit: server 409s on duplicate
//   - audit scores: upsert
//   - audit findings: server-side clientKey dedupe (migration 669)

const DB_NAME = 'oxsteed-ops-outbox';
const STORE = 'outbox';
const VERSION = 1;
const MAX_ATTEMPTS = 5;

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('indexeddb_unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('restaurantId', 'restaurantId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('indexeddb_open_failed'));
  });
}

function tx(db, mode) {
  return db.transaction(STORE, mode).objectStore(STORE);
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('indexeddb_request_failed'));
  });
}

export function newClientKey() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `key-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// True only when the request never reached the server (offline, DNS, timeout).
// A 5xx DID reach the server and may have applied: never queue those.
export function isNetworkFailure(err) {
  return !!err && !err.response;
}

export async function queueMutation({ restaurantId, method, url, body }) {
  const db = await openDb();
  const entry = {
    restaurantId: Number(restaurantId),
    method,
    url,
    body: body || {},
    attempts: 0,
    createdAt: new Date().toISOString(),
  };
  const id = await reqToPromise(tx(db, 'readwrite').add(entry));
  db.close();
  return id;
}

export async function listPending(restaurantId) {
  const db = await openDb();
  const idx = tx(db, 'readonly').index('restaurantId');
  const entries = await reqToPromise(idx.getAll(Number(restaurantId)));
  db.close();
  return entries.sort((a, b) => a.id - b.id);
}

export async function countPending(restaurantId) {
  const db = await openDb();
  const idx = tx(db, 'readonly').index('restaurantId');
  const n = await reqToPromise(idx.count(Number(restaurantId)));
  db.close();
  return n;
}

async function removeEntry(id) {
  const db = await openDb();
  await reqToPromise(tx(db, 'readwrite').delete(id));
  db.close();
}

async function bumpAttempts(entry) {
  const db = await openDb();
  await reqToPromise(tx(db, 'readwrite').put({ ...entry, attempts: (entry.attempts || 0) + 1 }));
  db.close();
}

// Replay queued mutations in FIFO order. Stops at the first entry that cannot
// be resolved yet (network/auth failure); drops entries that can never apply
// (other 4xx) or exhausted their retries so one poisoned entry cannot wedge
// the queue forever. Returns { sent, dropped, remaining }.
export async function flushOutbox(restaurantId, requestFn) {
  const entries = await listPending(restaurantId);
  let sent = 0;
  let dropped = 0;
  for (const entry of entries) {
    try {
      await requestFn({ method: entry.method, url: entry.url, data: entry.body });
      await removeEntry(entry.id);
      sent += 1;
      continue;
    } catch (err) {
      const status = err && err.response ? err.response.status : 0;
      if (status === 409 || status === 404) {
        // Already applied server-side (duplicate replay); intent achieved.
        await removeEntry(entry.id);
        sent += 1;
        continue;
      }
      const attempts = (entry.attempts || 0) + 1;
      if (attempts >= MAX_ATTEMPTS) {
        // Safety valve: one poisoned entry must not wedge the queue forever.
        await removeEntry(entry.id);
        dropped += 1;
        continue;
      }
      if (!err.response || status === 401 || status === 403 || status >= 500) {
        // Not resolvable right now: keep queued, stop the flush.
        await bumpAttempts(entry);
        break;
      }
      // Other 4xx: the mutation itself is invalid; drop it rather than
      // blocking everything behind it.
      await removeEntry(entry.id);
      dropped += 1;
    }
  }
  return { sent, dropped, remaining: await countPending(restaurantId) };
}

export async function clearOutbox(restaurantId) {
  const entries = await listPending(restaurantId);
  await Promise.all(entries.map((e) => removeEntry(e.id)));
  return entries.length;
}
