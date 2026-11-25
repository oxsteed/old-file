'use strict';
// Groups 5-6 items 231 (invoice overview), 232 (refund request tracker),
// 233 (payout reconciliation), 234 (expense categories). Read models plus
// owner bookkeeping; nothing here moves money.
const pool = require('../../db');
const { withTransaction } = require('../../utils/transaction');
const { fail, invalid, text, int } = require('./common');

const BASE = ['materials', 'labor', 'vehicle', 'software', 'marketing', 'equipment', 'utilities', 'other'];
const toCents = expr => `ROUND(COALESCE(${expr},0)*100)::bigint`;

// 231: aging buckets on open invoices + month totals.
async function invoiceOverview(businessId) {
  const { rows: [t] } = await pool.query(`SELECT
      COUNT(*) FILTER (WHERE status='draft')::int AS drafts,
      COUNT(*) FILTER (WHERE status NOT IN ('draft','paid','void','cancelled'))::int AS open_count,
      COALESCE(SUM(${toCents('total')} - ${toCents('amount_paid')}) FILTER (WHERE status NOT IN ('draft','paid','void','cancelled')),0)::bigint AS outstanding_cents,
      COALESCE(SUM(${toCents('total')} - ${toCents('amount_paid')}) FILTER (WHERE status NOT IN ('draft','paid','void','cancelled') AND (due_date IS NULL OR due_date >= CURRENT_DATE)),0)::bigint AS current_cents,
      COALESCE(SUM(${toCents('total')} - ${toCents('amount_paid')}) FILTER (WHERE status NOT IN ('draft','paid','void','cancelled') AND due_date < CURRENT_DATE AND due_date >= CURRENT_DATE - 30),0)::bigint AS d1_30_cents,
      COALESCE(SUM(${toCents('total')} - ${toCents('amount_paid')}) FILTER (WHERE status NOT IN ('draft','paid','void','cancelled') AND due_date < CURRENT_DATE - 30 AND due_date >= CURRENT_DATE - 60),0)::bigint AS d31_60_cents,
      COALESCE(SUM(${toCents('total')} - ${toCents('amount_paid')}) FILTER (WHERE status NOT IN ('draft','paid','void','cancelled') AND due_date < CURRENT_DATE - 60 AND due_date >= CURRENT_DATE - 90),0)::bigint AS d61_90_cents,
      COALESCE(SUM(${toCents('total')} - ${toCents('amount_paid')}) FILTER (WHERE status NOT IN ('draft','paid','void','cancelled') AND due_date < CURRENT_DATE - 90),0)::bigint AS d90_plus_cents,
      COALESCE(SUM(${toCents('total')}) FILTER (WHERE status NOT IN ('draft','void','cancelled') AND issue_date >= date_trunc('month', CURRENT_DATE)),0)::bigint AS invoiced_this_month_cents,
      COALESCE(SUM(${toCents('amount_paid')}) FILTER (WHERE paid_at >= date_trunc('month', NOW())),0)::bigint AS collected_this_month_cents
    FROM business_invoices WHERE business_id=$1`, [businessId]);
  const { rows: overdue } = await pool.query(`SELECT id, invoice_number, client_name, due_date, (${toCents('total')} - ${toCents('amount_paid')}) AS balance_cents, CURRENT_DATE - due_date AS days_overdue
    FROM business_invoices WHERE business_id=$1 AND status NOT IN ('draft','paid','void','cancelled') AND due_date < CURRENT_DATE ORDER BY due_date LIMIT 20`, [businessId]);
  return { totals: t, overdue };
}

// 232: every refund request this business queued, newest first.
async function refundTracker(businessId) {
  const { rows } = await pool.query(`SELECT a.id, a.status, a.amount_cents, a.currency_code, a.created_at, a.decided_at, a.decision_reason,
      a.payload->>'reason' AS reason, a.payload->>'jobId' AS job_id, j.title AS job_title, TRIM(CONCAT(u.first_name,' ',u.last_name)) AS requested_by_name
    FROM money_movement_approvals a LEFT JOIN jobs j ON j.id::text = a.payload->>'jobId' LEFT JOIN users u ON u.id=a.requested_by
    WHERE a.movement_type='job_refund' AND a.payload->>'businessId' = $1 ORDER BY a.created_at DESC LIMIT 200`, [String(businessId)]);
  const counts = rows.reduce((m, r) => { m[r.status] = (m[r.status] || 0) + 1; return m; }, {});
  return { requests: rows, counts };
}

// 233: card-collected payments vs recorded bank deposits.
const PAYMENT_ITEMS = `SELECT 'invoice' AS source, i.id::text AS source_id, ${toCents('i.amount_paid')} AS amount_cents, i.paid_at AS paid_at, COALESCE(i.invoice_number, i.id::text) AS label
    FROM business_invoices i WHERE i.business_id=$1 AND i.stripe_payment_intent_id IS NOT NULL AND i.amount_paid > 0
  UNION ALL
  SELECT 'appointment', a.id::text, COALESCE(a.final_price_cents, a.base_price_cents, 0)::bigint, a.updated_at, COALESCE(s.name,'') || ' · ' || COALESCE(a.customer_name,'')
    FROM business_appointments a LEFT JOIN business_services s ON s.id=a.service_id
   WHERE a.business_id=$1 AND a.payment_status='paid' AND a.stripe_payment_intent_id IS NOT NULL`;
