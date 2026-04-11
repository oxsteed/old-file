const db = require('../db');
const logger = require('../utils/logger');

// In-memory cache — refreshed by admin setting changes
let FEES = {
  starter:    0.18,
  pro:        0.14,
  elite:      0.10,
  broker:     0.22,
  broker_cut: 0.35
};

// Track whether the config has ever been loaded from DB
let _loadedFromDb = false;
let _lastLoadAt   = 0;
let _staleWarnedAt = 0;
const STALE_WARN_MS    = 24 * 60 * 60 * 1000; // warn if not refreshed in 24h
const STALE_WARN_THROTTLE_MS = 60 * 60 * 1000; // re-warn at most once per hour

// Load from DB on startup and on admin override
exports.reloadFeeConfig = async () => {
  try {
    const { rows } = await db.query(`
      SELECT key, value FROM platform_settings
      WHERE key IN (
        'platform_fee_starter','platform_fee_pro',
        'platform_fee_elite','platform_fee_broker',
        'broker_cut_rate'
      )
    `);
    rows.forEach(({ key, value }) => {
      const map = {
        platform_fee_starter: 'starter',
        platform_fee_pro:     'pro',
        platform_fee_elite:   'elite',
        platform_fee_broker:  'broker',
        broker_cut_rate:      'broker_cut'
      };
      if (map[key]) FEES[map[key]] = parseFloat(value);
    });
    _loadedFromDb = true;
    _lastLoadAt = Date.now();
    _staleWarnedAt = 0; // reset so the warning can fire again if it goes stale
    logger.info('[FeeService] Config reloaded', { fees: FEES });
  } catch (err) {
    logger.error('[FeeService] Reload failed — using defaults', { message: err.message });
    // Do NOT update _lastLoadAt on failure so staleness warning still fires
  }
};

// Called explicitly by server/index.js after startup (not at import time)

exports.calculatePlatformFee = (amount, isBrokerMediated = false, planSlug = 'starter') => {
  // Warn if cache is stale — throttled to at most once per hour to avoid log floods
  const now = Date.now();
  if (_loadedFromDb && now - _lastLoadAt > STALE_WARN_MS && now - _staleWarnedAt > STALE_WARN_THROTTLE_MS) {
    _staleWarnedAt = now;
    logger.warn('[FeeService] Fee config cache is stale — consider triggering a reload');
  }
  const rate = isBrokerMediated
    ? FEES.broker
    : (FEES[planSlug] ?? FEES.starter);
  return parseFloat((amount * rate).toFixed(2));
};

exports.calculateBrokerCut = (grossFee) => {
  return parseFloat((grossFee * FEES.broker_cut).toFixed(2));
};

exports.PLAN_FEES = FEES;
