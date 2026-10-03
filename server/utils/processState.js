'use strict';

/**
 * V2-P1-06 — uniform contract for process-local state.
 *
 * Problem: with more than one Node process (web + workers, or scaled
 * replicas), any authoritative state kept in a module-scope Map/Set is
 * invisible to the other processes. Leases, throttles, and idempotency
 * keys kept in-process silently double-fire: two processes both believe
 * they hold the slot.
 *
 * Contract every module must follow:
 *
 *   1. Classify every module-scope Map/Set with one of CLASSIFICATIONS
 *      and register it in utils/processStateRegistry.js. The
 *      processStateInventory test fails CI when a mutated module-scope
 *      Map/Set is not registered, so new code cannot regress silently.
 *
 *   2. cache ......... may stay in-process. Must be TTL-bounded (and
 *      size-bounded). Use createTtlCache(). Staleness is bounded by
 *      the TTL, which is safe because the backing store is the DB.
 *
 *   3. lease ......... MUST live in Redis (or PostgreSQL) with a TTL.
 *      Use tryAcquireOnce() (SET NX EX fencing). Never a Map.
 *
 *   4. throttle ...... MUST live in Redis with a TTL window.
 *      Use throttleOnce(). Never a Map.
 *
 *   5. idempotency ... MUST live in Redis (fencing) or PostgreSQL
 *      (unique constraint / ON CONFLICT). Use tryAcquireOnce() for the
 *      burst fence; the DB row stays the long-term source of truth.
 *
 *   6. security-list . revocation/allow lists. Redis-primary with a
 *      TTL-bounded in-memory fallback (documented single-instance only).
 *
 *   7. semaphore ..... per-process concurrency guards (e.g. DB budget
 *      semaphores guarding the process's own pg pool). Correct
 *      in-process; register with rationale.
 *
 *   8. ephemeral ..... socket handles, in-flight guards. Die with the
 *      process by design. Register with rationale.
 *
 * Redis fallback policy: when no Redis client is configured
 * (single-process dev/test), fencing helpers degrade to a bounded
 * in-memory fence with the same TTL semantics and log once. This
 * preserves the old behavior; production must set REDIS_URL.
 * On a Redis *error* the helpers log and fall back to the in-memory
 * fence rather than failing the request, except when the caller passes
 * { failClosed: true }.
 */

const logger = require('./logger');

const CLASSIFICATIONS = Object.freeze({
  CACHE: 'cache',
  LEASE: 'lease',
  THROTTLE: 'throttle',
  IDEMPOTENCY: 'idempotency',
  SECURITY_LIST: 'security-list',
  SEMAPHORE: 'semaphore',
  EPHEMERAL: 'ephemeral',
  CONSTANT: 'constant',
});

const CLASSIFICATION_VALUES = new Set(Object.values(CLASSIFICATIONS));

// ── Registry ────────────────────────────────────────────────────────────────

const registry = [];

/**
 * Register one module-scope Map/Set.
 * @param {object} entry
 * @param {string} entry.file           path relative to server/, e.g. 'services/socketService.js'
 * @param {string} entry.name           variable name, e.g. 'onlineMap'
 * @param {string} entry.classification one of CLASSIFICATIONS
 * @param {string} entry.shared        'redis' | 'postgres' | 'none' — where the authoritative copy lives
 * @param {string} entry.rationale      why this classification is correct
 */
function registerProcessState(entry) {
  if (!entry || typeof entry !== 'object') {
    throw new TypeError('registerProcessState requires an entry object');
  }
  const { file, name, classification, shared, rationale } = entry;
  if (typeof file !== 'string' || !file) throw new TypeError('entry.file is required');
  if (typeof name !== 'string' || !name) throw new TypeError('entry.name is required');
  if (!CLASSIFICATION_VALUES.has(classification)) {
    throw new TypeError(`entry.classification must be one of ${[...CLASSIFICATION_VALUES].join(', ')}`);
  }
  if (!['redis', 'postgres', 'none'].includes(shared)) {
    throw new TypeError("entry.shared must be 'redis', 'postgres' or 'none'");
  }
  if (typeof rationale !== 'string' || !rationale.trim()) {
    throw new TypeError('entry.rationale is required');
  }
  if (registry.some((e) => e.file === file && e.name === name)) {
    throw new Error(`duplicate process-state registration: ${file}#${name}`);
  }
  registry.push(Object.freeze({ file, name, classification, shared, rationale: rationale.trim() }));
}

function getProcessStateRegistry() {
  return [...registry];
}

// ── Shared Redis accessor (injectable for tests) ─────────────────────────────

let injectedRedis = null; // test hook
let redisWarned = false;

function getRedis() {
  if (injectedRedis) return injectedRedis;
  try {
    return require('./redis');
  } catch (err) {
    return null;
  }
}

function warnSingleProcess(feature) {
  if (redisWarned) return;
  redisWarned = true;
  logger.warn(
    'processState: Redis unavailable — fencing is process-local only. Not suitable for multi-instance deployments.',
    { feature }
  );
}

// ── TTL cache factory (classification: cache) ────────────────────────────────

const DEFAULT_CACHE_MAX_ENTRIES = 1000;

/**
 * Bounded TTL cache for pure read-through caches.
 * Stale reads are bounded by ttlMs; the backing store stays the DB.
 */
