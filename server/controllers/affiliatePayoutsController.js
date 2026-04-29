const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { pool } = require('../utils/db');
const { withTransaction } = require('../utils/transaction');
const logger = require('../utils/logger');
const { sendError, sendValidationError } = require('../utils/apiError');

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

async function calculateAndCreatePayout(req, res) {
  try {
    const userId = req.user?.id;
    const { programId, periodStart, periodEnd } = req.body;

    if (!userId) return sendError(res, 401, 'Unauthorized');
    if (!programId || !periodStart || !periodEnd) {
      return sendValidationError(res, { programId: 'Required', periodStart: 'Required', periodEnd: 'Required' });
    }

    // Verify program belongs to user
    const program = await pool.query(
      'SELECT * FROM affiliate_programs WHERE id = $1 AND helper_id = $2',
      [programId, userId]
    );

    if (!program.rows.length) return sendError(res, 404, 'Program not found');

    // Calculate commissions for period
    const commissions = await pool.query(
      `SELECT SUM(commission_cents) as total_cents, COUNT(*) as count
       FROM affiliate_commissions
       WHERE affiliate_program_id = $1
       AND status = $2
       AND created_at >= $3 AND created_at < $4`,
      [programId, 'pending', new Date(periodStart), new Date(periodEnd)]
    );

    const totalCommissionCents = commissions.rows[0]?.total_cents || 0;
    const commissionCount = commissions.rows[0]?.count || 0;

    if (totalCommissionCents === 0) {
      return sendError(res, 400, 'No commissions to payout for this period');
    }

    const payout = await withTransaction(async (client) => {
      // Create payout record
      const payoutResult = await client.query(
        `INSERT INTO affiliate_payouts
         (affiliate_program_id, period_start, period_end, total_commission_cents, commission_count, status)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [programId, periodStart, periodEnd, totalCommissionCents, commissionCount, 'pending']
      );

      const payoutId = payoutResult.rows[0].id;

      // Update commissions to reference payout
      await client.query(
        `UPDATE affiliate_commissions
         SET payout_id = $1, status = $2
         WHERE affiliate_program_id = $3 AND status = $4
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

      return payoutResult.rows[0];
    });

    logger.info('Payout calculated', { payoutId: payout.id, total: totalCommissionCents });

    res.json({
      success: true,
      data: payout
    });
  } catch (error) {
    logger.error('Error calculating payout', { error });
    sendError(res, 500, 'Failed to calculate payout');
  }
}

async function processPayout(req, res) {
  try {
    const userId = req.user?.id;
    const { payoutId } = req.params;
    const { payment_method_id, payout_method = 'stripe_direct' } = req.body;

    if (!userId) return sendError(res, 401, 'Unauthorized');

    // Get payout
    const payout = await pool.query(
      `SELECT ap.*, aprg.helper_id FROM affiliate_payouts ap
       JOIN affiliate_programs aprg ON ap.affiliate_program_id = aprg.id
       WHERE ap.id = $1 AND aprg.helper_id = $2`,
      [payoutId, userId]
    );

    if (!payout.rows.length) return sendError(res, 404, 'Payout not found');

    if (payout.rows[0].status !== 'pending') {
      return sendError(res, 400, 'Payout already processed or cancelled');
    }

    try {
      let payoutReference;

      // Process via Stripe
      if (payout_method === 'stripe_direct' && payment_method_id) {
        const stripePayout = await stripe.payouts.create({
          amount: payout.rows[0].total_commission_cents,
          currency: 'usd',
          destination: payment_method_id,
          metadata: {
            payoutId: payoutId.toString()
          }
        });
        payoutReference = stripePayout.id;
      }

      // Update payout record
      const updated = await pool.query(
        `UPDATE affiliate_payouts
         SET status = $1, payout_method = $2, payout_reference = $3, payment_method_id = $4, sent_at = CURRENT_TIMESTAMP
         WHERE id = $5
         RETURNING *`,
        ['processing', payout_method, payoutReference, payment_method_id, payoutId]
      );

      // Update program pending amount
      await pool.query(
        `UPDATE affiliate_programs
         SET pending_cents = pending_cents - $1
         WHERE id = (SELECT affiliate_program_id FROM affiliate_payouts WHERE id = $2)`,
        [payout.rows[0].total_commission_cents, payoutId]
      );

      logger.info('Payout processed', { payoutId, reference: payoutReference });

      res.json({
        success: true,
        data: updated.rows[0]
      });
    } catch (error) {
      // Log the error but still update status to failed
      logger.error('Stripe payout failed', { error });

      await pool.query(
        `UPDATE affiliate_payouts SET status = $1, failed_reason = $2 WHERE id = $3`,
        ['failed', error.message, payoutId]
      );

      sendError(res, 500, 'Failed to process payout: ' + error.message);
    }
  } catch (error) {
    logger.error('Error processing payout', { error });
    sendError(res, 500, 'Failed to process payout');
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
