const pool = require('../db');
const logger = require('../utils/logger');
const { sendError, sendValidationError } = require('../utils/apiError');
const { logAdminAction, logUserAction } = require('../services/auditService');
const { affiliatePayableCents } = require('../utils/affiliatePayableCents');

// C9: Idempotency-Key must be caller-supplied, URL-safe, and bounded.
function normalizeIdempotencyKey(value) {
  const candidate = String(value || '').trim();
  if (!/^[A-Za-z0-9:._-]{8,255}$/.test(candidate)) return null;
  return candidate;
}

class PayoutController {
  // P3-1-F12: payout destination changes used to leave only a logger.info
  // line, so an account-takeover payout redirection was silent. Every
  // change now writes an audit row and notifies the account owner; both are
  // best-effort after the mutation commits so they can never block it.
  static async auditPayoutDestinationChange({ userId, methodId, methodType, detail, req }) {
    try {
      await logUserAction({
        adminId: userId,
        targetUserId: userId,
        actionType: 'payout_destination_changed',
        fieldName: 'payout_method',
        oldValue: null,
        newValue: `${methodType}:${methodId}`,
        ipAddress: req?.ip || null,
        notes: `self-service: ${detail}`,
      });
    } catch (auditErr) {
      logger.error('Failed to audit payout destination change', { userId, methodId, error: auditErr.message });
    }
    try {
      const { sendNotification } = require('../services/notificationService');
      await sendNotification({
        userId,
        type: 'payout_destination_changed',
        data: { payout_method_id: methodId },
        action_url: '/settings/payouts',
        idempotencyKey: `payout-destination:${methodId}:${Date.now()}`,
      });
    } catch (notifyErr) {
      logger.warn('Failed to notify payout destination change', { userId, methodId, error: notifyErr.message });
    }
  }

