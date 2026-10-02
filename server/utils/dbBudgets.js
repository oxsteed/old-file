'use strict';

/**
 * E04 — DB workload budgets.
 *
 * Every part of the app shares one pg Pool. Without guardrails a single
 * runaway export or a pile of cron workers can saturate the pool and take
 * the web tier down with it. This module provides:
 *
 *  - Named workload budgets (web / jobs / exports / realtime). withDbBudget()
 *    runs work under a per-workload semaphore. When the budget is exhausted
 *    the call FAILS CLOSED with DbBudgetExhaustedError (HTTP 503 at the
 *    edge) instead of queueing behind the pool forever.
 *  - budgetedQuery(): runs one query with a session-level statement_timeout
 *    so Postgres kills runaways server-side, then RESETs the timeout before
 *    releasing the pooled connection so the next workload gets a clean
 *    session.
 *  - Unknown workloads fail closed: there is no silent unbounded default.
 *
 * These are logical operation budgets, not physical pools: the pg Pool max
 * remains the hard ceiling. Tune via DB_BUDGET_<NAME>_MAX,
 * DB_BUDGET_<NAME>_QUEUE_TIMEOUT_MS and
 * DB_BUDGET_<NAME>_STATEMENT_TIMEOUT_MS.
 */

const logger = require('./logger');

class DbBudgetExhaustedError extends Error {
  constructor(workload, maxConcurrent, waitMs) {
    super(
      `DB budget exhausted for workload "${workload}" ` +
      `(max ${maxConcurrent} concurrent, waited ${waitMs}ms)`
    );
    this.name = 'DbBudgetExhaustedError';
    this.code = 'DB_BUDGET_EXHAUSTED';
    this.workload = workload;
    this.statusCode = 503;
  }
}

function envInt(name, fallback, { min = 1, max = 1000000 } = {}) {
  const raw = Number.parseInt(process.env[name], 10);
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, raw));
}

const DEFAULT_BUDGETS = {
  web:      { maxConcurrent: 8, queueTimeoutMs: 5000,  statementTimeoutMs: 30000 },
  jobs:     { maxConcurrent: 4, queueTimeoutMs: 10000, statementTimeoutMs: 60000 },
  exports:  { maxConcurrent: 2, queueTimeoutMs: 15000, statementTimeoutMs: 120000 },
  realtime: { maxConcurrent: 4, queueTimeoutMs: 5000,  statementTimeoutMs: 30000 },
};

const budgetConfigs = new Map();
const budgetState = new Map(); // name -> { active, queue: [waiter] }

function loadBudgetConfig(name) {
  const defaults = DEFAULT_BUDGETS[name];
  if (!defaults) return null;
  const prefix = `DB_BUDGET_${name.toUpperCase()}_`;
  return {
    maxConcurrent: envInt(`${prefix}MAX`, defaults.maxConcurrent, { min: 1, max: 1000 }),
    queueTimeoutMs: envInt(`${prefix}QUEUE_TIMEOUT_MS`, defaults.queueTimeoutMs, { min: 0, max: 120000 }),
    statementTimeoutMs: envInt(`${prefix}STATEMENT_TIMEOUT_MS`, defaults.statementTimeoutMs, { min: 1000, max: 600000 }),
  };
}

function getBudgetConfig(name) {
  if (!budgetConfigs.has(name)) {
    const config = loadBudgetConfig(name);
    if (!config) {
      const err = new Error(`Unknown DB workload "${name}": refusing to run without a budget`);
      err.code = 'UNKNOWN_DB_WORKLOAD';
      err.statusCode = 500;
      throw err;
    }
    budgetConfigs.set(name, config);
  }
  return budgetConfigs.get(name);
}

/**
 * Override a budget's config at runtime (tests, ops tuning), or register a
 * new named workload explicitly. Merges over the env-derived config.
 * Note: withDbBudget() still fails closed for workloads that were never
 * configured or registered.
 */
function configureBudget(name, overrides = {}) {
  let base = null;
  try {
    base = getBudgetConfig(name);
  } catch (err) {
    if (err.code !== 'UNKNOWN_DB_WORKLOAD') throw err;
  }
  const merged = {
    maxConcurrent: 4,
    queueTimeoutMs: 5000,
    statementTimeoutMs: 30000,
    ...(base || {}),
    ...overrides,
  };
  budgetConfigs.set(name, merged);
  return merged;
}

function getState(name) {
  if (!budgetState.has(name)) budgetState.set(name, { active: 0, queue: [] });
  return budgetState.get(name);
}

function acquireBudgetSlot(name, { timeoutMs } = {}) {
  const config = getBudgetConfig(name);
  const state = getState(name);
  const waitMs = timeoutMs !== undefined ? timeoutMs : config.queueTimeoutMs;

  return new Promise((resolve, reject) => {
    const tryAcquire = () => {
      if (state.active < config.maxConcurrent) {
        state.active += 1;
        resolve();
        return true;
      }
      return false;
    };
    if (tryAcquire()) return;

    const waiter = { tryAcquire };
    waiter.timer = setTimeout(() => {
      const idx = state.queue.indexOf(waiter);
      if (idx >= 0) state.queue.splice(idx, 1);
      logger.warn('DB budget exhausted; failing closed', {
        workload: name,
        maxConcurrent: config.maxConcurrent,
        waitMs,
      });
      reject(new DbBudgetExhaustedError(name, config.maxConcurrent, waitMs));
    }, waitMs);
    if (waiter.timer.unref) waiter.timer.unref();
    waiter.cancel = () => clearTimeout(waiter.timer);
    state.queue.push(waiter);
  });
}

function releaseBudgetSlot(name) {
  const state = getState(name);
  if (state.active > 0) state.active -= 1;
  while (state.queue.length > 0) {
    const waiter = state.queue.shift();
    waiter.cancel();
    if (waiter.tryAcquire()) break;
  }
}

/**
 * Run fn while holding one slot of the named workload budget.
 * Throws DbBudgetExhaustedError when the budget is exhausted (fail closed).
 */
async function withDbBudget(name, fn, opts = {}) {
  await acquireBudgetSlot(name, opts);
  try {
    return await fn();
  } finally {
    releaseBudgetSlot(name);
  }
}

function getPool() {
  return require('../db');
}

/**
 * Run a single query under the workload budget with a session-level
 * statement_timeout. The timeout is RESET before the pooled connection is
 * released so the next workload gets a clean session.
 */
async function budgetedQuery(name, text, params = [], opts = {}) {
  const config = getBudgetConfig(name);
  return withDbBudget(name, async () => {
    const pool = getPool();
    const client = await pool.connect();
    const timeoutMs = Math.max(1000, Math.floor(Number(opts.statementTimeoutMs || config.statementTimeoutMs)));
    try {
      await client.query(`SET statement_timeout = ${timeoutMs}`);
      return await client.query(text, params);
    } finally {
      try {
        await client.query('RESET statement_timeout');
      } catch (resetErr) {
        logger.warn('Failed to reset statement_timeout on pooled connection', {
          workload: name,
          error: resetErr.message,
        });
      }
      client.release();
    }
  }, opts);
}

/** Test/ops introspection: current semaphore state for a workload. */
function getBudgetState(name) {
  getBudgetConfig(name);
  const state = getState(name);
  return { active: state.active, queued: state.queue.length };
}

module.exports = {
  DbBudgetExhaustedError,
  DEFAULT_BUDGETS,
  getBudgetConfig,
  configureBudget,
  withDbBudget,
  budgetedQuery,
  getBudgetState,
};
