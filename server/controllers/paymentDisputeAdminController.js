'use strict';

/**
 * Review P3-821: admin lifecycle for main-app refund/payment disputes
 * (main_app_payment_disputes). Decisions are audited and the filer is
 * notified. Approving records the decision; the money itself moves through
 * the existing audited refund tools (the decision references them).
 */
const pool = require('../db');
const logger = require('../utils/logger');
const { withTransaction } = require('../utils/transaction');
const { logAdminAction } = require('../services/auditService');
const { sendNotification } = require('../services/notificationService');

const STATUSES = ['open', 'under_review', 'approved', 'denied', 'resolved', 'withdrawn'];
const TRANSITIONS = Object.freeze({
  open: ['under_review', 'approved', 'denied', 'resolved'],
  under_review: ['approved', 'denied', 'resolved'],
  approved: ['resolved'],
});
const TERMINAL = new Set(['denied', 'resolved', 'withdrawn']);

exports.listPaymentDisputes = async (req, res, next) => {
  try {
    const status = STATUSES.includes(req.query.status) ? req.query.status : null;
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 200);
    const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);
    const { rows } = await pool.query(
      `SELECT d.*, u.first_name || ' ' || u.last_name AS user_name, u.email AS user_email,
              t.ticket_number AS support_ticket_number, t.status AS support_ticket_status
         FROM main_app_payment_disputes d
         LEFT JOIN users u ON u.id = d.user_id
         LEFT JOIN support_tickets t ON t.id = d.support_ticket_uuid
        WHERE ($1::text IS NULL OR d.status = $1)
        ORDER BY d.opened_at DESC
        LIMIT $2 OFFSET $3`,
      [status, limit, offset]
    );
    res.json({ disputes: rows, limit, offset });
  } catch (err) {
    next(err);
  }
};

exports.decidePaymentDispute = async (req, res, next) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    const nextStatus = String(req.body?.status || '');
    const note = String(req.body?.note || '').trim().slice(0, 2000);
    const refundReference = req.body?.refundReference ? String(req.body.refundReference).slice(0, 160) : null;
    if (!Number.isSafeInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid dispute id', code: 'invalid_id' });
    }
    if (!note) {
      return res.status(400).json({ error: 'A decision note is required', code: 'note_required' });
    }

    const result = await withTransaction(pool, async (client) => {
      const { rows: [current] } = await client.query(
        'SELECT * FROM main_app_payment_disputes WHERE id = $1 FOR UPDATE', [id]
      );
      if (!current) return { status: 404, body: { error: 'Dispute not found', code: 'not_found' } };
      if (!(TRANSITIONS[current.status] || []).includes(nextStatus)) {
        return { status: 409, body: { error: `Cannot move a ${current.status} dispute to ${nextStatus}`, code: 'invalid_transition' } };
      }
      const decision = { status: nextStatus, note, decidedBy: req.user.id, decidedAt: new Date().toISOString(), refundReference };
      const { rows: [updated] } = await client.query(
        `UPDATE main_app_payment_disputes
            SET status = $2,
                resolved_at = CASE WHEN $3 THEN NOW() ELSE resolved_at END,
                metadata = metadata || jsonb_build_object('decisions', COALESCE(metadata->'decisions', '[]'::jsonb) || $4::jsonb),
                updated_at = NOW()
          WHERE id = $1
          RETURNING *`,
        [id, nextStatus, TERMINAL.has(nextStatus), JSON.stringify([decision])]
      );
      await logAdminAction({
        client,
        adminId: req.user.id,
        action: 'payment_dispute_decision',
        targetType: 'main_app_payment_dispute',
        targetId: String(id),
        description: note,
        before: { status: current.status },
        after: { status: nextStatus, refundReference },
        req,
        throwOnError: true,
      });
      return { status: 200, body: { dispute: updated }, userId: current.user_id };
    }, 'payment_dispute_decision');

    if (result.status === 200 && result.userId) {
      await sendNotification({
        userId: result.userId,
        type: 'payment_dispute_updated',
        data: { status: nextStatus },
        action_url: '/support/my-tickets',
        idempotencyKey: `payment_dispute:${id}:${nextStatus}`,
      }).catch((e) => logger.warn('Payment dispute notification failed', { id, error: e.message }));
    }
    res.status(result.status).json(result.body);
  } catch (err) {
    next(err);
  }
};

exports.TRANSITIONS = TRANSITIONS;
