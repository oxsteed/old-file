const db = require('../db');
const { withTransaction } = require('../utils/transaction');
const { invalidateCache, DEFAULTS } = require('../utils/feeCalculator');
const { invalidateTrialCache, DEFAULT_TRIAL_DURATION_DAYS } = require('../utils/trial');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const logger = require('../utils/logger');
const { AppError } = require('../middleware/errorHandler');

/**
 * Strict numeric parse for fee config values. Rejects NaN, Infinity,
 * non-numeric strings ('abc'), and trailing-garbage strings ('10abc')
 * that parseFloat would silently accept.
 */
function parseStrictNumber(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed !== '' && /^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  }
  return NaN;
}

// --- Get all fee config values -----------------------
exports.getFeeConfig = async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT fc.*,
        u.first_name || ' ' || u.last_name AS updated_by_name
       FROM fee_config fc
       LEFT JOIN users u ON u.id = fc.updated_by
       ORDER BY fc.id`
    );
    res.json({ config: rows });
  } catch (err) {
    next(err);
  }
};

// --- Get fee change history -------------------------
exports.getFeeHistory = async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT
        fcl.*,
        u.first_name || ' ' || u.last_name AS changed_by_name
       FROM fee_change_log fcl
       LEFT JOIN users u ON u.id = fcl.changed_by
       ORDER BY fcl.created_at DESC
       LIMIT 100`
    );
    res.json({ history: rows });
  } catch (err) {
    next(err);
  }
};

