const db = require('../db');
const logger = require('../utils/logger');
const { invalidateCache, DEFAULTS } = require('../utils/feeCalculator');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// ——— Get all fee config values ———————————————————————
exports.getFeeConfig = async (req, res) => {
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
    res.status(500).json({ error: 'Failed to load fee config.' });
  }
};

// ——— Get fee change history —————————————————————————
exports.getFeeHistory = async (req, res) => {
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
    res.status(500).json({ error: 'Failed to load fee history.' });
  }
};

// ——— Update a single fee config value ——————————————————
exports.updateFeeConfig = async (req, res) => {
  const { key, value, reason } = req.body;
  const adminId = req.user.id;

  if (!key || value === undefined || value === null) {
    return res.status(400).json({ error: 'key and value are required.' });
  }

  try {
    // Fetch current config row
    const { rows: existing } = await db.query(
      'SELECT * FROM fee_config WHERE key = $1',
      [key]
    );

    if (!existing.length) {
      return res.status(404).json({ error: `Fee config key '${key}' not found.` });
    }

    const current = existing[0];
    const newValue = parseFloat(value);

    // Validate within allowed range
    if (current.min_value !== null && newValue < current.min_value) {
      return res.status(400).json({
        error: `Value ${newValue} is below minimum ${current.min_value}`,
      });
    }
    if (current.max_value !== null && newValue > current.max_value) {
      return res.status(400).json({
        error: `Value ${newValue} is above maximum ${current.max_value}`,
      });
    }

    // Log the change (immutable)
    await db.query(
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

    // Update the config
    await db.query(
      `UPDATE fee_config
       SET value = $1, updated_by = $2, updated_at = now()
       WHERE key = $3`,
      [newValue, adminId, key]
    );

    // Invalidate cache
    invalidateCache();

    // If subscription price changed, sync to Stripe
    if (key.includes('subscription')) {
      await syncSubscriptionToStripe(key, newValue);
    }

    res.json({ success: true, key, newValue });
  } catch (err) {
    logger.error('[FeeConfig] Update failed:', err);
    res.status(500).json({ error: 'Failed to update fee config.' });
  }
};

// ——— Sync subscription price to Stripe —————————————————
async function syncSubscriptionToStripe(key, newCents) {
  try {
    const planSlug = key === 'tier2_subscription_cents' ? 'pro' : 'broker';

    const { rows: plans } = await db.query(
      'SELECT * FROM plans WHERE slug = $1',
      [planSlug]
    );

    if (!plans.length || !plans[0].stripe_product_id) return;
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

    logger.info(`[FeeConfig] Stripe price updated for ${planSlug}:`, newPrice.id);
  } catch (err) {
    // Log but don't fail the DB transaction
    logger.error('[FeeConfig] Stripe sync failed:', err.message);
  }
}

// ——— Preview fee calculation at new rates ———————————————
exports.previewFees = async (req, res) => {
  try {
    const {
      jobValueDollars,
      platformFeePct,
      protectionFeePct,
      brokerCutPct,
      platformFeeMinCents,
    } = req.body;

    const jobCents = Math.round((jobValueDollars || 100) * 100);

    let platformFee = Math.round(jobCents * (platformFeePct || 0.10));
    platformFee = Math.max(platformFee, platformFeeMinCents || 500);

    const protectionFee = Math.round(jobCents * (protectionFeePct || 0.02));
    const brokerCut = Math.round(jobCents * (brokerCutPct || 0.05));
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
    res.status(500).json({ error: 'Preview calculation failed.' });
  }
};

// ——— Reset all fees to defaults ———————————————————————
exports.resetToDefaults = async (req, res) => {
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
    logger.error('[FeeConfig] Reset failed:', err);
    res.status(500).json({ error: 'Failed to reset fees.' });
  }
};
