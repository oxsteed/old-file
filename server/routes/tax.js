/**
 * Tax document routes — annual summaries for helpers & business owners.
 * GET /api/tax/summary?year=2025
 * GET /api/tax/expenses?year=2025
 * GET /api/tax/1099-preview?year=2025
 */
'use strict';

const express    = require('express');
const router     = express.Router();
const pool       = require('../db');
const { authenticate } = require('../middleware/auth');

// ── Annual earnings + expense summary ────────────────────────────────────────
router.get('/summary', authenticate, async (req, res, next) => {
  const userId = req.user.id;
  const year   = parseInt(req.query.year) || new Date().getFullYear();

  try {
    // Gross earnings from completed jobs (as helper)
    const earningsRow = await pool.query(`
      SELECT COALESCE(SUM(p.amount_cents), 0) AS gross_cents,
             COUNT(DISTINCT p.job_id)         AS job_count
      FROM payments p
      JOIN jobs j ON j.id = p.job_id
      WHERE j.assigned_helper_id = $1
        AND p.status = 'completed'
        AND EXTRACT(YEAR FROM p.created_at) = $2
    `, [userId, year]).catch(() => ({ rows: [{ gross_cents: 0, job_count: 0 }] }));

    // Business revenue (as business owner)
    const businessRow = await pool.query(`
      SELECT COALESCE(SUM(bi.total_cents), 0) AS revenue_cents,
             COUNT(bi.id)                     AS invoice_count
      FROM business_invoices bi
      JOIN businesses b ON b.id = bi.business_id
      WHERE b.user_id = $1
        AND bi.status = 'paid'
        AND EXTRACT(YEAR FROM bi.created_at) = $2
    `, [userId, year]).catch(() => ({ rows: [{ revenue_cents: 0, invoice_count: 0 }] }));

    // Business expenses
    const expenseRow = await pool.query(`
      SELECT COALESCE(SUM(be.amount_cents), 0) AS total_expense_cents,
             COUNT(be.id)                      AS expense_count
      FROM business_expenses be
      JOIN businesses b ON b.id = be.business_id
      WHERE b.user_id = $1
        AND EXTRACT(YEAR FROM be.expense_date) = $2
    `, [userId, year]).catch(() => ({ rows: [{ total_expense_cents: 0, expense_count: 0 }] }));

    // Expense breakdown by category
    const categoryRow = await pool.query(`
      SELECT be.category,
             COALESCE(SUM(be.amount_cents), 0) AS total_cents,
             COUNT(be.id)                       AS count
      FROM business_expenses be
      JOIN businesses b ON b.id = be.business_id
      WHERE b.user_id = $1
        AND EXTRACT(YEAR FROM be.expense_date) = $2
      GROUP BY be.category
      ORDER BY total_cents DESC
    `, [userId, year]).catch(() => ({ rows: [] }));

    const grossCents   = parseInt(earningsRow.rows[0].gross_cents)  || 0;
    const revenueCents = parseInt(businessRow.rows[0].revenue_cents) || 0;
    const expenseCents = parseInt(expenseRow.rows[0].total_expense_cents) || 0;
    const totalIncome  = grossCents + revenueCents;

    res.json({
      year,
      helper_earnings: {
        gross_cents: grossCents,
        job_count:   parseInt(earningsRow.rows[0].job_count) || 0,
      },
      business_revenue: {
        revenue_cents:  revenueCents,
        invoice_count:  parseInt(businessRow.rows[0].invoice_count) || 0,
      },
      total_income_cents: totalIncome,
      total_expense_cents: expenseCents,
      net_income_cents: totalIncome - expenseCents,
      expense_by_category: categoryRow.rows.map(r => ({
        category:    r.category,
        total_cents: parseInt(r.total_cents),
        count:       parseInt(r.count),
      })),
      // IRS threshold: 1099-NEC required if gross >= $600
      form_1099_required: grossCents >= 60000,
      disclaimer: 'This summary is for informational purposes only and does not constitute tax advice. Consult a tax professional.',
    });
  } catch (err) {
    next(err);
  }
});

// ── Deductible expense line items ─────────────────────────────────────────────
router.get('/expenses', authenticate, async (req, res, next) => {
  const userId = req.user.id;
  const year   = parseInt(req.query.year) || new Date().getFullYear();
  const limit  = Math.min(parseInt(req.query.limit) || 200, 500);
  const offset = parseInt(req.query.offset) || 0;

  try {
    const rows = await pool.query(`
      SELECT be.id, be.category, be.description, be.amount_cents,
             be.expense_date, be.receipt_url, be.notes, b.name AS business_name
      FROM business_expenses be
      JOIN businesses b ON b.id = be.business_id
      WHERE b.user_id = $1
        AND EXTRACT(YEAR FROM be.expense_date) = $2
      ORDER BY be.expense_date DESC
      LIMIT $3 OFFSET $4
    `, [userId, year, limit, offset]).catch(() => ({ rows: [] }));

    const total = await pool.query(`
      SELECT COUNT(*) AS cnt
      FROM business_expenses be
      JOIN businesses b ON b.id = be.business_id
      WHERE b.user_id = $1 AND EXTRACT(YEAR FROM be.expense_date) = $2
    `, [userId, year]).catch(() => ({ rows: [{ cnt: 0 }] }));

    res.json({
      year,
      expenses: rows.rows,
      total: parseInt(total.rows[0].cnt) || 0,
    });
  } catch (err) {
    next(err);
  }
});

// ── 1099 preview (payment details per payer) ─────────────────────────────────
router.get('/1099-preview', authenticate, async (req, res, next) => {
  const userId = req.user.id;
  const year   = parseInt(req.query.year) || new Date().getFullYear();

  try {
    const rows = await pool.query(`
      SELECT
        COALESCE(u.first_name || ' ' || u.last_name, 'Unknown') AS payer_name,
        u.email                                                  AS payer_email,
        b.name                                                   AS business_name,
        COALESCE(SUM(p.amount_cents), 0)                         AS total_paid_cents,
        COUNT(p.id)                                              AS payment_count
      FROM payments p
      JOIN jobs j     ON j.id = p.job_id
      JOIN users u    ON u.id = j.client_id
      LEFT JOIN businesses b ON b.user_id = u.id
      WHERE j.assigned_helper_id = $1
        AND p.status = 'completed'
        AND EXTRACT(YEAR FROM p.created_at) = $2
      GROUP BY u.id, u.first_name, u.last_name, u.email, b.name
      ORDER BY total_paid_cents DESC
    `, [userId, year]).catch(() => ({ rows: [] }));

    res.json({
      year,
      payers: rows.rows.map(r => ({
        payer_name:        r.payer_name,
        payer_email:       r.payer_email,
        business_name:     r.business_name,
        total_paid_cents:  parseInt(r.total_paid_cents),
        payment_count:     parseInt(r.payment_count),
        form_required:     parseInt(r.total_paid_cents) >= 60000,
      })),
      disclaimer: 'For informational purposes only. Consult a tax professional.',
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