function createTtlCache({ name, ttlMs, maxEntries = DEFAULT_CACHE_MAX_ENTRIES } = {}) {
  if (!name || typeof name !== 'string') throw new TypeError('createTtlCache requires a name');
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new TypeError('createTtlCache requires a positive ttlMs');
  if (!Number.isFinite(maxEntries) || maxEntries <= 0) {
    throw new TypeError('createTtlCache requires a positive maxEntries');
  }
  const store = new Map();

  function evictIfNeeded() {
    if (store.size < maxEntries) return;
    // Drop expired entries first, then oldest-inserted.
    const now = Date.now();
    for (const [k, e] of store) {
      if (e.exp <= now) store.delete(k);
      if (store.size < maxEntries) return;
    }
    const oldest = store.keys().next();
    if (!oldest.done) store.delete(oldest.value);
  }

  return {
    name,
    get(key) {
      const e = store.get(key);
      if (!e) return undefined;
      if (e.exp <= Date.now()) {
        store.delete(key);
        return undefined;
      }
      return e.value;
    },
    has(key) {
      const e = store.get(key);
      if (!e) return false;
      if (e.exp <= Date.now()) {
        store.delete(key);
        return false;
      }
      return true;
    },
    set(key, value, ttlOverrideMs) {
      const ttl = ttlOverrideMs !== undefined ? ttlOverrideMs : ttlMs;
      if (!store.has(key)) evictIfNeeded();
      store.set(key, { value, exp: Date.now() + Math.max(1, ttl) });
    },
    delete(key) {
      return store.delete(key);
    },
    clear() {
      store.clear();
    },
    get size() {
      return store.size;
    },
  };
}

// ── Fencing / throttling (classifications: lease, throttle, idempotency) ────

const MEMORY_FENCE_CAP = 10000;
const memoryFences = new Map(); // fullKey -> expiresAtMs (single-process fallback only)

function memoryFenceAcquire(fullKey, ttlMs) {
  const now = Date.now();
  const exp = memoryFences.get(fullKey);
  if (exp !== undefined) {
    if (exp > now) return false;
    memoryFences.delete(fullKey);
  }
  memoryFences.set(fullKey, now + ttlMs);
  if (memoryFences.size > MEMORY_FENCE_CAP) {
    for (const [k, e] of memoryFences) {
      if (e <= now) memoryFences.delete(k);
      if (memoryFences.size <= MEMORY_FENCE_CAP) break;
    }
    while (memoryFences.size > MEMORY_FENCE_CAP) {
      const oldest = memoryFences.keys().next();
      if (oldest.done) break;
      memoryFences.delete(oldest.value);
    }
  }
  return true;
}

function clearMemoryFences() {
  memoryFences.clear();
}

/**
 * Cross-process mutual exclusion: only one caller across all processes
 * acquires the key within the TTL window. Implemented as Redis
 * SET key 1 EX ttl NX. Returns true when THIS caller won the slot.
 *
 * @param {string} key        fence identity (without namespace prefix)
 * @param {number} ttlSeconds how long the winner holds the slot
 * @param {object} [opts]
 * @param {string} [opts.namespace='fence'] key namespace: ps:<namespace>:<key>
 * @param {boolean} [opts.failClosed=false] when true, a Redis error returns
 *   false (deny) instead of degrading to the in-memory fence
 * @param {object|null} [opts.redis] explicit client (tests); undefined = shared
 */
async function tryAcquireOnce(key, ttlSeconds, opts = {}) {
  const { namespace = 'fence', failClosed = false, redis: explicitRedis } = opts;
  if (typeof key !== 'string' || !key) throw new TypeError('tryAcquireOnce requires a key');
  const rawTtl = Number(ttlSeconds);
  if (!Number.isFinite(rawTtl) || rawTtl <= 0) throw new TypeError('tryAcquireOnce requires a positive ttlSeconds');
  const ttl = Math.max(1, Math.ceil(rawTtl));
  const fullKey = `ps:${namespace}:${key}`;

  const redis = explicitRedis !== undefined ? explicitRedis : getRedis();
  if (!redis) {
    warnSingleProcess(namespace);
    return memoryFenceAcquire(fullKey, ttl * 1000);
  }
  try {
    const res = await redis.set(fullKey, '1', 'EX', ttl, 'NX');
    return res === 'OK';
  } catch (err) {
    logger.warn('processState: Redis fence failed', { key: fullKey, error: err.message });
    if (failClosed) return false;
    return memoryFenceAcquire(fullKey, ttl * 1000);
  }
}

/**
 * Release a fence previously won with tryAcquireOnce. Used when the
 * fenced operation failed before completing, so a retry is not mistaken
 * for a duplicate.
 */
async function releaseFence(key, opts = {}) {
  const { namespace = 'fence', redis: explicitRedis } = opts;
  if (typeof key !== 'string' || !key) throw new TypeError('releaseFence requires a key');
  const fullKey = `ps:${namespace}:${key}`;
  const redis = explicitRedis !== undefined ? explicitRedis : getRedis();
  if (!redis) {
    memoryFences.delete(fullKey);
    return;
  }
  try {
    await redis.del(fullKey);
  } catch (err) {
    logger.warn('processState: Redis fence release failed', { key: fullKey, error: err.message });
  }
}

/**
 * Cross-process throttle: returns true when the caller is ALLOWED to act
 * (first call in the window), false when throttled. Implemented on top of
 * tryAcquireOnce with a TTL window.
 */
async function throttleOnce(key, windowSeconds, opts = {}) {
  return tryAcquireOnce(key, windowSeconds, { namespace: 'throttle', ...opts });
}

// ── Test hooks ─────────────────────────────────────────────────────────────

function _injectRedis(client) {
  injectedRedis = client;
}

function _resetForTests() {
  injectedRedis = null;
  redisWarned = false;
  memoryFences.clear();
}

module.exports = {
  CLASSIFICATIONS,
  registerProcessState,
  getProcessStateRegistry,
  createTtlCache,
  tryAcquireOnce,
  releaseFence,
  throttleOnce,
  clearMemoryFences,
  _injectRedis,
  _resetForTests,
};
