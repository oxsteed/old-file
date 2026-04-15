'use strict';

const db = require('../db');
const logger = require('../utils/logger');

async function tableExists(name) {
  try {
    const { rows } = await db.query(
      `SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = $1`,
      [name]
    );
    return rows.length > 0;
  } catch {
    return false;
  }
}

exports.listPayments = async (req, res) => {
  try {
    if (!(await tableExists('payments'))) {
      return res.json({ payments: [], total: 0 });
    }
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const offset = (page - 1) * limit;
    const status = (req.query.status || '').trim();
    const from = (req.query.from || '').trim();
    const to = (req.query.to || '').trim();

    const params = [];
    let i = 1;
    const cond = [];
    if (status) {
      cond.push(`p.status = $${i++}`);
      params.push(status);
    }
    if (from) {
      cond.push(`p.created_at >= $${i++}::timestamptz`);
      params.push(from);
    }
    if (to) {
      cond.push(`p.created_at < ($${i++}::timestamptz + interval '1 day')`);
      params.push(to);
    }
    const wc = cond.length ? `WHERE ${cond.join(' AND ')}` : '';

    const { rows } = await db.query(
      `SELECT p.id, p.job_id, p.payer_id, p.payee_id, p.amount, p.platform_fee,
              p.helper_payout, p.currency, p.status, p.escrow_status,
              p.stripe_payment_intent_id, p.created_at, p.updated_at,
              j.title AS job_title,
              up.first_name || ' ' || up.last_name AS payer_name,
              up.email AS payer_email,
              uy.first_name || ' ' || uy.last_name AS payee_name,
              uy.email AS payee_email
         FROM payments p
         LEFT JOIN jobs j ON j.id = p.job_id
         JOIN users up ON up.id = p.payer_id
         JOIN users uy ON uy.id = p.payee_id
         ${wc}
         ORDER BY p.created_at DESC
         LIMIT $${i} OFFSET $${i + 1}`,
      [...params, limit, offset]
    );
    const { rows: c } = await db.query(
      `SELECT COUNT(*)::int AS n FROM payments p ${wc}`,
      params
    );
    res.json({ payments: rows, total: c[0]?.n || 0, page, limit });
  } catch (err) {
    logger.error('listPayments admin error', { err });
    res.status(500).json({ error: 'Failed to list payments.' });
  }
};
