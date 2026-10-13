const stripe = process.env.STRIPE_SECRET_KEY ? require('stripe')(process.env.STRIPE_SECRET_KEY) : null;
const pool = require('../db');
const { withTransaction } = require('../utils/transaction');
const logger = require('../utils/logger');
const { sendError, sendValidationError } = require('../utils/apiError');
const { AppError } = require('../middleware/errorHandler');
const { logAdminAction } = require('../services/auditService');

async function getAffiliateProgram(req, res) {
  try {
    const userId = req.user?.id;
    const { programId } = req.params;

    if (!userId) return sendError(res, 401, 'Unauthorized');

    const program = await pool.query(
      'SELECT * FROM affiliate_programs WHERE id = $1 AND helper_id = $2',
      [programId, userId]
    );

    if (!program.rows.length) return sendError(res, 404, 'Program not found');

    res.json({
      success: true,
      data: program.rows[0]
    });
  } catch (error) {
    logger.error('Error fetching affiliate program', { error });
    sendError(res, 500, 'Failed to fetch program');
  }
}

async function getAffiliatePrograms(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return sendError(res, 401, 'Unauthorized');

    const programs = await pool.query(
      'SELECT * FROM affiliate_programs WHERE helper_id = $1 ORDER BY created_at DESC',
      [userId]
    );

    res.json({
      success: true,
      data: programs.rows
    });
  } catch (error) {
    logger.error('Error fetching affiliate programs', { error });
    sendError(res, 500, 'Failed to fetch programs');
  }
}

async function createAffiliateProgram(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return sendError(res, 401, 'Unauthorized');

    const { program_type, affiliate_id, commission_rate } = req.body;

    if (!program_type) return sendValidationError(res, { program_type: 'Required' });
    if (!commission_rate || commission_rate < 0 || commission_rate > 100) {
      return sendValidationError(res, { commission_rate: 'Must be between 0 and 100' });
    }

    // Check if program already exists
    const existing = await pool.query(
      'SELECT * FROM affiliate_programs WHERE helper_id = $1 AND program_type = $2',
      [userId, program_type]
    );

    if (existing.rows.length) {
      return sendError(res, 400, 'Program already exists for this type');
    }

    const program = await pool.query(
      `INSERT INTO affiliate_programs
       (helper_id, program_type, affiliate_id, commission_rate, status)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [userId, program_type, affiliate_id || null, commission_rate, 'active']
    );

    logger.info('Affiliate program created', { programId: program.rows[0].id, program_type });

    res.json({
      success: true,
      data: program.rows[0]
    });
  } catch (error) {
    logger.error('Error creating affiliate program', { error });
    sendError(res, 500, 'Failed to create program');
  }
}

async function getAffiliateCommissions(req, res) {
  try {
    const userId = req.user?.id;
    const { programId } = req.params;
    const { status, skip = 0, limit = 50 } = req.query;

    if (!userId) return sendError(res, 401, 'Unauthorized');

    // Verify program belongs to user
    const program = await pool.query(
      'SELECT * FROM affiliate_programs WHERE id = $1 AND helper_id = $2',
      [programId, userId]
    );

    if (!program.rows.length) return sendError(res, 404, 'Program not found');

    let query = `SELECT ac.*, mp.name as product_name FROM affiliate_commissions ac
                 JOIN marketplace_products mp ON ac.product_id = mp.id
                 WHERE ac.affiliate_program_id = $1`;
    const params = [programId];

    if (status) {
      query += ` AND ac.status = $${params.length + 1}`;
      params.push(status);
    }

    query += ` ORDER BY ac.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, skip);

    const commissions = await pool.query(query, params);

    res.json({
      success: true,
      data: commissions.rows
    });
  } catch (error) {
    logger.error('Error fetching affiliate commissions', { error });
    sendError(res, 500, 'Failed to fetch commissions');
  }
}

