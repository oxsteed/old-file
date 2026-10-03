'use strict';

/**
 * realtimePresence — shared presence contract for the realtime layer.
 *
 * Problem (E02): the support websocket service tracked online agents in a
 * process-local Map. With more than one Node process, process A cannot see
 * agents connected to process B, so routing decisions (and "agent online"
 * badges) are wrong and messages can be silently dropped.
 *
 * Contract:
 *   - markOnline(kind, id)   — this process announces an online entity.
 *   - markOffline(kind, id)  — this process withdraws its announcement.
 *   - isOnline(kind, id)     — synchronous: local registry OR the last
 *                              refreshed cross-process snapshot.
 *   - refreshSnapshot()      — async: pull the shared registry into memory.
 *
 * Storage: when a Redis client is available (utils/redis), presence is kept
 * in Redis hashes `realtime:presence:<kind>:<id>` with one field per process
 * (`hostname:pid`) and a TTL heartbeat. A crashed process stops heartbeating
 * and its fields expire, so stale presence self-heals. When Redis is absent
 * (single-process dev/test), an in-memory registry is used instead and
 * `isOnline` degrades to local-only visibility — this is logged once.
 *
 * This module is intentionally delivery-agnostic: it never throws for Redis
 * failures. Delivery health is tracked separately by the socket service's
 * fail-closed emit path.
 */

const os = require('os');
const logger = require('../utils/logger');

const PROC_ID = `${os.hostname()}:${process.pid}`;
const HEARTBEAT_TTL_SECONDS = 45;
const SNAPSHOT_INTERVAL_MS = 5000;

let injectedRedis = null; // test hook
let redisWarned = false;

function getRedis() {
  if (injectedRedis) return injectedRedis;
  try {
    return require('../utils/redis');
  } catch (err) {
    return null;
  }
}

// `${kind}:${id}` -> local socket/connection count owned by this process.
const localOnline = new Map();
// `${kind}:${id}` -> true, last refreshed from Redis.
let remoteSnapshot = new Map();
let snapshotTimer = null;
let presenceHeartbeatTimer = null;
const PRESENCE_HEARTBEAT_INTERVAL_MS = 15000;

function keyOf(kind, id) {
  return `realtime:presence:${kind}:${String(id)}`;
}

function startSnapshotRefresh() {
  if (snapshotTimer || !getRedis()) return;
  snapshotTimer = setInterval(() => {
    refreshSnapshot().catch((err) => {
      logger.warn('realtimePresence: background snapshot refresh failed', { error: err.message });
    });
  }, SNAPSHOT_INTERVAL_MS);
  if (typeof snapshotTimer.unref === 'function') snapshotTimer.unref();
}

async function markOnline(kind, id, ttlSeconds = HEARTBEAT_TTL_SECONDS) {
  const slot = `${kind}:${id}`;
  localOnline.set(slot, (localOnline.get(slot) || 0) + 1);
  const redis = getRedis();
  if (!redis) {
    if (!redisWarned) {
      redisWarned = true;
      logger.info('realtimePresence: no Redis client, presence is local-process only');
    }
    return true;
  }
  try {
    const key = keyOf(kind, id);
    await redis.hset(key, PROC_ID, String(Date.now()));
    await redis.expire(key, ttlSeconds);
    startSnapshotRefresh();
  } catch (err) {
    logger.warn('realtimePresence: Redis markOnline failed, keeping local registration', {
      kind, id, error: err.message,
    });
  }
  return true;
}

async function markOffline(kind, id) {
  const slot = `${kind}:${id}`;
  const remaining = (localOnline.get(slot) || 1) - 1;
  if (remaining <= 0) localOnline.delete(slot);
  else localOnline.set(slot, remaining);

  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.hdel(keyOf(kind, id), PROC_ID);
  } catch (err) {
    logger.warn('realtimePresence: Redis markOffline failed', { kind, id, error: err.message });
  }
}

/**
 * Re-announce every locally-online entity (heartbeat). Called on an interval
 * by the owning socket service so presence survives TTL expiry while the
 * process is healthy.
 */