async function reconciliation(businessId) {
  const { rows: unmatched } = await pool.query(`SELECT p.* FROM (${PAYMENT_ITEMS}) p
    WHERE NOT EXISTS (SELECT 1 FROM business_payout_deposit_items d WHERE d.business_id=$1 AND d.source=p.source AND d.source_id=p.source_id)
    ORDER BY p.paid_at DESC NULLS LAST LIMIT 200`, [businessId]);
  const { rows: deposits } = await pool.query(`SELECT d.*, COALESCE(SUM(i.amount_cents),0)::bigint AS matched_cents, COUNT(i.id)::int AS items
    FROM business_payout_deposits d LEFT JOIN business_payout_deposit_items i ON i.deposit_id=d.id WHERE d.business_id=$1 GROUP BY d.id ORDER BY d.deposited_on DESC, d.id DESC LIMIT 100`, [businessId]);
  return {
    unmatched, unmatched_cents: unmatched.reduce((n, r) => n + Number(r.amount_cents), 0),
    deposits: deposits.map(d => ({ ...d, variance_cents: Number(d.amount_cents) - Number(d.matched_cents) })),
  };
}
async function recordDeposit(businessId, actorId, body) {
  const amount = int(body?.amount_cents, { min: 1, max: 1e11, field: 'amount_cents' });
  if (typeof body?.deposited_on !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.deposited_on)) invalid('deposited_on');
  const reference = text(body.reference, 100, { required: false });
  const note = text(body.note, 500, { required: false });
  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length > 500 || items.some(i => !['invoice', 'appointment'].includes(i?.source) || typeof i.source_id !== 'string')) invalid('items');
  return withTransaction(pool, async db => {
    const { rows: [d] } = await db.query('INSERT INTO business_payout_deposits(business_id,amount_cents,deposited_on,reference,note,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *', [businessId, amount, body.deposited_on, reference, note, actorId]);
    if (items.length) {
      // Only this business's card payments can be matched, each at most once.
      const { rows: valid } = await db.query(`SELECT p.source, p.source_id, p.amount_cents FROM (${PAYMENT_ITEMS}) p
        JOIN jsonb_to_recordset($2::jsonb) AS x(source text, source_id text) ON x.source=p.source AND x.source_id=p.source_id`, [businessId, JSON.stringify(items)]);
      if (valid.length !== new Set(items.map(i => `${i.source}:${i.source_id}`)).size) fail(404, 'not_found');
      for (const v of valid) {
        const r = await db.query('INSERT INTO business_payout_deposit_items(deposit_id,business_id,source,source_id,amount_cents) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING id', [d.id, businessId, v.source, v.source_id, v.amount_cents]);
        if (!r.rows.length) fail(409, 'payment_already_matched');
      }
    }
    return d;
  }, 'business_payout_deposit');
}
async function deleteDeposit(businessId, depositId) {
  const id = int(depositId, { min: 1, field: 'deposit' });
  const { rowCount } = await pool.query('DELETE FROM business_payout_deposits WHERE id=$1 AND business_id=$2', [id, businessId]);
  if (!rowCount) fail(404, 'not_found');
  return { deleted: true };
}

// 234: business-defined categories that roll up to the fixed base set.
async function listCategories(businessId) {
  const { rows } = await pool.query(`SELECT c.*, COALESCE(SUM(e.amount_cents) FILTER (WHERE e.approval_status='approved'),0)::bigint AS total_cents, COUNT(e.id)::int AS expenses
    FROM business_expense_categories c LEFT JOIN business_expenses e ON e.custom_category_id=c.id WHERE c.business_id=$1 GROUP BY c.id ORDER BY c.is_archived, LOWER(c.name)`, [businessId]);
  return { categories: rows, base: BASE };
}
async function saveCategory(businessId, actorId, body, categoryId) {
  const name = text(body?.name, 60);
  if (!BASE.includes(body?.base_category)) invalid('base_category');
  try {
    if (categoryId) {
      const id = int(categoryId, { min: 1, field: 'category' });
      const { rows: [row] } = await pool.query('UPDATE business_expense_categories SET name=$3, base_category=$4, is_archived=$5, updated_at=NOW() WHERE id=$1 AND business_id=$2 RETURNING *', [id, businessId, name, body.base_category, body.is_archived === true]);
      if (!row) fail(404, 'not_found');
      await pool.query('UPDATE business_expenses SET category=$3 WHERE business_id=$1 AND custom_category_id=$2', [businessId, id, body.base_category]);
      return row;
    }
    const { rows: [count] } = await pool.query('SELECT COUNT(*)::int AS n FROM business_expense_categories WHERE business_id=$1', [businessId]);
    if (count.n >= 100) fail(409, 'category_limit');
    const { rows: [row] } = await pool.query('INSERT INTO business_expense_categories(business_id,name,base_category,created_by) VALUES($1,$2,$3,$4) RETURNING *', [businessId, name, body.base_category, actorId]);
    return row;
  } catch (e) {
    if (e.code === '23505') fail(409, 'category_exists');
    throw e;
  }
}
// Used by the expense create/update controller.
async function resolveCustomCategory(businessId, customCategoryId) {
  if (customCategoryId == null || customCategoryId === '') return null;
  const id = int(customCategoryId, { min: 1, field: 'custom_category_id' });
  const { rows: [c] } = await pool.query('SELECT id, base_category FROM business_expense_categories WHERE id=$1 AND business_id=$2 AND is_archived=FALSE', [id, businessId]);
  if (!c) fail(400, 'validation_failed', 'Unknown expense category');
  return c;
}

module.exports = { invoiceOverview, refundTracker, reconciliation, recordDeposit, deleteDeposit, listCategories, saveCategory, resolveCustomCategory };
