const db = require('../db');
const crypto = require('crypto');
const { invalidateCache, DEFAULTS } = require('../utils/feeCalculator');
const { invalidateTrialCache, DEFAULT_TRIAL_DURATION_DAYS } = require('../utils/trial');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const logger = require('../utils/logger');
const { AppError } = require('../middleware/errorHandler');

/**
 * Nov 2 admin-ops audit item 12: fee config changes are dual-approved
 * through the EXISTING money-movement maker-checker queue
 * (money_movement_approvals, ADM-016), not a new approval system.
 *
 * - Propose: a super admin (the existing fee-config route grant, plus the
 *   existing fee_config_update maker step-up) queues a fee_config_change
 *   approval. Nothing is applied at queue time.
 * - Approve: a DIFFERENT admin with the money-approval grant
 *   (super-admin bypass, else manage_financials or issue_refunds, per
 *   routes/admin.js requireMoneyApprovalGrant) approves with a fresh
 *   money_movement_approve step-up, and the executor below applies the
 *   change inside the same transaction that flips the row to executed.
 *   Self-approval is forbidden by the decide service and by the table
 *   CHECK constraint.
 * - amount_cents is 1, a queue placeholder, because a fee change moves no
 *   money itself: it changes the rates future transactions use. The table
 *   requires amount_cents > 0, and the checker reads the key and old/new
 *   values from the approval subject line, not from the amount column
 *   (the approvals UI renders no money amount for this type).
 * - Replays: re-proposing the identical pending change returns the
 *   existing approval instead of queueing a duplicate. A different pending
 *   proposal for the same key queues alongside it; the checker sees both
 *   and rejects the stale one.
 */
const FEE_APPROVAL_TYPE = 'fee_config_change';

function feeApprovalReferenceKey(key) {
  return `fee_config:${key}`;
}

function feePayloadsEqual(a, b) {
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.kind === 'reset') return (a.reason || null) === (b.reason || null);
  return a.key === b.key
    && Number(a.oldValue) === Number(b.oldValue)
    && Number(a.newValue) === Number(b.newValue)
    && (a.reason || null) === (b.reason || null);
}

async function queueFeeApproval({ referenceKey, payload, requestedBy }) {
  const { rows: pending } = await db.query(
    `SELECT * FROM money_movement_approvals
     WHERE movement_type = $1 AND reference_key = $2 AND status = 'pending'
     ORDER BY requested_at ASC LIMIT 1`,
    [FEE_APPROVAL_TYPE, referenceKey]
  );
  if (pending.length) {
    let stored = pending[0].payload;
    if (typeof stored === 'string') {
      try { stored = JSON.parse(stored); } catch { stored = {}; }
    }
    if (feePayloadsEqual(stored || {}, payload)) {
      return { queued: true, approval: pending[0], replay: true };
    }
  }
  const { rows } = await db.query(
    `INSERT INTO money_movement_approvals
       (movement_type, reference_key, amount_cents, currency_code, requested_by, idempotency_key, payload)
     VALUES ($1, $2, 1, 'USD', $3, $4, $5)
     RETURNING *`,
    [FEE_APPROVAL_TYPE, referenceKey, requestedBy, `fee-config:${crypto.randomUUID()}`, JSON.stringify(payload)]
  );
  return { queued: true, approval: rows[0], replay: false };
}

// Shared range validation for a fee value against its config row: the
// trial floor plus the row's min/max bounds. Throws AppError on violation;
// used at propose time and again at checker execution time, so a bound
// that changed between proposal and approval fails closed.
function validateFeeValue(current, newValue) {
  if (current.key === 'trial_duration_days' && newValue < DEFAULT_TRIAL_DURATION_DAYS) {
    throw new AppError(
      `Trial duration cannot be shorter than ${DEFAULT_TRIAL_DURATION_DAYS} days`,
      400,
      'validation_failed',
      { value: `Must be at least ${DEFAULT_TRIAL_DURATION_DAYS} days` },
    );
  }
  if (current.min_value !== null && newValue < current.min_value) {
    throw new AppError(`Value ${newValue} is below minimum ${current.min_value}`, 400, 'validation_failed', { value: `Must be at least ${current.min_value}` });
  }
  if (current.max_value !== null && newValue > current.max_value) {
    throw new AppError(`Value ${newValue} is above maximum ${current.max_value}`, 400, 'validation_failed', { value: `Must not exceed ${current.max_value}` });
  }
}

