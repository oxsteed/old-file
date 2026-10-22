'use strict';

/**
 * Daily spend guardrail for OpenRouter calls on the AI chat paths.
 *
 * Threat: the public unauthenticated support chat (20 msgs / 10 min per IP)
 * calls OpenRouter first in its provider chain. If a paid OpenRouter model
 * is ever configured via env override, that endpoint becomes an open spend
 * vector: anyone can burn paid inference at no cost to themselves.
 *
 * Behavior:
 * - The free router model ('openrouter/free') is never counted or gated.
 * - Paid models accrue an estimated cost per successful call against a
 *   daily USD cap. When the cap is reached, OpenRouter is skipped and the
 *   chat degrades to the local Ollama / no-model path — fail-closed on
 *   spend, never a chat crash.
 * - State lives in Redis (shared across instances) when REDIS_URL is set,
 *   else in a bounded in-memory map (single instance). Store failures fall
 *   back to memory and log; the chat is never blocked by a guard outage.
 * - The first cap breach each day emits a structured error log
 *   (openrouter_spend_cap_exceeded) for ops alerting.
 *
 * This is a guardrail, not a billing meter: cost is estimated per call,
 * and the check-then-record race can overshoot the cap slightly under
 * concurrent load. Both functions never throw.
 *
 * Env (read per call so an ops change needs no restart):
 *   OPENROUTER_DAILY_SPEND_CAP_USD        default '5'
 *   OPENROUTER_ESTIMATED_COST_PER_CALL_USD default '0.005'
 */

const redis = require('../utils/redis');
const logger = require('../utils/logger');

const KEY_PREFIX = 'openrouter:spend:v1:';
const ALERT_PREFIX = 'openrouter:spend-alert:v1:';
const FREE_MODEL = 'openrouter/free';
const KEY_TTL_SECONDS = 48 * 3600;

// In-memory fallback for single-process dev/test (same policy as
// utils/providerCircuitBreaker). Bounded: one entry per UTC date.
const localSpend = new Map();
const localAlerts = new Set();

function spendCapUsd(env = process.env) {
  const raw = Number(env.OPENROUTER_DAILY_SPEND_CAP_USD);
  if (!Number.isFinite(raw) || raw <= 0) return 5;
  return raw;
}

function estimatedCostPerCallUsd(env = process.env) {
  const raw = Number(env.OPENROUTER_ESTIMATED_COST_PER_CALL_USD);
  if (!Number.isFinite(raw) || raw < 0) return 0.005;
  return raw;
}

/** The free router costs nothing and is never gated. */
function isPaidModel(model) {
  return typeof model === 'string' && model.trim() !== '' && model.trim() !== FREE_MODEL;
}

function todayKey() {
  return KEY_PREFIX + new Date().toISOString().slice(0, 10);
}

function alertKey() {
  return ALERT_PREFIX + new Date().toISOString().slice(0, 10);
}

async function readSpend(key) {
  if (redis) {
    try {
      const raw = await redis.get(key);
      const n = Number(raw);
      return Number.isFinite(n) && n > 0 ? n : 0;
    } catch (err) {
      logger.warn('openrouter spend guard: redis read failed, using local fallback', {
        error: err.message,
      });
    }
  }
  return localSpend.get(key) || 0;
}

async function addSpend(key, amount) {
  if (redis) {
    try {
      const total = await redis.incrbyfloat(key, amount);
      await redis.expire(key, KEY_TTL_SECONDS);
      return Number(total) || 0;
    } catch (err) {
      logger.warn('openrouter spend guard: redis write failed, using local fallback', {
        error: err.message,
      });
    }
  }
  const total = (localSpend.get(key) || 0) + amount;
  localSpend.set(key, total);
  return total;
}

async function alertOnce(spendUsd, capUsd) {
  const key = alertKey();
  const payload = {
    spendUsd: Number(spendUsd.toFixed(4)),
    capUsd,
    date: new Date().toISOString().slice(0, 10),
  };
  if (redis) {
    try {
      // NX: only the first process to breach the cap today alerts.
      if ((await redis.set(key, '1', 'EX', 24 * 3600, 'NX')) === 'OK') {
        logger.error('openrouter_spend_cap_exceeded', payload);
      }
      return;
    } catch (err) {
      logger.warn('openrouter spend guard: alert dedupe failed', { error: err.message });
    }
  }
  if (localAlerts.has(key)) return;
  localAlerts.add(key);
  logger.error('openrouter_spend_cap_exceeded', payload);
}

/**
 * Whether an OpenRouter call with this model may proceed right now.
 * False only when a paid model would push estimated daily spend over the
 * cap (fail-closed on spend). Never throws.
 */
async function isOpenRouterAllowed(model, env = process.env) {
  try {
    if (!isPaidModel(model)) return true;
    const cap = spendCapUsd(env);
    const cost = estimatedCostPerCallUsd(env);
    const spend = await readSpend(todayKey());
    if (spend + cost > cap) {
      await alertOnce(spend, cap);
      return false;
    }
    return true;
  } catch (err) {
    logger.warn('openrouter spend guard: allowance check failed, allowing call', {
      error: err.message,
    });
    return true;
  }
}

/**
 * Record a successful OpenRouter call against today's spend. Only paid
 * models accrue. Returns the new estimated total. Never throws.
 */
async function recordOpenRouterCall(model, env = process.env) {
  try {
    if (!isPaidModel(model)) return readSpend(todayKey());
    return await addSpend(todayKey(), estimatedCostPerCallUsd(env));
  } catch (err) {
    logger.warn('openrouter spend guard: record failed', { error: err.message });
    return 0;
  }
}

/** Test seam: reset the in-memory fallback (Redis state is per-date). */
function _resetLocal() {
  localSpend.clear();
  localAlerts.clear();
}

module.exports = {
  spendCapUsd,
  estimatedCostPerCallUsd,
  isPaidModel,
  isOpenRouterAllowed,
  recordOpenRouterCall,
  _resetLocal,
};
