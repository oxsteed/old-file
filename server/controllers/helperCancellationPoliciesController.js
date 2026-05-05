const pool = require('../db');
const { AppError } = require('../utils/apiError');
const { logger } = require('../utils/logger');

/**
 * Get helper's current cancellation policies
 * GET /api/helper-settings/policies
 */
exports.getPolicies = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(
      `SELECT * FROM helper_cancellation_policies WHERE helper_id = $1`,
      [userId]
    );

    let policies = result.rows[0];

    // If no policies exist, create defaults
    if (!policies) {
      const insertResult = await pool.query(
        `INSERT INTO helper_cancellation_policies (helper_id, oxsteed_enabled, custom_enabled, custom_policy)
         VALUES ($1, TRUE, FALSE, '{}')
         RETURNING *`,
        [userId]
      );
      policies = insertResult.rows[0];
    }

    res.json({
      success: true,
      data: {
        id: policies.id,
        helper_id: policies.helper_id,
        oxsteed_enabled: policies.oxsteed_enabled,
        custom_enabled: policies.custom_enabled,
        custom_policy: policies.custom_policy || {},
        updated_at: policies.updated_at
      }
    });
  } catch (err) {
    logger.error('Error getting cancellation policies', { error: err, userId: req.user.id });
    next(new AppError('Failed to load cancellation policies', 500));
  }
};

/**
 * Update helper's cancellation policies
 * PUT /api/helper-settings/policies
 */
exports.updatePolicies = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { oxsteed_enabled, custom_enabled, custom_policy } = req.body;

    // Validation: at least one method must be enabled
    if (oxsteed_enabled === false && custom_enabled === false) {
      throw new AppError('At least one payment method must be enabled', 400);
    }

    // Validate custom_policy if custom_enabled
    if (custom_enabled && custom_policy) {
      if (typeof custom_policy.deposit_percent !== 'undefined') {
        if (custom_policy.deposit_percent < 0 || custom_policy.deposit_percent > 100) {
          throw new AppError('Deposit percent must be between 0 and 100', 400);
        }
      }
      if (typeof custom_policy.min_notice_hours !== 'undefined') {
        if (custom_policy.min_notice_hours < 0) {
          throw new AppError('Minimum notice hours cannot be negative', 400);
        }
      }
      if (custom_policy.terms && custom_policy.terms.length > 1000) {
        throw new AppError('Custom terms must be 1000 characters or less', 400);
      }
    }

    const result = await pool.query(
      `UPDATE helper_cancellation_policies
       SET oxsteed_enabled = $1, custom_enabled = $2, custom_policy = $3, updated_at = NOW()
       WHERE helper_id = $4
       RETURNING *`,
      [oxsteed_enabled ?? true, custom_enabled ?? false, custom_policy || {}, userId]
    );

    if (result.rows.length === 0) {
      // If update returned no rows, the helper doesn't have a policy yet - create one
      const insertResult = await pool.query(
        `INSERT INTO helper_cancellation_policies (helper_id, oxsteed_enabled, custom_enabled, custom_policy)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [userId, oxsteed_enabled ?? true, custom_enabled ?? false, custom_policy || {}]
      );

      logger.info('Created new cancellation policies', { userId });

      return res.json({
        success: true,
        data: {
          id: insertResult.rows[0].id,
          helper_id: insertResult.rows[0].helper_id,
          oxsteed_enabled: insertResult.rows[0].oxsteed_enabled,
          custom_enabled: insertResult.rows[0].custom_enabled,
          custom_policy: insertResult.rows[0].custom_policy,
          updated_at: insertResult.rows[0].updated_at
        }
      });
    }

    logger.info('Updated cancellation policies', { userId, oxsteed_enabled, custom_enabled });

    res.json({
      success: true,
      data: {
        id: result.rows[0].id,
        helper_id: result.rows[0].helper_id,
        oxsteed_enabled: result.rows[0].oxsteed_enabled,
        custom_enabled: result.rows[0].custom_enabled,
        custom_policy: result.rows[0].custom_policy,
        updated_at: result.rows[0].updated_at
      }
    });
  } catch (err) {
    if (err instanceof AppError) {
      return next(err);
    }
    logger.error('Error updating cancellation policies', { error: err, userId: req.user.id });
    next(new AppError('Failed to update cancellation policies', 500));
  }
};

/**
 * Get default OxSteed policy for reference
 * GET /api/helper-settings/oxsteed-default
 */
exports.getOxsteadDefaultPolicy = async (req, res, next) => {
  try {
    res.json({
      success: true,
      data: {
        type: 'oxsteed',
        description: 'Standard OxSteed payment protection',
        fee_structure: {
          '3_plus_days_before': {
            percentage: 0,
            description: '3 or more days before scheduled start: 0% cancellation fee'
          },
          '24h_to_3_days_before': {
            percentage: 50,
            description: 'Between 24 hours and 3 days: 50% of fee cap (max $100)'
          },
          less_than_24h: {
            percentage: 100,
            description: 'Less than 24 hours before: 100% of fee cap (max $100)'
          }
        },
        fee_cap_cents: 10000, // $100
        fee_cap_percent: 10, // 10% of job amount
        helper_receives: 'Fee minus platform fee (7.1%) and Stripe processing (~2.2%)',
        customer_impact: 'Cancellation fee protects you from last-minute flakiness'
      }
    });
  } catch (err) {
    logger.error('Error getting OxSteed default policy', { error: err });
    next(new AppError('Failed to load default policy', 500));
  }
};
