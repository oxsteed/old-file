const db     = require('../db');
const logger = require('../utils/logger');

exports.listPayments = async (req, res) => {
  try {
    const { status = '', date_from = '', date_to = '', page = 1, limit = 25 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const params = []; let p = 1; const conds = [];

    if (status) { conds.push(`p.status = $${p++}`); params.push(status); }
    if (date_from) { conds.push(`p.created_at >= $${p++}`); params.push(date_from); }
    if (date_to) {
      conds.push(`p.created_at < ($${p}::date + interval '1 day')`);
      params.push(date_to);
      p++;
    }
    const wc = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

    const { rows } = await db.query(`
      SELECT p.id, p.amount, p.platform_fee, p.helper_payout, p.status,
             p.stripe_payment_intent_id, p.stripe_transfer_id,
             p.captured_at, p.released_at, p.refunded_at, p.created_at,
             j.id AS job_id, j.title AS job_title,
             payer.id AS payer_id,
             payer.first_name || ' ' || payer.last_name AS payer_name,
             payer.email AS payer_email,
             payee.id AS payee_id,
             payee.first_name || ' ' || payee.last_name AS payee_name,
             payee.email AS payee_email
        FROM payments p
        LEFT JOIN jobs j ON p.job_id = j.id
        JOIN users payer ON p.payer_id = payer.id
        JOIN users payee ON p.payee_id = payee.id
        ${wc}
       ORDER BY p.created_at DESC
       LIMIT $${p} OFFSET $${p + 1}
    `, [...params, parseInt(limit), offset]);

    const { rows: countRows } = await db.query(
      `SELECT COUNT(*) FROM payments p JOIN users payer ON p.payer_id = payer.id JOIN users payee ON p.payee_id = payee.id ${wc}`,
      params
    );
    res.json({ payments: rows, total: parseInt(countRows[0].count) });
  } catch (err) {
    logger.error('listPayments error', { err });
    res.status(500).json({ error: 'Failed to fetch payments.' });
  }
};
