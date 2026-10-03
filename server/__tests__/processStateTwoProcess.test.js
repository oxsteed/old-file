'use strict';

/**
 * V2-P1-06 — two-process correctness tests.
 *
 * Spawns two REAL Node processes (child_process.fork, distinct pids) that
 * share one fake Redis (a minimal in-test RESP server). Each process runs
 * the real production code paths:
 *
 *   - processState.tryAcquireOnce / throttleOnce (fencing contract)
 *   - realtimePresence markOnline / markOffline / refreshSnapshot / isOnline
 *
 * This proves the cross-instance behavior: with two processes racing, only
 * one wins a fence, only one passes a throttle window, and a presence
 * announcement from process A is visible to process B (and withdrawn
 * cleanly afterwards).
 */

const { fork } = require('child_process');
const path = require('path');

const { FakeRespRedis } = require('./helpers/fakeRespRedis');

const WORKER_PATH = path.join(__dirname, 'helpers', 'twoProcessWorker.js');
const WORKER_TIMEOUT_MS = 15000;

class Worker {
  constructor(task, redisUrl) {
    this.task = task;
    this.child = fork(WORKER_PATH, [], {
      env: { ...process.env, REDIS_URL: redisUrl, WORKER_TASK: task },
      silent: true,
    });
    // Drain piped stdio so a chatty logger can never block the worker.
    this.child.stdout?.on('data', () => {});
    this.child.stderr?.on('data', () => {});
    this.pending = [];
    this.readyResolve = null;
    this.ready = new Promise((resolve) => { this.readyResolve = resolve; });
    this.child.on('message', (msg) => {
      if (!msg) return;
      if (msg.type === 'ready') {
        this.readyResolve();
        return;
      }
      if (msg.type === 'result') {
        const waiter = this.pending.shift();
        if (waiter) waiter(msg);
      }
    });
    this.child.on('error', (err) => {
      while (this.pending.length) this.pending.shift()({ error: err.message });
    });
  }

  async start() {
    const timer = setTimeout(() => {
      throw new Error(`worker ${this.task} never became ready`);
    }, WORKER_TIMEOUT_MS);
    timer.unref();
    await this.ready;
    clearTimeout(timer);
  }

  go(phase = 'go') {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`worker ${this.task} timed out on ${phase}`)), WORKER_TIMEOUT_MS);
      timer.unref();
      this.pending.push((msg) => {
        clearTimeout(timer);
        if (msg.error) reject(new Error(`worker ${this.task}: ${msg.error}`));
        else resolve(msg);
      });
      this.child.send({ type: phase });
    });
  }

  stop() {
    this.child.kill('SIGKILL');
  }
}

describe('process-state across two processes (V2-P1-06)', () => {
  let fake;
  let redisUrl;
  const workers = [];

  beforeAll(async () => {
    fake = new FakeRespRedis();
    const port = await fake.start();
    redisUrl = `redis://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    for (const w of workers) w.stop();
    await fake.close();
  });

  function spawn(task) {
    const w = new Worker(task, redisUrl);
    workers.push(w);
    return w;
  }

  test('fence: exactly one of two racing processes wins tryAcquireOnce', async () => {
    const a = spawn('fence');
    const b = spawn('fence');
    await Promise.all([a.start(), b.start()]);

    // Release both racers as close together as possible.
    const pa = a.go();
    const pb = b.go();
    const [ra, rb] = await Promise.all([pa, pb]);

    const wins = [ra.won, rb.won].filter(Boolean).length;
    expect(wins).toBe(1);
  }, 30000);

  test('throttle: exactly one of two processes passes throttleOnce per window', async () => {
    const a = spawn('throttle');
    const b = spawn('throttle');
    await Promise.all([a.start(), b.start()]);

    const pa = a.go();
    const pb = b.go();
    const [ra, rb] = await Promise.all([pa, pb]);

    const passes = [ra.allowed, rb.allowed].filter(Boolean).length;
    expect(passes).toBe(1);
  }, 30000);

  test('presence: process B sees process A online, then offline after withdrawal', async () => {
    const a = spawn('presence-a');
    const b = spawn('presence-b');
    await Promise.all([a.start(), b.start()]);

    const announced = await a.go();
    expect(announced.announced).toBe(true);

    const seen = await b.go();
    expect(seen.online).toBe(true);

    const withdrawn = await a.go('go2');
    expect(withdrawn.withdrawn).toBe(true);

    const gone = await b.go('go2');
    expect(gone.online).toBe(false);
  }, 30000);
});
