'use strict';

/**
 * V2-P1-07 — reusable circuit breaker for external providers.
 *
 * One breaker per provider name. State is shared across processes in Redis
 * (hash per provider: state, failures, openedAt, halfOpenCalls) when REDIS_URL
 * is configured; otherwise it falls back to a bounded in-memory map, which is
 * documented single-instance only (same fallback policy as utils/processState).
 *
 * States: closed (traffic flows) -> open (calls fail fast) ->
 * half-open (limited trial calls) -> closed on success / open on failure.
 *
 * The in-memory fallback map is registered in utils/processStateRegistry.js
 * as a 'semaphore' (per-process failure guard).
 */

const redis = require('./redis');
const logger = require('./logger');

const STATES = Object.freeze({
  CLOSED: 'closed',
  OPEN: 'open',
  HALF_OPEN: 'half_open',
});

// In-memory fallback for single-process dev/test. Bounded: entries expire on
// read when the open window has elapsed, and the map is capped.
const localStates = new Map();
const LOCAL_MAX_ENTRIES = 256;

function freshState() {
  return { state: STATES.CLOSED, failures: 0, openedAt: 0, halfOpenCalls: 0 };
}

function pruneLocal(key) {
  const entry = localStates.get(key);
  if (!entry) return null;
  return entry;
}

function rememberLocal(key, state) {
  if (!localStates.has(key) && localStates.size >= LOCAL_MAX_ENTRIES) {
    const oldest = localStates.keys().next();
    if (!oldest.done) localStates.delete(oldest.value);
  }
  localStates.set(key, state);
}

function createCircuitBreaker(name, options = {}) {
  const config = Object.freeze({
    failureThreshold: Math.max(1, Number(options.failureThreshold) || 5),
    resetTimeoutMs: Math.max(1000, Number(options.resetTimeoutMs) || 30000),
    halfOpenMaxCalls: Math.max(1, Number(options.halfOpenMaxCalls) || 1),
    successThreshold: Math.max(1, Number(options.successThreshold) || 1),
    namespace: String(options.namespace || 'provider-circuit:v1'),
  });
  const key = `${config.namespace}:${name}`;

  async function readState() {
    if (redis) {
      try {
        const raw = await redis.hgetall(key);
        if (!raw || !raw.state) return freshState();
        return {
          state: raw.state,
          failures: Number(raw.failures || 0),
          openedAt: Number(raw.openedAt || 0),
          halfOpenCalls: Number(raw.halfOpenCalls || 0),
        };
      } catch (err) {
        logger.warn('CircuitBreaker: Redis read failed, using in-memory fallback', {
          name, error: err.message,
        });
      }
    }
    return pruneLocal(key) || freshState();
  }

  async function writeState(next) {
    if (redis) {
      try {
        await redis.hset(key, {
          state: next.state,
          failures: String(next.failures),
          openedAt: String(next.openedAt),
          halfOpenCalls: String(next.halfOpenCalls),
        });
        // Keep breaker state from living forever: it is only meaningful for
        // the duration of the open window plus a margin.
        await redis.expire(key, Math.ceil(config.resetTimeoutMs / 1000) * 4 + 60);
        return;
      } catch (err) {
        logger.warn('CircuitBreaker: Redis write failed, using in-memory fallback', {
          name, error: err.message,
        });
      }
    }
    rememberLocal(key, next);
  }

  // Promote an elapsed open breaker to half-open before deciding.
  function settle(state) {
    if (state.state === STATES.OPEN && Date.now() - state.openedAt >= config.resetTimeoutMs) {
      return { ...state, state: STATES.HALF_OPEN, halfOpenCalls: 0 };
    }
    return state;
  }

  async function allowRequest() {
    const state = settle(await readState());
    if (state.state === STATES.OPEN) return { allowed: false, state: STATES.OPEN };
    if (state.state === STATES.HALF_OPEN) {
      if (state.halfOpenCalls >= config.halfOpenMaxCalls) {
        return { allowed: false, state: STATES.HALF_OPEN };
      }
      const next = { ...state, halfOpenCalls: state.halfOpenCalls + 1 };
      await writeState(next);
      return { allowed: true, state: STATES.HALF_OPEN };
    }
    return { allowed: true, state: STATES.CLOSED };
  }

  async function recordSuccess() {
    const state = await readState();
    if (state.state === STATES.HALF_OPEN) {
      // Half-open trial succeeded: close the circuit.
      await writeState(freshState());
      logger.info('CircuitBreaker: closed after successful half-open trial', { name });
    } else if (state.failures !== 0) {
      await writeState({ ...state, failures: 0 });
    }
  }

  async function recordFailure() {
    const state = await readState();
    if (state.state === STATES.HALF_OPEN) {
      const next = { ...freshState(), state: STATES.OPEN, openedAt: Date.now() };
      await writeState(next);
      logger.warn('CircuitBreaker: reopened after failed half-open trial', { name });
      return next;
    }
    const failures = state.failures + 1;
    if (failures >= config.failureThreshold) {
      const next = { state: STATES.OPEN, failures, openedAt: Date.now(), halfOpenCalls: 0 };
      await writeState(next);
      logger.warn('CircuitBreaker: opened', { name, failures });
      return next;
    }
    await writeState({ ...state, failures });
    return { ...state, failures };
  }

  async function getState() {
    const state = settle(await readState());
    return { name, state: state.state, failures: state.failures, openedAt: state.openedAt, config };
  }

  async function reset() {
    await writeState(freshState());
    logger.info('CircuitBreaker: manually reset', { name });
  }

  /**
   * Run fn through the breaker. When the circuit is open the call fails fast
   * with a typed error instead of hitting the provider.
   */
  async function execute(fn) {
    const gate = await allowRequest();
    if (!gate.allowed) {
      const err = new Error(`Circuit breaker is ${gate.state} for provider "${name}"`);
      err.code = 'circuit_open';
      err.provider = name;
      err.circuitState = gate.state;
      throw err;
    }
    try {
      const result = await fn();
      await recordSuccess();
      return result;
    } catch (err) {
      await recordFailure();
      throw err;
    }
  }

  return Object.freeze({
    name,
    config,
    allowRequest,
    recordSuccess,
    recordFailure,
    getState,
    reset,
    execute,
  });
}

module.exports = { createCircuitBreaker, CIRCUIT_STATES: STATES, _localStates: localStates };