async function getPayoutsSchedule(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return sendError(res, 401, 'Unauthorized');

    const payouts = await pool.query(
      `SELECT ap.*, aprg.program_type, aprg.helper_id
       FROM affiliate_payouts ap
       JOIN affiliate_programs aprg ON ap.affiliate_program_id = aprg.id
       WHERE aprg.helper_id = $1
       ORDER BY ap.period_start DESC
       LIMIT 100`,
      [userId]
    );

    res.json({
      success: true,
      data: payouts.rows
    });
  } catch (error) {
    logger.error('Error fetching payouts schedule', { error });
    sendError(res, 500, 'Failed to fetch payouts');
  }
}

async function calculateAndCreatePayout(req, res, next) {
  try {
    const userId = req.user?.id;
    const { programId, periodStart, periodEnd } = req.body;

    if (!userId) {
      throw new AppError('Authentication required', 401, 'no_auth');
    }
    const fields = {};
    if (!programId) fields.programId = 'Program ID is required';
    if (!periodStart) fields.periodStart = 'Period start date is required';
    if (!periodEnd) fields.periodEnd = 'Period end date is required';
    if (Object.keys(fields).length > 0) {
      throw new AppError('Validation failed', 400, 'validation_failed', fields);
    }

    // Verify program belongs to user
    const program = await pool.query(
      'SELECT * FROM affiliate_programs WHERE id = $1 AND helper_id = $2',
      [programId, userId]
    );

    if (!program.rows.length) {
      throw new AppError('Affiliate program not found', 404, 'program_not_found');
    }

    // Idempotency key: an explicit client key wins; otherwise a deterministic
    // key per (program, period) so a concurrent double-submit replays the
    // original payout instead of creating a duplicate.
    const headerKey = typeof req.get === 'function' ? req.get('Idempotency-Key') : null;
    const idempotencyKey = String(req.body.idempotencyKey || headerKey || '').trim()
      || `affiliate-payout:${programId}:${periodStart}:${periodEnd}`;

    const { payout, replayed } = await withTransaction(pool, async (client) => {
      // Row-level claim: serialize concurrent calculate calls for this program
      // so two requests cannot read the same pending commission set.
      await client.query(
        'SELECT id FROM affiliate_programs WHERE id = $1 FOR UPDATE',
        [programId]
      );

      // Replay guard: an identical request that already produced a payout
      // returns the original row.
      const prior = await client.query(
        'SELECT * FROM affiliate_payouts WHERE idempotency_key = $1',
        [idempotencyKey]
      );
      if (prior.rows.length) {
        return { payout: prior.rows[0], replayed: true };
      }

      // Calculate commissions for the period inside the claim, so a concurrent
      // request cannot observe the same pending rows before they are marked.
      const commissions = await client.query(
        `SELECT SUM(commission_cents) as total_cents, COUNT(*) as count
         FROM affiliate_commissions
         WHERE affiliate_program_id = $1
         AND status IN ($2, 'confirmed') AND payout_id IS NULL
         AND created_at >= $3 AND created_at < $4`,
        [programId, 'pending', new Date(periodStart), new Date(periodEnd)]
      );

      const totalCommissionCents = commissions.rows[0]?.total_cents || 0;
      const commissionCount = commissions.rows[0]?.count || 0;

      if (totalCommissionCents === 0) {
        throw new AppError('No commissions to payout for this period', 400, 'no_commissions');
      }

      const payoutResult = await client.query(
        `INSERT INTO affiliate_payouts
         (affiliate_program_id, period_start, period_end, total_commission_cents, commission_count, status, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
         RETURNING *`,
        [programId, periodStart, periodEnd, totalCommissionCents, commissionCount, 'pending', idempotencyKey]
      );

      let row = payoutResult.rows[0];
      if (!row) {
        // Another holder inserted the same key without the claim; replay it.
        const raced = await client.query(
          'SELECT * FROM affiliate_payouts WHERE idempotency_key = $1',
          [idempotencyKey]
        );
        return { payout: raced.rows[0], replayed: true };
      }

      const payoutId = row.id;

      // Update commissions to reference payout
      await client.query(
        `UPDATE affiliate_commissions
         SET payout_id = $1, status = $2
         WHERE affiliate_program_id = $3 AND status IN ($4, 'confirmed') AND payout_id IS NULL
         AND created_at >= $5 AND created_at < $6`,
        [payoutId, 'confirmed', programId, 'pending', new Date(periodStart), new Date(periodEnd)]
      );

      // Update program totals
      await client.query(
        `UPDATE affiliate_programs
         SET total_commission_cents = total_commission_cents + $1,
             pending_cents = pending_cents + $1
         WHERE id = $2`,
        [totalCommissionCents, programId]
      );

      return { payout: row, replayed: false };
    });

    logger.info('Payout calculated', { payoutId: payout.id, total: payout.total_commission_cents, replayed });

    res.json({
      success: true,
      data: payout,
      replayed: Boolean(replayed)
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Review P3-787: affiliate payouts are an admin money move.
 *
 * - Only an admin with the financials grant can process (route guard).
 * - Money goes to the program owner's Stripe Connect account through a
 *   transfer (the platform-balance `payouts.create` call could never reach a
 *   user and was always rejected).
 * - Transfers settle synchronously, so the payout ends `completed` (and its
 *   commissions `paid`) or `failed` (commissions re-queued to `pending`).
 * - A payout stuck `processing` (crash after Stripe) can be re-run; the
 *   per-payout idempotency key returns the original transfer.
 */
const STALE_PROCESSING_MINUTES = 10;

async function processPayout(req, res, next) {
  try {
    const adminId = req.user?.id;
    const { payoutId } = req.params;
    if (!adminId) {
      throw new AppError('Authentication required', 401, 'no_auth');
    }
    if (!stripe) {
      throw new AppError('Payout processing is not configured', 503, 'stripe_not_configured');
    }

    const { rows: [payout] } = await pool.query(
      `SELECT ap.*, aprg.helper_id AS owner_id
         FROM affiliate_payouts ap
         JOIN affiliate_programs aprg ON ap.affiliate_program_id = aprg.id
        WHERE ap.id = $1`,
      [payoutId]
    );
    if (!payout) {
      throw new AppError('Payout not found', 404, 'payout_not_found');
    }

    const { rows: [connect] } = await pool.query(
      `SELECT stripe_account_id, payouts_enabled FROM connect_accounts
        WHERE user_id = $1 AND stripe_account_id IS NOT NULL
        ORDER BY updated_at DESC NULLS LAST LIMIT 1`,
      [payout.owner_id]
    );
    if (!connect?.stripe_account_id || connect.payouts_enabled === false) {
      throw new AppError('The affiliate has no payout-ready Stripe account', 400, 'no_payout_account');
    }

    // Claim: pending, or processing that has been stuck long enough to be a
    // crashed attempt (the idempotency key makes the re-run safe).
    const claim = await pool.query(
      `UPDATE affiliate_payouts
          SET status = 'processing', updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
          AND (status = 'pending'
               OR (status = 'processing' AND updated_at < NOW() - make_interval(mins => $2)))
        RETURNING *`,
      [payoutId, STALE_PROCESSING_MINUTES]
    );
    if (!claim.rows.length) {
      throw new AppError('Payout already processed or in progress', 409, 'invalid_payout_state');
    }
    const amountCents = Number(claim.rows[0].total_commission_cents);

    let transfer;
    try {
      transfer = await stripe.transfers.create({
        amount: amountCents,
        currency: 'usd',
        destination: connect.stripe_account_id,
        transfer_group: `affiliate_payout_${payoutId}`,
        metadata: { affiliate_payout_id: String(payoutId), affiliate_program_id: String(payout.affiliate_program_id) },
      }, {
        idempotencyKey: `affiliate-payout-${payoutId}`,
      });
    } catch (stripeError) {
      logger.error('Affiliate transfer failed', { payoutId, error: stripeError.message });
      // Terminal failure: re-queue the commissions so a new payout can pick them up.
      await withTransaction(pool, async (client) => {
        await client.query(
          `UPDATE affiliate_payouts SET status = 'failed', failed_reason = $1, updated_at = CURRENT_TIMESTAMP
            WHERE id = $2`,
          [String(stripeError.message || 'transfer_failed').slice(0, 500), payoutId]
        );
        await client.query(
          `UPDATE affiliate_commissions SET status = 'pending', payout_id = NULL
            WHERE payout_id = $1 AND status = 'confirmed'`,
          [payoutId]
        );
        await client.query(
          `UPDATE affiliate_programs SET pending_cents = GREATEST(pending_cents - $1, 0),
                  total_commission_cents = GREATEST(total_commission_cents - $1, 0)
            WHERE id = $2`,
          [amountCents, payout.affiliate_program_id]
        );
      }, 'affiliate_payout_failed');
      throw new AppError('Failed to process payout through payment processor', 502, 'stripe_error');
    }

    const updated = await withTransaction(pool, async (client) => {
      const { rows } = await client.query(
        `UPDATE affiliate_payouts
            SET status = 'completed', payout_method = 'stripe_connect_transfer', payout_reference = $1,
                payment_processor = 'stripe', sent_at = COALESCE(sent_at, CURRENT_TIMESTAMP),
                received_at = CURRENT_TIMESTAMP, net_payout_cents = $2, updated_at = CURRENT_TIMESTAMP
          WHERE id = $3 AND status = 'processing'
          RETURNING *`,
        [transfer.id, amountCents, payoutId]
      );
      if (!rows.length) return null;
      await client.query(
        `UPDATE affiliate_commissions SET status = 'paid', paid_at = CURRENT_TIMESTAMP
          WHERE payout_id = $1 AND status = 'confirmed'`,
        [payoutId]
      );
      await client.query(
        `UPDATE affiliate_programs
            SET pending_cents = GREATEST(pending_cents - $1, 0),
                total_paid_cents = total_paid_cents + $1
          WHERE id = $2`,
        [amountCents, payout.affiliate_program_id]
      );
      await logAdminAction({
        client,
        adminId,
        action: 'affiliate_payout_processed',
        targetType: 'affiliate_payout',
        targetId: payoutId,
        description: `Affiliate payout ${payoutId} transferred via Stripe (${transfer.id})`,
        before: { status: payout.status },
        after: { status: 'completed', transferId: transfer.id, amountCents, destination: connect.stripe_account_id },
        req,
        throwOnError: true,
      });
      return rows[0];
    }, 'affiliate_payout_completed');

    logger.info('Affiliate payout transferred', { payoutId, transferId: transfer.id });
    res.json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
}

async function getAffiliateStats(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return sendError(res, 401, 'Unauthorized');

    const stats = await pool.query(
      `SELECT
        COUNT(DISTINCT ap.id) as total_programs,
        SUM(ap.total_commission_cents) as lifetime_commission_cents,
        SUM(ap.total_paid_cents) as total_paid_cents,
        SUM(ap.pending_cents) as pending_cents,
        COUNT(DISTINCT ac.order_id) as total_conversions
       FROM affiliate_programs ap
       LEFT JOIN affiliate_commissions ac ON ap.id = ac.affiliate_program_id
       WHERE ap.helper_id = $1`,
      [userId]
    );

    res.json({
      success: true,
      data: stats.rows[0] || { total_programs: 0, lifetime_commission_cents: 0, total_paid_cents: 0, pending_cents: 0, total_conversions: 0 }
    });
  } catch (error) {
    logger.error('Error fetching affiliate stats', { error });
    sendError(res, 500, 'Failed to fetch stats');
  }
}

module.exports = {
  getAffiliateProgram,
  getAffiliatePrograms,
  createAffiliateProgram,
  getAffiliateCommissions,
  getPayoutsSchedule,
  calculateAndCreatePayout,
  processPayout,
  getAffiliateStats
};