async function heartbeat(ttlSeconds = HEARTBEAT_TTL_SECONDS) {
  const redis = getRedis();
  if (!redis || localOnline.size === 0) return;
  try {
    for (const slot of localOnline.keys()) {
      const sep = slot.indexOf(':');
      const kind = slot.slice(0, sep);
      const id = slot.slice(sep + 1);
      const key = keyOf(kind, id);
      await redis.hset(key, PROC_ID, String(Date.now()));
      await redis.expire(key, ttlSeconds);
    }
  } catch (err) {
    logger.warn('realtimePresence: heartbeat failed', { error: err.message });
  }
}

function isOnline(kind, id) {
  const slot = `${kind}:${id}`;
  return localOnline.has(slot) || remoteSnapshot.has(slot);
}

function getOnlineIds(kind) {
  const prefix = `${kind}:`;
  const ids = new Set();
  for (const slot of localOnline.keys()) {
    if (slot.startsWith(prefix)) ids.add(slot.slice(prefix.length));
  }
  for (const slot of remoteSnapshot.keys()) {
    if (slot.startsWith(prefix)) ids.add(slot.slice(prefix.length));
  }
  return [...ids];
}

async function refreshSnapshot() {
  const redis = getRedis();
  if (!redis) return;
  const next = new Map();
  for (const kind of ['agent', 'customer', 'user']) {
    let cursor = '0';
    const match = `realtime:presence:${kind}:*`;
    do {
      // eslint-disable-next-line no-await-in-loop
      const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', match, 'COUNT', 200);
      cursor = String(nextCursor);
      for (const key of keys || []) {
        const id = String(key).slice(`realtime:presence:${kind}:`.length);
        if (id) next.set(`${kind}:${id}`, true);
      }
    } while (cursor !== '0');
  }
  remoteSnapshot = next;
}

function shutdown() {
  if (snapshotTimer) {
    clearInterval(snapshotTimer);
    snapshotTimer = null;
  }
  if (presenceHeartbeatTimer) {
    clearInterval(presenceHeartbeatTimer);
    presenceHeartbeatTimer = null;
  }
  // Best-effort withdrawal of this process's registrations; TTL expiry
  // self-heals anything missed (e.g. a crash between here and Redis).
  const redis = getRedis();
  if (redis) {
    for (const slot of localOnline.keys()) {
      const sep = slot.indexOf(':');
      const key = keyOf(slot.slice(0, sep), slot.slice(sep + 1));
      redis.hdel(key, PROC_ID).catch(() => {});
    }
  }
  localOnline.clear();
  remoteSnapshot = new Map();
}

// ── Test hooks ─────────────────────────────────────────────────────────────
/**
 * Start the process-wide presence heartbeat (idempotent). Re-announces every
 * locally-online entity so Redis TTLs do not expire while the process is
 * healthy. Called once from bootstrap/realtime.js; the support websocket
 * service delegates here instead of owning its own timer.
 */
function startPresenceHeartbeat(intervalMs = PRESENCE_HEARTBEAT_INTERVAL_MS) {
  if (presenceHeartbeatTimer) return;
  presenceHeartbeatTimer = setInterval(() => {
    heartbeat().catch((err) => {
      logger.warn('realtimePresence: heartbeat failed', { error: err.message });
    });
  }, intervalMs);
  if (typeof presenceHeartbeatTimer.unref === 'function') presenceHeartbeatTimer.unref();
}

function _injectRedis(client) {
  injectedRedis = client;
  remoteSnapshot = new Map();
}
function _clearLocal() {
  localOnline.clear();
}
function _resetForTests() {
  injectedRedis = null;
  localOnline.clear();
  remoteSnapshot = new Map();
  redisWarned = false;
  shutdown();
}

module.exports = {
  PROC_ID,
  HEARTBEAT_TTL_SECONDS,
  markOnline,
  markOffline,
  heartbeat,
  isOnline,
  getOnlineIds,
  refreshSnapshot,
  shutdown,
  startPresenceHeartbeat,
  PRESENCE_HEARTBEAT_INTERVAL_MS,
  _injectRedis,
  _clearLocal,
  _resetForTests,
};
