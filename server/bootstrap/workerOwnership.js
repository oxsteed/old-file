'use strict';

// A PostgreSQL advisory lock is deliberately held on one pool client for the
// lifetime of the background runtime.  Unlike a best-effort per-job lock, this
// makes worker ownership an explicit process-level contract: a replacement can
// boot as a standby, but it cannot execute any background work until the
// previous owner has released its session (including on a hard connection
// failure, where PostgreSQL releases the lock automatically).
const LOCK_KEY = 'oxsteed:background-workers:v1';

class WorkerOwnership {
  constructor({ pool, pollMs = 1000, log = console } = {}) {
    this.pool = pool;
    this.pollMs = pollMs;
    this.log = log;
    this.client = null;
    this.owner = false;
    this.started = false;
    this.stopping = false;
    this.timer = null;
    this.acquireInFlight = null;
    this.onAcquired = null;
  }

  get mode() { return this.owner ? 'combined' : 'combined-standby'; }

  async tryAcquire() {
    if (this.owner || this.stopping) return this.owner;
    if (!this.pool?.connect) return false;
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        'SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',
        [LOCK_KEY],
      );
      if (result.rows[0]?.acquired !== true) {
        client.release();
        return false;
      }
      this.client = client;
      this.owner = true;
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
      try {
        if (this.onAcquired) await this.onAcquired();
      } catch (error) {
        this.owner = false;
        this.client = null;
        try { await client.query('SELECT pg_advisory_unlock(hashtext($1))', [LOCK_KEY]); } catch { /* best effort */ }
        try { client.release(); } catch { /* best effort */ }
        throw error;
      }
      return true;
    } catch (error) {
      try { client.release(); } catch { /* best effort */ }
      throw error;
    }
  }

  async start({ onAcquired } = {}) {
    if (this.started) throw new Error('Worker ownership has already started');
    this.started = true;
    this.stopping = false;
    this.onAcquired = onAcquired || null;
    if (!this.pool?.connect) {
      // Unit-test and local callers without a pool retain the historical
      // single-process behavior; production always supplies the DB pool.
      this.owner = true;
      if (this.onAcquired) await this.onAcquired();
      return this.mode;
    }
    if (await this.tryAcquire()) return this.mode;
    this.timer = setInterval(() => {
      if (this.acquireInFlight || this.stopping || this.owner) return;
      this.acquireInFlight = this.tryAcquire()
        .catch(error => this.log.warn?.('Worker ownership retry failed', { error: error.message }))
        .finally(() => { this.acquireInFlight = null; });
    }, this.pollMs);
    this.timer.unref?.();
    return this.mode;
  }

  async stop() {
    this.stopping = true;
    clearInterval(this.timer);
    this.timer = null;
    await this.acquireInFlight;
    const client = this.client;
    this.client = null;
    this.owner = false;
    this.started = false;
    if (client) {
      try {
        await client.query('SELECT pg_advisory_unlock(hashtext($1))', [LOCK_KEY]);
      } catch { /* disconnects already release the lock */ }
      try { client.release(); } catch { /* best effort */ }
    }
  }
}

module.exports = { LOCK_KEY, WorkerOwnership };