  // Get all payouts for a helper
  static async getPayouts(req, res) {
    try {
      // Review P3-786: auth never sets req.user.helper_id; payout methods and
      // affiliate programs key on the user id.
      const helper_id = req.user?.id;
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
        LEFT JOIN affiliate_programs apg ON apg.id = ap.affiliate_program_id
        LEFT JOIN users u ON apg.helper_id = u.id
        WHERE ap.affiliate_program_id IN (SELECT id FROM affiliate_programs WHERE helper_id = $1)
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
        FROM affiliate_payouts ap
        WHERE ap.affiliate_program_id IN (SELECT id FROM affiliate_programs WHERE helper_id = $1)
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
      // Review P3-786: auth never sets req.user.helper_id; payout methods and
      // affiliate programs key on the user id.
      const helper_id = req.user?.id;

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
        WHERE ap.id = $1 AND ap.affiliate_program_id IN (SELECT id FROM affiliate_programs WHERE helper_id = $2)
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
      // Review P3-786: auth never sets req.user.helper_id; payout methods and
      // affiliate programs key on the user id.
      const helper_id = req.user?.id;

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
      // Review P3-786: auth never sets req.user.helper_id; payout methods and
      // affiliate programs key on the user id.
      const helper_id = req.user?.id;
      const { method_type, account_holder_name, bank_name, account_last_four, routing_number_last_four, account_type, paypal_email } = req.body;

      if (!method_type) {
        return sendValidationError(res, { method_type: 'Required' });
      }
      if (!['bank_account', 'paypal', 'stripe_connect'].includes(method_type)) {
        return sendValidationError(res, { method_type: 'Must be bank_account, paypal or stripe_connect' });
      }

      let stripeAccountId = null;
      if (method_type === 'stripe_connect') {
        const { rows: connectRows } = await pool.query(
          `SELECT stripe_account_id, payouts_enabled
             FROM connect_accounts
            WHERE user_id = $1
            ORDER BY updated_at DESC NULLS LAST
            LIMIT 1`,
          [helper_id]
        );
        stripeAccountId = connectRows[0]?.stripe_account_id || null;
        if (!stripeAccountId || !connectRows[0]?.payouts_enabled) {
          return sendError(res, 409, 'Complete Stripe Connect onboarding before adding a payout method');
        }
      }
      // P2-8-F12: the insert always used is_primary=TRUE, so adding a second
      // method hit the unique_primary_method_per_helper partial index and
      // 500ed. Demote the existing primary in the same transaction; the
      // advisory lock serializes concurrent creates for one helper.
      const client = await pool.connect();
      let result;
      try {
        await client.query('BEGIN');
        await client.query(
          `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
          [`payout-method:${helper_id}`]
        );
        await client.query(
          `UPDATE payout_methods SET is_primary = FALSE
            WHERE helper_id = $1 AND is_primary = TRUE`,
          [helper_id]
        );
        const query = `
          INSERT INTO payout_methods (
            helper_id, method_type, account_holder_name, bank_name, account_last_four,
            routing_number_last_four, account_type, paypal_email, stripe_account_id, is_primary, status
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE, 'pending')
          RETURNING *
        `;

        result = await client.query(query, [
          helper_id,
          method_type,
          account_holder_name || null,
          bank_name || null,
          account_last_four || null,
          routing_number_last_four || null,
          account_type || null,
          paypal_email || null,
          stripeAccountId
        ]);
        await client.query('COMMIT');
      } catch (txErr) {
        await client.query('ROLLBACK');
        throw txErr;
      } finally {
        client.release();
      }

      logger.info('Payout method created', { helper_id, method_id: result.rows[0].id });

      // P3-1-F12: audit + notify on payout destination changes.
      await PayoutController.auditPayoutDestinationChange({
        userId: helper_id,
        methodId: result.rows[0].id,
        methodType: method_type,
        detail: 'payout method added and set as primary',
        req,
      });

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
      // Review P3-786: auth never sets req.user.helper_id; payout methods and
      // affiliate programs key on the user id.
      const helper_id = req.user?.id;
      const { is_primary, status } = req.body;

      // Review P2-616: verification is set only by the payout processor or an
      // admin. The owner may deactivate a method, and may make it primary only
      // once it is verified or active.
      if (status !== undefined && status !== null && status !== 'inactive') {
        return sendError(res, 400, 'You can only deactivate a payout method. Verification is done by OxSteed.');
      }
      if (is_primary !== undefined && is_primary !== null && typeof is_primary !== 'boolean') {
        return sendError(res, 400, 'is_primary must be true or false');
      }

      const existing = await pool.query(
        'SELECT id, status FROM payout_methods WHERE id = $1 AND helper_id = $2',
        [method_id, helper_id]
      );
      if (!existing.rows.length) {
        return sendError(res, 404, 'Payout method not found');
      }
      const nextStatus = status || existing.rows[0].status;
      if (is_primary === true && !['verified', 'active'].includes(String(nextStatus))) {
        return sendError(res, 409, 'Only a verified payout method can be your primary method.');
      }

      const query = `
        UPDATE payout_methods
        SET is_primary = CASE WHEN $4::text = 'inactive' THEN FALSE ELSE COALESCE($3, is_primary) END,
            status = COALESCE($4, status),
            updated_at = NOW()
        WHERE id = $1 AND helper_id = $2
        RETURNING *
      `;

      const result = await pool.query(query, [method_id, helper_id, typeof is_primary === 'boolean' ? is_primary : null, status || null]);

      if (!result.rows.length) {
        return sendError(res, 404, 'Payout method not found');
      }

      // P3-1-F12: audit + notify on payout destination changes (primary
      // switches and deactivations both redirect where money goes).
      await PayoutController.auditPayoutDestinationChange({
        userId: helper_id,
        methodId: result.rows[0].id,
        methodType: result.rows[0].method_type,
        detail: `payout method updated (is_primary=${result.rows[0].is_primary}, status=${result.rows[0].status})`,
        req,
      });

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
      // Review P3-786: auth never sets req.user.helper_id; payout methods and
      // affiliate programs key on the user id.
      const helper_id = req.user?.id;

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

      // P3-1-F12: deleting a payout method redirects where money goes, so it
      // gets the same audit row + owner notification as adds/updates.
      await PayoutController.auditPayoutDestinationChange({
        userId: helper_id,
        methodId: result.rows[0].id,
        methodType: result.rows[0].method_type,
        detail: `payout method deleted (was_primary=${result.rows[0].is_primary}, status=${result.rows[0].status})`,
        req,
      });

      res.json({ success: true });
    } catch (err) {
      logger.error('Failed to delete payout method', { error: err.message });
      sendError(res, 500, 'Failed to delete payout method');
    }
  }

  // Get payout statistics
  static async getPayoutStats(req, res) {
    try {
      // Review P3-786: auth never sets req.user.helper_id; payout methods and
      // affiliate programs key on the user id.
      const helper_id = req.user?.id;
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
        FROM affiliate_payouts ap
        WHERE ap.affiliate_program_id IN (SELECT id FROM affiliate_programs WHERE helper_id = $1)
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
        // touching money movement again. The lookup is scoped to this
        // payout: reusing a key on a different payout must not report the
        // first payout's transaction as the second payout's success.
        const { rows: [existingTxn] } = await client.query(
          `SELECT pt.*, ap.status AS payout_status
             FROM payout_transactions pt
             JOIN affiliate_payouts ap ON ap.id = pt.payout_id
            WHERE pt.idempotency_key = $1 AND pt.payout_id = $2`,
          [idempotencyKey, payout_id]
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
          `SELECT ap.*, aprg.helper_id AS helper_id, pm.stripe_account_id, pm.paypal_email, pm.status AS payout_method_status,
                  ca.payouts_enabled AS connect_payouts_enabled, u.email
             FROM affiliate_payouts ap
             JOIN affiliate_programs aprg ON aprg.id = ap.affiliate_program_id
             LEFT JOIN payout_methods pm ON ap.payout_method_id = pm.id AND pm.helper_id = aprg.helper_id
             LEFT JOIN connect_accounts ca ON ca.stripe_account_id = pm.stripe_account_id AND ca.user_id = aprg.helper_id
             LEFT JOIN users u ON aprg.helper_id = u.id
            WHERE ap.id = $1
            FOR UPDATE OF ap`,
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

        // Pentest fix: the legacy direct-execution route must honor the
        // same dual-approval gate as the newer affiliate route. Above the
        // threshold the payout queues for a second admin (the checker
        // executes via the affiliate_payout executor); below it, execution
        // proceeds here as before. The gate amount is the payable net, and
        // expectedAmountCents binds the checker to that same figure.
        const { requestMoneyMovementApproval } = require('../services/dualApprovalService');
        const amountCents = affiliatePayableCents(payout);
        const gate = await requestMoneyMovementApproval({
          movementType: 'affiliate_payout',
          referenceKey: `affiliate-payout:${payout_id}`,
          amountCents,
          currencyCode: 'USD',
          requestedBy: req.user?.id || null,
          idempotencyKey,
          payload: { payoutId: payout_id, makerAdminId: req.user?.id || null, expectedAmountCents: amountCents },
        });
        if (gate.queued) {
          await client.query('ROLLBACK');
          const { sendMoneyMovementGateResult } = require('../utils/dualApprovalHttp');
          return sendMoneyMovementGateResult(res, gate);
        }

        // Lock and re-read the processor-backed method before claiming money.
        // PostgreSQL cannot lock the nullable sides of the outer joins above.
        // These inner joins also bind the method and Connect account to the
        // payout owner and serialize deactivation/capability updates.
        const { rows: [method] } = await client.query(
          `SELECT pm.status AS payout_method_status, pm.stripe_account_id,
                  ca.payouts_enabled AS connect_payouts_enabled
             FROM payout_methods pm
             JOIN connect_accounts ca ON ca.stripe_account_id = pm.stripe_account_id
                                    AND ca.user_id = pm.helper_id
            WHERE pm.id = $1 AND pm.helper_id = $2
            FOR UPDATE OF pm, ca`,
          [payout.payout_method_id, payout.helper_id]
        );
        if (!method) {
          await client.query('ROLLBACK');
          return sendError(res, 409, 'Payout method has no matching Stripe Connect account');
        }
        Object.assign(payout, method);

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

        if (payout.connect_payouts_enabled !== true) {
          await client.query('ROLLBACK');
          return sendError(res, 409, 'Stripe Connect payouts are not enabled');
        }
        if (payout.stripe_account_id && payout.connect_payouts_enabled === true
          && payout.payout_method_status === 'pending') {
          await client.query(
            `UPDATE payout_methods
                SET status = 'verified', verified_at = COALESCE(verified_at, NOW()), updated_at = NOW()
              WHERE id = $2 AND stripe_account_id = $1 AND status = 'pending'`,
            [payout.stripe_account_id, payout.payout_method_id]
          );
          payout.payout_method_status = 'verified';
        }
        if (!['verified', 'active'].includes(String(payout.payout_method_status))) {
          await client.query('ROLLBACK');
          return sendError(res, 409, 'Payout method is not verified');
        }

        // Review P3-785: move the money before marking the payout completed.
        // Stripe Connect transfer from the platform balance to the verified
        // payout method's connected account. Any failure rolls the claim back.
        const transfer = await sendAffiliatePayoutTransfer(payout, payment_processor);

        const updateQuery = `
          UPDATE affiliate_payouts
          SET status = 'completed', payment_processor = $2, payout_reference = $3,
              sent_at = NOW(), updated_at = NOW()
          WHERE id = $1
          RETURNING *
        `;

        const result = await client.query(updateQuery, [payout_id, payment_processor, transfer.id]);

        // Log transaction
        await client.query(
          `INSERT INTO payout_transactions (payout_id, transaction_status, idempotency_key, external_transaction_id)
           VALUES ($1, 'completed', $2, $3)`,
          [payout_id, idempotencyKey, transfer.id]
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
            stripe_transfer_id: transfer.id,
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
      logger.error('Failed to process payout', { error: err.message, code: err.code });
      if (err.payoutStatus) return sendError(res, err.payoutStatus, err.message);
      sendError(res, 500, 'Failed to process payout');
    }
  }
}

function payoutError(message, status) {
  const err = new Error(message);
  err.payoutStatus = status;
  return err;
}

async function sendAffiliatePayoutTransfer(payout, processor) {
  if (processor !== 'stripe') {
    throw payoutError('Only Stripe Connect payouts are supported.', 422);
  }
  if (!payout.stripe_account_id) {
    throw payoutError('The payout method has no connected Stripe account.', 422);
  }
  if (!['verified', 'active'].includes(String(payout.payout_method_status || ''))) {
    throw payoutError('The payout method is not verified.', 409);
  }
  const amountCents = affiliatePayableCents(payout);
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    throw payoutError('The payout amount is not valid.', 422);
  }
  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  return stripe.transfers.create(
    {
      amount: amountCents,
      currency: 'usd',
      destination: payout.stripe_account_id,
      transfer_group: `affiliate-payout-${payout.id}`,
      metadata: { affiliate_payout_id: String(payout.id), helper_id: String(payout.helper_id || '') },
    },
    { idempotencyKey: `affiliate-payout:${payout.id}` },
  );
}

PayoutController._sendAffiliatePayoutTransfer = sendAffiliatePayoutTransfer;

module.exports = PayoutController;
