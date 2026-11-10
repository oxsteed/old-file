'use strict';
// Postgres LISTEN/NOTIFY wakeups for outbox pollers (cost audit 2026-11-04
// item 7). A poller subscribes to its outbox channel and runs its drain
// the moment a row commits, instead of polling every few seconds; the
// interval tick remains as a slow safety sweep.
//
// One dedicated client serves every subscriber in the process. If the
// connection drops it reconnects with backoff and re-LISTENs; if LISTEN is
// unavailable entirely (no DATABASE_URL, connection refused), subscribers
// simply never fire and the safety sweeps keep working. Never throws from
// a notification callback into the pg client.
//
// The last unsubscribe (and stop()) must end that client. Leaving it
// open after every subscriber has gone keeps a live TCP handle, which
// hangs Jest under CI's `--detectOpenHandles` (no `--forceExit`) and
// leaks a connection on graceful API shutdown.
const { Client } = require('pg');
const { getDatabaseSslConfig } = require('./databaseConfig');
const logger = require('./logger');

const listeners = new Map(); // channel -> Set<callback>
let client = null;
let connecting = null;
let reconnectTimer = null;
let backoffMs = 1000;

function channelValid(channel) {
  return /^[a-z0-9_]{1,63}$/.test(channel);
}

function getStatus() {
  return {
    connected: !!client,
    connecting: !!connecting,
    channels: [...listeners.keys()],
  };
}

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function scheduleReconnect() {
  if (reconnectTimer || !listeners.size) return;
  const delay = backoffMs;
  backoffMs = Math.min(backoffMs * 2, 30000);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect().catch(() => {});
  }, delay);
  reconnectTimer.unref?.();
}

function endClient(c) {
  if (!c) return Promise.resolve();
  return c.end().catch(() => {});
}

// Close the dedicated LISTEN client and cancel reconnect when nobody
// is subscribed. An in-flight connect() sees the empty listener map
// (or that client was cleared) and ends the socket itself.
function closeIfIdle() {
  if (listeners.size) return;
  clearReconnectTimer();
  backoffMs = 1000;
  const c = client;
  client = null;
  if (c) return endClient(c);
  return Promise.resolve();
}

async function connect() {
  if (client) return client;
  if (connecting) return connecting;
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  connecting = (async () => {
    const c = new Client({
      connectionString: url,
      ssl: getDatabaseSslConfig(url, process.env.NODE_ENV),
    });
    c.on('notification', (msg) => {
      const set = listeners.get(msg.channel);
      if (set) {
        for (const cb of [...set]) {
          try {
            cb(msg.payload);
          } catch (err) {
            logger.warn('notify wakeup callback failed', { channel: msg.channel, message: err.message });
          }
        }
      }
    });
    const drop = () => {
      if (client === c) client = null;
      scheduleReconnect();
    };
    c.on('error', drop);
    c.on('end', drop);
    await c.connect();
    if (!listeners.size) {
      await endClient(c);
      return null;
    }
    for (const channel of listeners.keys()) {
      await c.query(`LISTEN ${channel}`);
    }
    if (!listeners.size) {
      await endClient(c);
      return null;
    }
    client = c;
    backoffMs = 1000;
    return c;
  })();
  try {
    const c = await connecting;
    return c;
  } catch (err) {
    logger.warn('notify wakeup unavailable, polling continues', { message: err.message });
    scheduleReconnect();
    return null;
  } finally {
    connecting = null;
  }
}

function subscribe(channel, callback) {
  if (!channelValid(channel)) throw new Error('invalid notify channel');
  if (!listeners.has(channel)) listeners.set(channel, new Set());
  listeners.get(channel).add(callback);
  if (client) client.query(`LISTEN ${channel}`).catch(() => {});
  else connect().catch(() => {});
  let done = false;
  return () => {
    if (done) return;
    done = true;
    const set = listeners.get(channel);
    if (set) {
      set.delete(callback);
      if (!set.size) {
        listeners.delete(channel);
        if (listeners.size && client) client.query(`UNLISTEN ${channel}`).catch(() => {});
      }
    }
    if (!listeners.size) closeIfIdle();
  };
}

function stop() {
  listeners.clear();
  const closing = closeIfIdle();
  connecting = null;
  return closing;
}

module.exports = { subscribe, stop, getStatus };
