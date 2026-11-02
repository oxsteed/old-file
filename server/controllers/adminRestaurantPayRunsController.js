'use strict';

// Admin read-only visibility for restaurant pay runs (finding 25).
// A finalized run alone never reads as paid: the detail payload carries
// its payout links, the linked total, and each linked payout's status,
// so an admin can see exactly which completed payouts funded a run.

const pool = require('../db');

async function listPayRuns(req, res, next) {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const restaurantId = req.query.restaurant_id ? parseInt(req.query.restaurant_id, 10) : null;
    const status = req.query.status || null;
    const conditions = [];
    const params = [];
    if (Number.isSafeInteger(restaurantId) && restaurantId > 0) {
      params.push(restaurantId);
      conditions.push(`pr.restaurant_id = $${params.length}`);
    }
    if (status && ['draft', 'finalized', 'voided', 'paid'].includes(status)) {
      params.push(status);
      conditions.push(`pr.status = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await pool.query(
      `SELECT pr.*, fr.display_name AS restaurant_name,
              (SELECT COALESCE(SUM(amount_cents), 0)::int FROM restaurant_pay_run_payout_links l WHERE l.pay_run_id = pr.id) AS linked_payout_cents,
              (SELECT COUNT(*)::int FROM restaurant_pay_run_payout_links l WHERE l.pay_run_id = pr.id) AS payout_link_count
         FROM restaurant_pay_runs pr
         JOIN food_restaurants fr ON fr.id = pr.restaurant_id
         ${where}
        ORDER BY pr.period_from DESC, pr.id DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );
    const { rows: [countRow] } = await pool.query(
      `SELECT COUNT(*)::int AS total FROM restaurant_pay_runs pr ${where}`,
      params
    );
    res.json({ payRuns: rows, total: Number(countRow?.total || 0), limit, offset });
  } catch (err) {
    next(err);
  }
}

async function getPayRun(req, res, next) {
  try {
    const payRunId = parseInt(req.params.payRunId, 10);
    if (!Number.isSafeInteger(payRunId) || payRunId <= 0) {
      return res.status(404).json({ error: 'Pay run not found' });
    }
    const { rows: [run] } = await pool.query(
      `SELECT pr.*, fr.display_name AS restaurant_name
         FROM restaurant_pay_runs pr
         JOIN food_restaurants fr ON fr.id = pr.restaurant_id
        WHERE pr.id = $1`,
      [payRunId]
    );
    if (!run) return res.status(404).json({ error: 'Pay run not found' });
    const { rows: lines } = await pool.query(
      'SELECT * FROM restaurant_pay_run_lines WHERE pay_run_id = $1 ORDER BY id',
      [payRunId]
    );
    const { rows: payoutLinks } = await pool.query(
      `SELECT l.*, p.status AS payout_status, p.amount_cents AS payout_amount_cents,
              p.currency_code AS payout_currency_code, p.completed_at AS payout_completed_at
         FROM restaurant_pay_run_payout_links l
         JOIN restaurant_payouts p ON p.id = l.restaurant_payout_id
        WHERE l.pay_run_id = $1 ORDER BY l.id`,
      [payRunId]
    ).catch(() => ({ rows: [] }));
    const linkedPayoutCents = payoutLinks.reduce((sum, link) => sum + Number(link.amount_cents || 0), 0);
    res.json({ payRun: { ...run, lines, payoutLinks, linkedPayoutCents } });
  } catch (err) {
    next(err);
  }
}

module.exports = { listPayRuns, getPayRun };