// --- Update a single fee config value ------------------
exports.updateFeeConfig = async (req, res, next) => {
  const { key, value, reason } = req.body;
  const adminId = req.user.id;

  try {
    if (!key || value === undefined || value === null) {
      throw new AppError('key and value are required', 400, 'validation_failed', { key: 'Required', value: 'Required' });
    }

    // Fetch current config row
    const { rows: existing } = await db.query(
      'SELECT * FROM fee_config WHERE key = $1',
      [key]
    );

    if (!existing.length) {
      throw new AppError(`Fee config key '${key}' not found`, 404, 'not_found');
    }

    const current = existing[0];
    const newValue = parseStrictNumber(value);

    if (!Number.isFinite(newValue)) {
      throw new AppError('Value must be a valid number', 400, 'validation_failed', { value: 'Must be a numeric value' });
    }

    if (key === 'trial_duration_days' && newValue < DEFAULT_TRIAL_DURATION_DAYS) {
      throw new AppError(
        `Trial duration cannot be shorter than ${DEFAULT_TRIAL_DURATION_DAYS} days`,
        400,
        'validation_failed',
        { value: `Must be at least ${DEFAULT_TRIAL_DURATION_DAYS} days` },
      );
    }

    // Validate within allowed range
    if (current.min_value !== null && newValue < current.min_value) {
      throw new AppError(`Value ${newValue} is below minimum ${current.min_value}`, 400, 'validation_failed', { value: `Must be at least ${current.min_value}` });
    }
    if (current.max_value !== null && newValue > current.max_value) {
      throw new AppError(`Value ${newValue} is above maximum ${current.max_value}`, 400, 'validation_failed', { value: `Must not exceed ${current.max_value}` });
    }

    // Log the change (immutable) and update the config atomically: the
    // audit row and the new value commit or roll back together so a crash
    // between the two can never leave the log and config out of sync.
    await withTransaction(db, async (client) => {
      await client.query(
        `INSERT INTO fee_change_log
          (config_key, old_value, new_value, changed_by, reason, ip_hash)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          key,
          current.value,
          newValue,
          adminId,
          reason || null,
          req.ip ? require('crypto').createHash('sha256').update(req.ip).digest('hex').slice(0, 16) : null,
        ]
      );

      await client.query(
        `UPDATE fee_config
         SET value = $1, updated_by = $2, updated_at = now()
         WHERE key = $3`,
        [newValue, adminId, key]
      );
    }, 'fee_config_update');

    // Invalidate cache(s)
    invalidateCache();
    if (key === 'trial_duration_days') {
      invalidateTrialCache();
    }

    // If subscription price changed, sync to Stripe. The fee change is
    // already committed, so a provider sync failure must be surfaced
    // explicitly (202 with pending-sync state), never reported as success.
    let stripeSync = null;
    if (key.includes('subscription')) {
      try {
        stripeSync = await syncSubscriptionToStripe(key, newValue);
      } catch (err) {
        logger.error('[FeeConfig] Stripe sync failed:', { err: err.message, key });
        stripeSync = 'failed';
      }
    }

    if (stripeSync === 'failed') {
      return res.status(202).json({
        success: false,
        key,
        newValue,
        stripe_sync: 'failed',
        message: 'Fee saved, but the Stripe provider sync failed. The Stripe price was not updated; retry the change or sync it manually.',
      });
    }

    res.json({ success: true, key, newValue });
  } catch (err) {
    next(err);
  }
};

// --- Sync subscription price to Stripe -----------------
// Throws on provider or DB failure so the caller can surface it; never
// swallows errors into a silent success. Returns 'synced' or 'skipped'
// (no Stripe product configured for the plan).
async function syncSubscriptionToStripe(key, newCents) {
  const planSlug = key === 'tier2_subscription_cents' ? 'pro' : 'broker';

  const { rows: plans } = await db.query(
    'SELECT * FROM plans WHERE slug = $1',
    [planSlug]
  );

  if (!plans.length || !plans[0].stripe_product_id) return 'skipped';
  const plan = plans[0];

  // Create new Stripe Price
  const newPrice = await stripe.prices.create({
    currency: 'usd',
    unit_amount: newCents,
    recurring: { interval: 'month' },
    product: plan.stripe_product_id,
    metadata: {
      plan_slug: planSlug,
      updated_by: 'oxsteed_admin',
      updated_at: new Date().toISOString(),
    },
  });

  // Archive old Stripe Price
  if (plan.stripe_price_id) {
    await stripe.prices.update(plan.stripe_price_id, {
      active: false,
    });
  }

  // Update plans table with new price ID and amount
  await db.query(
    `UPDATE plans
     SET stripe_price_id = $1,
         amount_cents    = $2,
         updated_at      = now()
     WHERE slug = $3`,
    [newPrice.id, newCents, planSlug]
  );

  logger.info(`[FeeConfig] Stripe price updated for ${planSlug}:`, { newPrice: newPrice.id });
  return 'synced';
}

// --- Preview fee calculation at new rates ---------------
exports.previewFees = async (req, res, next) => {
  try {
    const {
      jobValueDollars,
      platformFeePct,
      protectionFeePct,
      brokerCutPct,
      platformFeeMinCents,
    } = req.body;

    const jobCents = Math.round((jobValueDollars || 100) * 100);

    // Zero is a valid rate: only undefined/null/'' (or non-numeric input)
    // fall back to the defaults. The old `||` fallbacks silently replaced
    // an explicit 0 with the default rate.
    const rateOr = (value, fallback) => {
      if (value === undefined || value === null || value === '') return fallback;
      const n = Number(value);
      return Number.isFinite(n) ? n : fallback;
    };

    let platformFee = Math.round(jobCents * rateOr(platformFeePct, 0.10));
    platformFee = Math.max(platformFee, rateOr(platformFeeMinCents, 500));

    const protectionFee = Math.round(jobCents * rateOr(protectionFeePct, 0.02));
    const brokerCut = Math.round(jobCents * rateOr(brokerCutPct, 0.05));
    const totalFees = platformFee + protectionFee + brokerCut;
    const helperPayout = jobCents - totalFees;

    res.json({
      jobValueDollars: jobCents / 100,
      platformFeeDollars: (platformFee / 100).toFixed(2),
      protectionFeeDollars: (protectionFee / 100).toFixed(2),
      brokerCutDollars: (brokerCut / 100).toFixed(2),
      totalFeeDollars: (totalFees / 100).toFixed(2),
      helperPayoutDollars: (helperPayout / 100).toFixed(2),
    });
  } catch (err) {
    next(err);
  }
};

// --- Reset all fees to defaults -----------------------
exports.resetToDefaults = async (req, res, next) => {
  const adminId = req.user.id;
  const { reason } = req.body;

  try {
    // Get current values for logging
    const { rows: current } = await db.query('SELECT * FROM fee_config');

    for (const row of current) {
      const defaultVal = DEFAULTS[row.key];
      if (defaultVal !== undefined && parseFloat(row.value) !== defaultVal) {
        // Log change
        await db.query(
          `INSERT INTO fee_change_log
            (config_key, old_value, new_value, changed_by, reason)
           VALUES ($1, $2, $3, $4, $5)`,
          [row.key, row.value, defaultVal, adminId, reason || 'Reset to defaults']
        );

        // Update value
        await db.query(
          `UPDATE fee_config
           SET value = $1, updated_by = $2, updated_at = now()
           WHERE key = $3`,
          [defaultVal, adminId, row.key]
        );
      }
    }

    invalidateCache();
    res.json({ success: true, message: 'All fees reset to defaults.' });
  } catch (err) {
    next(err);
  }
};