// Write one fee change (audit log row + config row) on a transaction
// client. The log INSERT and the config UPDATE commit or roll back
// together so a crash between the two can never leave log and config
// out of sync. Used by the approval executor only; proposing never
// writes here.
async function applyFeeChangeTx(client, { key, oldValue, newValue, adminId, reason, ipHash }) {
  await client.query(
    `INSERT INTO fee_change_log
      (config_key, old_value, new_value, changed_by, reason, ip_hash)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [key, oldValue, newValue, adminId, reason || null, ipHash || null]
  );
  await client.query(
    `UPDATE fee_config
     SET value = $1, updated_by = $2, updated_at = now()
     WHERE key = $3`,
    [newValue, adminId, key]
  );
}

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

// --- Queue a single fee config change for dual approval ----------------
// Item 12: proposing never applies. The checker applies via
// executeFeeConfigChange when approving in the money-approvals queue.
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

    validateFeeValue(current, newValue);

    const gate = await queueFeeApproval({
      referenceKey: feeApprovalReferenceKey(key),
      payload: {
        kind: 'single',
        key,
        oldValue: current.value,
        newValue,
        reason: reason || null,
        ipHash: req.ip ? crypto.createHash('sha256').update(req.ip).digest('hex').slice(0, 16) : null,
      },
      requestedBy: adminId,
    });

    res.status(202).json({
      success: true,
      queued: true,
      replay: gate.replay,
      key,
      oldValue: current.value,
      newValue,
      approvalId: gate.approval.id,
      message: 'Fee change queued for second-admin approval. It takes effect only after approval.',
    });
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

// --- Queue a reset to defaults for dual approval -----------------------
// Item 12: like updateFeeConfig, proposing never applies. The executor
// computes the changed set at approval time, so a value that already
// returned to its default between proposal and approval is not re-logged.
exports.resetToDefaults = async (req, res, next) => {
  const adminId = req.user.id;
  const { reason } = req.body;

  try {
    const gate = await queueFeeApproval({
      referenceKey: 'fee_config:reset',
      payload: { kind: 'reset', reason: reason || 'Reset to defaults' },
      requestedBy: adminId,
    });

    res.status(202).json({
      success: true,
      queued: true,
      replay: gate.replay,
      approvalId: gate.approval.id,
      message: 'Fee reset queued for second-admin approval. It takes effect only after approval.',
    });
  } catch (err) {
    next(err);
  }
};

// --- Dual-approval executor for fee_config_change -----------------------
// Runs inside the decide transaction (client is that transaction's client):
// the fee writes and the approval flip to executed commit or roll back
// together, so a crash cannot approve without applying or apply without
// approving. Bounds are re-validated here against the CURRENT row, so a
// bound or value that moved between proposal and approval fails closed
// and the approval stays pending for a safe retry.
// Stripe provider sync stays out of the transaction, mirroring the old
// direct-apply behavior: it runs in afterCommit, and a failure is recorded
// on the result (and on the stored approval row) as stripe_sync 'failed',
// never reported as a clean success.
async function executeFeeConfigChange({ approval, payload, approverId, client }) {
  if (!payload || (payload.kind !== 'single' && payload.kind !== 'reset')) {
    throw new AppError('Invalid fee approval payload', 500, 'fee_approval_invalid_payload');
  }

  // Refresh the stored approval result after the provider sync, so the
  // recorded result carries the final stripe_sync state, not the
  // pre-sync snapshot written when the row flipped to executed.
  const recordSyncResult = async (result) => {
    try {
      await db.query(
        'UPDATE money_movement_approvals SET result = $2 WHERE id = $1',
        [approval.id, JSON.stringify(result)]
      );
    } catch (err) {
      logger.error('[FeeConfig] Failed to record fee Stripe sync result:', { approvalId: approval.id, err: err.message });
    }
  };

  if (payload.kind === 'single') {
    const { rows } = await client.query(
      'SELECT * FROM fee_config WHERE key = $1 FOR UPDATE',
      [payload.key]
    );
    if (!rows.length) {
      throw new AppError(`Fee config key '${payload.key}' not found`, 404, 'not_found');
    }
    const current = rows[0];
    const newValue = Number(payload.newValue);
    if (!Number.isFinite(newValue)) {
      throw new AppError('Value must be a valid number', 400, 'validation_failed', { value: 'Must be a numeric value' });
    }
    validateFeeValue(current, newValue);

    await applyFeeChangeTx(client, {
      key: payload.key,
      oldValue: current.value,
      newValue,
      adminId: approverId,
      reason: payload.reason || null,
      ipHash: payload.ipHash || null,
    });

    invalidateCache();
    if (payload.key === 'trial_duration_days') {
      invalidateTrialCache();
    }

    const result = {
      feeApplied: true,
      kind: 'single',
      key: payload.key,
      oldValue: current.value,
      newValue,
      stripeSync: String(payload.key).includes('subscription') ? 'pending' : 'skipped',
    };
    if (result.stripeSync === 'pending') {
      result.afterCommit = async () => {
        try {
          result.stripeSync = await syncSubscriptionToStripe(payload.key, newValue);
        } catch (err) {
          logger.error('[FeeConfig] Stripe sync failed on approved fee change:', { err: err.message, key: payload.key });
          result.stripeSync = 'failed';
        }
        await recordSyncResult(result);
      };
    }
    return result;
  }

  const { rows: current } = await client.query('SELECT * FROM fee_config');
  const changed = current.filter(
    (row) => DEFAULTS[row.key] !== undefined && parseFloat(row.value) !== DEFAULTS[row.key]
  );

  for (const row of changed) {
    await applyFeeChangeTx(client, {
      key: row.key,
      oldValue: row.value,
      newValue: DEFAULTS[row.key],
      adminId: approverId,
      reason: payload.reason || 'Reset to defaults',
      ipHash: null,
    });
  }

  invalidateCache();
  if (changed.some((row) => row.key === 'trial_duration_days')) {
    invalidateTrialCache();
  }

  const subscriptionChanges = changed.filter((row) => row.key.includes('subscription'));
  const result = {
    feeApplied: true,
    kind: 'reset',
    changedKeys: changed.map((row) => row.key),
    stripeSync: subscriptionChanges.length ? 'pending' : 'skipped',
  };
  if (result.stripeSync === 'pending') {
    result.afterCommit = async () => {
      let failed = false;
      for (const row of subscriptionChanges) {
        try {
          await syncSubscriptionToStripe(row.key, DEFAULTS[row.key]);
        } catch (err) {
          logger.error('[FeeConfig] Stripe sync failed on approved fee reset:', { err: err.message, key: row.key });
          failed = true;
        }
      }
      result.stripeSync = failed ? 'failed' : 'synced';
      await recordSyncResult(result);
    };
  }
  return result;
}

exports.executeFeeConfigChange = executeFeeConfigChange;
exports.FEE_APPROVAL_TYPE = FEE_APPROVAL_TYPE;
