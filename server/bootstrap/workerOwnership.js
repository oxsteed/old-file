'use strict';

// A PostgreSQL advisory lock is deliberately held on one pool client for the
// lifetime of the background runtime.  Unlike a best-effort per-job lock, this
// makes worker ownership an explicit process-level contract: a replacement can
// boot as a standby, but it cannot execute any background work until the
// previous owner has released its session (including on a hard connection
// failure, where PostgreSQL releases the lock automatically).
const LOCK_KEY = 'oxsteed:background-workers:v1';

class WorkerOwnership {
  constructor({ pool, pollMs = 1000, log = console, mayAcquire = () => true,
    onLeaseLost = () => process.exit(1) } = {}) {
    this.pool = pool;
    this.pollMs = pollMs;
    this.log = log;
    this.mayAcquire = mayAcquire;
    this.onLeaseLost = onLeaseLost;
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
    if (this.owner || this.stopping || !this.mayAcquire()) return this.owner;
    if (!this.pool?.connect) return false;
    const client = await this.pool.connect();
    let retained = false;
    let failure;
    const onError = () => {
      if (this.client !== client) return;
      this.log.error?.('Worker ownership session lost; terminating the worker process');
      this.onLeaseLost();
    };
    client.on?.('error', onError);
    try {
      if (this.stopping) return false;
      const result = await client.query(
        'SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',
        [LOCK_KEY],
      );
      if (result.rows[0]?.acquired !== true) return false;
      // If shutdown began during the lock query, discard the locked session
      // without starting any consumers.
      if (this.stopping) { failure = true; return false; }
      this.client = client;
      if (this.onAcquired) await this.onAcquired();
      this.owner = true;
      this.onConnectionError = onError;
      retained = true;
      clearInterval(this.timer);
      this.timer = null;
      return true;
    } catch (error) {
      failure = error;
      this.client = null;
      throw error;
    } finally {
      if (!retained) {
        client.off?.('error', onError);
        client.release(failure);
      }
    }
  }

  acquire() {
    this.acquireInFlight = this.tryAcquire().finally(() => { this.acquireInFlight = null; });
    return this.acquireInFlight;
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
    if (await this.acquire() || this.stopping) return this.mode;
    this.timer = setInterval(() => {
      if (this.acquireInFlight || this.stopping || this.owner) return;
      void this.acquire().catch(error => this.log.warn?.('Worker ownership retry failed', { error: error.message }));
    }, this.pollMs);
    this.timer.unref?.();
    return this.mode;
  }

  async stop(drain = async () => {}) {
    this.stopping = true;
    clearInterval(this.timer);
    this.timer = null;
    await this.acquireInFlight?.catch(() => {});
    await drain();
    const client = this.client;
    this.client = null;
    this.owner = false;
    this.started = false;
    if (client) {
      let failure;
      try {
        await client.query('SELECT pg_advisory_unlock(hashtext($1))', [LOCK_KEY]);
      } catch (error) { failure = error; }
      client.off?.('error', this.onConnectionError);
      client.release(failure);
    }
  }
}

module.exports = { LOCK_KEY, WorkerOwnership };
