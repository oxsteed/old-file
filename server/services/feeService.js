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
    logger.info('[FeeService] Config reloaded:', FEES);
  } catch (err) {
    logger.error('[FeeService] Reload failed:', err.message);
  }
};

// Called explicitly by server/index.js after startup (not at import time)

exports.calculatePlatformFee = (amount, isBrokerMediated = false, planSlug = 'starter') => {
  const rate = isBrokerMediated
    ? FEES.broker
    : (FEES[planSlug] ?? FEES.starter);
  return parseFloat((amount * rate).toFixed(2));
};

exports.calculateBrokerCut = (grossFee) => {
  return parseFloat((grossFee * FEES.broker_cut).toFixed(2));
};

exports.PLAN_FEES = FEES;
