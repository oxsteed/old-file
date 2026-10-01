const pool = require('../db');
const logger = require('../utils/logger');
const { sendError, sendValidationError } = require('../utils/apiError');
const { logAdminAction } = require('../services/auditService');

// C9: Idempotency-Key must be caller-supplied, URL-safe, and bounded.
function normalizeIdempotencyKey(value) {
  const candidate = String(value || '').trim();
  if (!/^[A-Za-z0-9:._-]{8,255}$/.test(candidate)) return null;
  return candidate;
}

class PayoutController {
  // Get all payouts for a helper
  static async getPayouts(req, res) {
    try {
      const { helper_id } = req.user;
      const { status, period_start, period_end, limit = 20, offset = 0 } = req.query;

      let query = `
        SELECT
          ap.*,
          pm.method_type,
          pm.account_holder_name,
          pm.bank_name,
          pm.paypal_email,
          u.first_name,
          u.last_name
        FROM affiliate_payouts ap
        LEFT JOIN payout_methods pm ON ap.payout_method_id = pm.id
        LEFT JOIN users u ON ap.helper_id = u.id
        WHERE ap.helper_id = $1
      `;

      const params = [helper_id];
      let paramIndex = 2;

      if (status) {
        query += ` AND ap.status = $${paramIndex}`;
        params.push(status);
        paramIndex++;
      }

      if (period_start) {
        query += ` AND ap.period_start >= $${paramIndex}`;
        params.push(new Date(period_start));
        paramIndex++;
      }

      if (period_end) {
        query += ` AND ap.period_end <= $${paramIndex}`;
        params.push(new Date(period_end));
        paramIndex++;
      }

      query += ` ORDER BY ap.period_end DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
      params.push(limit, offset);

      const result = await pool.query(query, params);

      // Get stats
      const statsQuery = `
        SELECT
          COUNT(*) as total_payouts,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_count,
          SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing_count,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_count,
          SUM(CASE WHEN status = 'completed' THEN net_payout_cents ELSE 0 END) as total_paid_cents,
          SUM(CASE WHEN status IN ('pending', 'processing') THEN net_payout_cents ELSE 0 END) as total_pending_cents
        FROM affiliate_payouts
        WHERE helper_id = $1
      `;

      const statsResult = await pool.query(statsQuery, [helper_id]);

      res.json({
        success: true,
        payouts: result.rows,
        stats: statsResult.rows[0],
        pagination: { limit: parseInt(limit), offset: parseInt(offset) }
      });
    } catch (err) {
      logger.error('Failed to get payouts', { error: err.message });
      sendError(res, 500, 'Failed to retrieve payouts');
    }
  }

  // Get single payout details
  static async getPayout(req, res) {
    try {
      const { payout_id } = req.params;
      const { helper_id } = req.user;

      const query = `
        SELECT
          ap.*,
          pm.method_type,
          pm.account_holder_name,
          pm.bank_name,
          pm.paypal_email,
          pm.stripe_account_id
        FROM affiliate_payouts ap
        LEFT JOIN payout_methods pm ON ap.payout_method_id = pm.id
        WHERE ap.id = $1 AND ap.helper_id = $2
      `;

      const result = await pool.query(query, [payout_id, helper_id]);

      if (!result.rows.length) {
        return sendError(res, 404, 'Payout not found');
      }

      const payout = result.rows[0];

      // Get commission breakdown
      const commissionsQuery = `
        SELECT
          ac.id,
          ac.product_id,
          ac.order_id,
          ac.commission_cents,
          ac.status,
          ac.created_at,
          mp.title as product_title,
          mo.total_price_cents
        FROM affiliate_commissions ac
        LEFT JOIN marketplace_products mp ON ac.product_id = mp.id
        LEFT JOIN marketplace_orders mo ON ac.order_id = mo.id
        WHERE ac.payout_id = $1
        ORDER BY ac.created_at DESC
        LIMIT 100
      `;

      const commissionsResult = await pool.query(commissionsQuery, [payout_id]);

      res.json({
        success: true,
        payout,
        commissions: commissionsResult.rows,
        commission_count: commissionsResult.rows.length
      });
    } catch (err) {
      logger.error('Failed to get payout', { error: err.message });
      sendError(res, 500, 'Failed to retrieve payout');
    }
  }

  // List payout methods
  static async getPayoutMethods(req, res) {
    try {
      const { helper_id } = req.user;

      const query = `
        SELECT *
        FROM payout_methods
        WHERE helper_id = $1
        ORDER BY is_primary DESC, created_at DESC
      `;

      const result = await pool.query(query, [helper_id]);

      res.json({
        success: true,
        payout_methods: result.rows
      });
    } catch (err) {
      logger.error('Failed to get payout methods', { error: err.message });
      sendError(res, 500, 'Failed to retrieve payout methods');
    }
  }

  // Create payout method
  static async createPayoutMethod(req, res) {
    try {
      const { helper_id } = req.user;
      const { method_type, account_holder_name, bank_name, account_last_four, routing_number_last_four, account_type, paypal_email } = req.body;

      if (!method_type) {
        return sendValidationError(res, { method_type: 'Required' });
      }

      const query = `
        INSERT INTO payout_methods (
          helper_id, method_type, account_holder_name, bank_name, account_last_four,
          routing_number_last_four, account_type, paypal_email, is_primary, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE, 'pending')
        RETURNING *
      `;

      const result = await pool.query(query, [
        helper_id,
        method_type,
        account_holder_name || null,
        bank_name || null,
        account_last_four || null,
        routing_number_last_four || null,
        account_type || null,
        paypal_email || null
      ]);

      logger.info('Payout method created', { helper_id, method_id: result.rows[0].id });

      res.status(201).json({
        success: true,
        payout_method: result.rows[0]
      });
    } catch (err) {
      logger.error('Failed to create payout method', { error: err.message });
      sendError(res, 500, 'Failed to create payout method');
    }
  }

  // Update payout method
  static async updatePayoutMethod(req, res) {
    try {
      const { method_id } = req.params;
      const { helper_id } = req.user;
      const { is_primary, status } = req.body;

      const query = `
        UPDATE payout_methods
        SET is_primary = COALESCE($3, is_primary), status = COALESCE($4, status), updated_at = NOW()
        WHERE id = $1 AND helper_id = $2
        RETURNING *
      `;

      const result = await pool.query(query, [method_id, helper_id, is_primary || null, status || null]);

      if (!result.rows.length) {
        return sendError(res, 404, 'Payout method not found');
      }

      res.json({
        success: true,
        payout_method: result.rows[0]
      });
    } catch (err) {
      logger.error('Failed to update payout method', { error: err.message });
      sendError(res, 500, 'Failed to update payout method');
    }
  }

  // Delete payout method
  static async deletePayoutMethod(req, res) {
    try {
      const { method_id } = req.params;
      const { helper_id } = req.user;

      const query = `
        DELETE FROM payout_methods
        WHERE id = $1 AND helper_id = $2
        RETURNING *
      `;

      const result = await pool.query(query, [method_id, helper_id]);

      if (!result.rows.length) {
        return sendError(res, 404, 'Payout method not found');
      }

      logger.info('Payout method deleted', { helper_id, method_id });

      res.json({ success: true });
    } catch (err) {
      logger.error('Failed to delete payout method', { error: err.message });
      sendError(res, 500, 'Failed to delete payout method');
    }
  }

  // Get payout statistics
  static async getPayoutStats(req, res) {
    try {
      const { helper_id } = req.user;
      // C2: validate days as a positive integer before it reaches SQL.
      const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 3650);

      const query = `
        SELECT
          COUNT(*) as total_payouts,
          SUM(CASE WHEN status = 'completed' THEN net_payout_cents ELSE 0 END) / 100.0 as total_paid,
          SUM(CASE WHEN status IN ('pending', 'processing') THEN net_payout_cents ELSE 0 END) / 100.0 as total_pending,
          AVG(CASE WHEN status = 'completed' THEN net_payout_cents ELSE NULL END) / 100.0 as average_payout,
          MAX(CASE WHEN status = 'completed' THEN period_end ELSE NULL END) as last_payout_date,
          COUNT(DISTINCT CASE WHEN created_at >= NOW() - make_interval(days => $2) THEN id ELSE NULL END) as payouts_this_period
        FROM affiliate_payouts
        WHERE helper_id = $1
      `;

      const result = await pool.query(query, [helper_id, days]);

      res.json({
        success: true,
        stats: result.rows[0]
      });
    } catch (err) {
      logger.error('Failed to get payout stats', { error: err.message });
      sendError(res, 500, 'Failed to retrieve payout statistics');
    }
  }

  // Admin: Process payout
  // C9: gated behind admin + the view_financials grant at the route level, and
  // additionally guarded here: no real money processor is wired yet, so this
  // endpoint refuses to mark payouts completed until PAYOUT_PROCESSOR_ENABLED
  // is set by an operator who has connected a processor.
  static async processPayout(req, res) {
    try {
      const { payout_id } = req.params;
      const { payment_processor = 'stripe' } = req.body;

      if (process.env.PAYOUT_PROCESSOR_ENABLED !== 'true') {
        return sendError(res, 503, 'Payout processing is not wired to a money processor yet');
      }

      const idempotencyKey = normalizeIdempotencyKey(
        req.get('Idempotency-Key') || req.body.idempotencyKey || req.body.idempotency_key
      );
      if (!idempotencyKey) {
        return sendError(res, 400, 'Idempotency-Key is required for payout processing');
      }

      // Start transaction
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // C9 idempotency: a replayed key returns the original result without
        // touching money movement again.
        const { rows: [existingTxn] } = await client.query(
          `SELECT pt.*, ap.status AS payout_status
             FROM payout_transactions pt
             JOIN affiliate_payouts ap ON ap.id = pt.payout_id
            WHERE pt.idempotency_key = $1`,
          [idempotencyKey]
        );
        if (existingTxn) {
          await client.query('ROLLBACK');
          logger.info('Payout process idempotency replay', { payout_id, idempotencyKey });
          return res.json({ success: true, replayed: true, transaction: existingTxn });
        }

        // Get payout details with a row lock and claim it atomically: only a
        // pending payout may move to processing, so concurrent requests (or a
        // double click) cannot send the same payout twice.
        const payoutResult = await client.query(
          `SELECT ap.*, pm.stripe_account_id, pm.paypal_email, u.email
             FROM affiliate_payouts ap
             LEFT JOIN payout_methods pm ON ap.payout_method_id = pm.id
             LEFT JOIN users u ON ap.helper_id = u.id
            WHERE ap.id = $1
            FOR UPDATE`,
          [payout_id]
        );

        if (!payoutResult.rows.length) {
          await client.query('ROLLBACK');
          return sendError(res, 404, 'Payout not found');
        }

        const payout = payoutResult.rows[0];
        if (payout.status !== 'pending') {
          await client.query('ROLLBACK');
          return sendError(res, 409, 'Payout is not pending');
        }

        // Claim the row before touching the processor.
        const { rows: [claimed] } = await client.query(
          `UPDATE affiliate_payouts
              SET status = 'processing', updated_at = NOW()
            WHERE id = $1 AND status = 'pending'
            RETURNING *`,
          [payout_id]
        );
        if (!claimed) {
          await client.query('ROLLBACK');
          return sendError(res, 409, 'Payout is already being processed');
        }

        // Wire the real processor here (Stripe Connect / PayPal) before this
        // endpoint is enabled in production. Until then PAYOUT_PROCESSOR_ENABLED
        // stays unset and the guard above keeps this path unreachable.
        const updateQuery = `
          UPDATE affiliate_payouts
          SET status = 'completed', payment_processor = $2, updated_at = NOW()
          WHERE id = $1
          RETURNING *
        `;

        const result = await client.query(updateQuery, [payout_id, payment_processor]);

        // Log transaction
        await client.query(
          `INSERT INTO payout_transactions (payout_id, transaction_status, idempotency_key)
           VALUES ($1, 'completed', $2)`,
          [payout_id, idempotencyKey]
        );

        // H7: transactional audit row; fails closed because a client is passed.
        await logAdminAction({
          client,
          adminId: req.user?.id || null,
          action: 'process_payout',
          targetType: 'affiliate_payout',
          targetId: String(payout_id),
          after: {
            status: 'completed',
            payment_processor,
            helper_id: payout.helper_id || null,
            net_payout_cents: payout.net_payout_cents || null,
            idempotency_key: idempotencyKey,
          },
        });

        await client.query('COMMIT');

        logger.info('Payout processed', { payout_id, payment_processor });

        res.json({
          success: true,
          payout: result.rows[0]
        });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      logger.error('Failed to process payout', { error: err.message });
      sendError(res, 500, 'Failed to process payout');
    }
  }
}

module.exports = PayoutController;
