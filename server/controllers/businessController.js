// server/controllers/businessController.js
// Business CRUD + analytics, goals, and tax estimates for the Business Hub.

const pool   = require('../db');
const logger = require('../utils/logger');
const { ownedBusiness, canEditProfile } = require('../utils/businessOwnership');

// ── IRS quarterly tax due dates (fixed schedule) ─────────────────────────────
const TAX_DUE_DATES = {
  1: (yr) => `${yr}-04-15`,   // Q1: Jan–Mar
  2: (yr) => `${yr}-06-15`,   // Q2: Apr–May
  3: (yr) => `${yr}-09-15`,   // Q3: Jun–Aug
  4: (yr) => `${yr + 1}-01-15`, // Q4: Sep–Dec (due January of next year)
};

// Quarter → income date range within a year
const QUARTER_RANGES = {
  1: { start: '01-01', end: '03-31' },
  2: { start: '04-01', end: '05-31' },
  3: { start: '06-01', end: '08-31' },
  4: { start: '09-01', end: '12-31' },
};

function currentQuarter() {
  const m = new Date().getMonth() + 1; // 1–12
  if (m <= 3)  return 1;
  if (m <= 5)  return 2;
  if (m <= 8)  return 3;
  return 4;
}

function round2(n) { return Math.round((n || 0) * 100) / 100; }

// ── List user's businesses ────────────────────────────────────────────────────
async function listBusinesses(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT id, business_name, business_type, description, website, phone,
              address_city, address_state, is_primary, is_active,
              tax_rate, logo_url, created_at
       FROM businesses
       WHERE user_id = $1
       ORDER BY is_primary DESC, created_at ASC`,
      [req.user.id]
    );
    return res.json({ businesses: rows });
  } catch (err) {
    logger.error('listBusinesses error', { err: err.message });
    return res.status(500).json({ error: 'Failed to load businesses' });
  }
}

// ── Add a business ────────────────────────────────────────────────────────────
async function addBusiness(req, res) {
  try {
    const {
      business_name, business_type, ein, description, website, phone,
      address_street, address_city, address_state, address_zip, tax_rate,
    } = req.body;

    if (!business_name?.trim()) {
      return res.status(400).json({ error: 'Business name is required' });
    }

    const { rows: existing } = await pool.query(
      'SELECT COUNT(*) as count FROM businesses WHERE user_id = $1',
      [req.user.id]
    );
    const isPrimary = parseInt(existing[0].count) === 0;

    const { rows: [biz] } = await pool.query(
      `INSERT INTO businesses
         (user_id, business_name, business_type, ein, description, website, phone,
          address_street, address_city, address_state, address_zip,
          is_primary, tax_rate)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        req.user.id, business_name.trim(), business_type || null, ein || null,
        description || null, website || null, phone || null,
        address_street || null, address_city || null, address_state || null,
        address_zip || null, isPrimary,
        tax_rate != null ? parseFloat(tax_rate) : 25.00,
      ]
    );

    return res.status(201).json({ business: biz });
  } catch (err) {
    logger.error('addBusiness error', { err: err.message });
    return res.status(500).json({ error: 'Failed to add business' });
  }
}

// ── Update a business ─────────────────────────────────────────────────────────
async function updateBusiness(req, res) {
  try {
    const { id } = req.params;

    // Allow owner OR active manager to update the business profile.
    const access = await canEditProfile(req.user.id, id);
    if (!access) return res.status(404).json({ error: 'Business not found' });

    const ownerId = access.owner_id;

    const {
      business_name, business_type, ein, description, website, phone,
      address_street, address_city, address_state, address_zip,
      is_active, tax_rate,
      // Public-profile fields
      logo_url, cover_photo_url,
      clear_logo_url, clear_cover_photo_url,
      // Helper-profile fields that surface on the public business page (belong to owner)
      profile_headline, service_radius_miles,
    } = req.body;

    const isOwner = req.user.id === ownerId;
    const logoExplicitNull = clear_logo_url === true;
    const coverExplicitNull = clear_cover_photo_url === true;
    // Managers may edit marketing/contact/address only — not tax identity or lifecycle flags.
    const sensitiveEin = isOwner ? ein : undefined;
    const sensitiveTax = isOwner ? tax_rate : undefined;
    const sensitiveActive = isOwner && is_active != null ? is_active : null;

    const { rows: [biz] } = await pool.query(
      `UPDATE businesses
       SET business_name   = COALESCE($1,  business_name),
           business_type   = COALESCE($2,  business_type),
           ein             = CASE WHEN $16::boolean THEN COALESCE($3, ein) ELSE ein END,
           description     = COALESCE($4,  description),
           website         = COALESCE($5,  website),
           phone           = COALESCE($6,  phone),
           address_street  = COALESCE($7,  address_street),
           address_city    = COALESCE($8,  address_city),
           address_state   = COALESCE($9,  address_state),
           address_zip     = COALESCE($10, address_zip),
           is_active       = CASE WHEN $16::boolean THEN COALESCE($11, is_active) ELSE is_active END,
           tax_rate        = CASE WHEN $16::boolean THEN COALESCE($12, tax_rate) ELSE tax_rate END,
           logo_url        = CASE WHEN $17::boolean THEN NULL ELSE COALESCE($13, logo_url) END,
           cover_photo_url = CASE WHEN $18::boolean THEN NULL ELSE COALESCE($14, cover_photo_url) END,
           updated_at      = NOW()
       WHERE id = $15
       RETURNING *`,
      [
        business_name, business_type,
        sensitiveEin !== undefined ? sensitiveEin : null,
        description, website, phone,
        address_street, address_city, address_state, address_zip,
        sensitiveActive,
        sensitiveTax != null ? parseFloat(sensitiveTax) : null,
        logo_url        || null,
        cover_photo_url || null,
        id,
        isOwner,
        logoExplicitNull,
        coverExplicitNull,
      ]
    );

    if (!biz) return res.status(404).json({ error: 'Business not found' });

    // Update profile_headline / service_radius_miles on the OWNER's helper_profiles
    // row (keyed by ownerId, not the requester — a manager editing profile must not
    // overwrite their own helper_profiles row).
    const helperCols   = [];
    const helperVals   = [];
    if (profile_headline !== undefined) {
      helperVals.push(profile_headline || null);
      helperCols.push(`profile_headline = $${helperVals.length}`);
    }
    if (service_radius_miles !== undefined) {
      helperVals.push(service_radius_miles != null ? parseFloat(service_radius_miles) : null);
      helperCols.push(`service_radius_miles = $${helperVals.length}`);
    }
    if (helperCols.length > 0) {
      helperVals.push(ownerId);
      const colNames = helperCols.map(c => c.split(' = ')[0]).join(', ');
      const colPlaceholders = helperVals.slice(0, -1).map((_, i) => `$${i + 1}`).join(', ');
      await pool.query(
        `INSERT INTO helper_profiles (user_id, ${colNames})
         VALUES ($${helperVals.length}, ${colPlaceholders})
         ON CONFLICT (user_id) DO UPDATE SET ${helperCols.join(', ')}, updated_at = NOW()`,
        helperVals
      );
    }

    return res.json({ business: biz });
  } catch (err) {
    logger.error('updateBusiness error', { err: err.message });
    return res.status(500).json({ error: 'Failed to update business' });
  }
}

// ── Upload business photos (logo + cover) ─────────────────────────────────────
// PUT /api/businesses/:id/photos  multipart/form-data
// fields: logo (optional), cover (optional)
// Access: owner OR active manager
async function uploadBusinessPhotos(req, res) {
  try {
    const { id } = req.params;

    // Allow owner OR active manager to upload photos.
    const access = await canEditProfile(req.user.id, id);
    if (!access) return res.status(404).json({ error: 'Business not found' });

    const { uploadFile, getPublicUrl } = require('../utils/storage');
    const updates = {};
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

    if (req.files?.logo?.[0]) {
      const file = req.files.logo[0];
      if (!allowed.includes(file.mimetype))
        return res.status(400).json({ error: 'Logo must be a JPG, PNG, WebP, or GIF' });
      const key = await uploadFile(file.buffer, 'business-logos', file.originalname, file.mimetype);
      updates.logo_url = key
        ? getPublicUrl(key)
        : `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
    }

    if (req.files?.cover?.[0]) {
      const file = req.files.cover[0];
      if (!allowed.includes(file.mimetype))
        return res.status(400).json({ error: 'Cover photo must be a JPG, PNG, WebP, or GIF' });
      const key = await uploadFile(file.buffer, 'business-covers', file.originalname, file.mimetype);
      updates.cover_photo_url = key
        ? getPublicUrl(key)
        : `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
    }

    if (Object.keys(updates).length === 0)
      return res.status(400).json({ error: 'No files uploaded' });

    // Access already verified above — update by id only (no user_id guard needed here).
    const setClauses = Object.keys(updates).map((k, i) => `${k} = $${i + 1}`).join(', ');
    const values = [...Object.values(updates), id];
    const { rows: [updated] } = await pool.query(
      `UPDATE businesses SET ${setClauses}, updated_at = NOW()
       WHERE id = $${values.length}
       RETURNING id, logo_url, cover_photo_url`,
      values
    );

    return res.json({ business: updated, ...updates });
  } catch (err) {
    logger.error('uploadBusinessPhotos error', { err: err.message });
    return res.status(500).json({ error: 'Failed to upload photos' });
  }
}

// ── Set primary business ──────────────────────────────────────────────────────
async function setPrimary(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    await pool.query('UPDATE businesses SET is_primary = FALSE WHERE user_id = $1', [userId]);
    const { rows: [biz] } = await pool.query(
      'UPDATE businesses SET is_primary = TRUE WHERE id = $1 AND user_id = $2 RETURNING *',
      [id, userId]
    );

    if (!biz) return res.status(404).json({ error: 'Business not found' });
    return res.json({ business: biz });
  } catch (err) {
    logger.error('setPrimary error', { err: err.message });
    return res.status(500).json({ error: 'Failed to set primary business' });
  }
}

// ── Delete a business ─────────────────────────────────────────────────────────
async function deleteBusiness(req, res) {
  try {
    const { id } = req.params;
    const { rowCount } = await pool.query(
      'DELETE FROM businesses WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Business not found' });
    return res.json({ ok: true });
  } catch (err) {
    logger.error('deleteBusiness error', { err: err.message });
    return res.status(500).json({ error: 'Failed to delete business' });
  }
}

// ── Analytics: P&L, trends, job stats ────────────────────────────────────────
// GET /api/businesses/:id/analytics?period=6m
async function getBusinessAnalytics(req, res) {
  try {
    const biz = await ownedBusiness(req.user.id, req.params.id);
    if (!biz) return res.status(404).json({ error: 'Business not found' });

    const bizId  = biz.id;
    const userId = req.user.id;

    // 6-month monthly breakdown
    const [invoiceRevRes, oxsteedRevRes, expenseRes, jobStatsRes, invoiceSummaryRes] = await Promise.all([

      // Paid invoice revenue by month (last 6 months)
      pool.query(`
        SELECT
          TO_CHAR(DATE_TRUNC('month', paid_at), 'YYYY-MM') AS month,
          COALESCE(SUM(total), 0)                           AS revenue
        FROM business_invoices
        WHERE business_id = $1
          AND status = 'paid'
          AND paid_at >= NOW() - INTERVAL '6 months'
        GROUP BY 1
        ORDER BY 1
      `, [bizId]),

      // OxSteed payment income by month (for primary business only)
      biz.is_primary
        ? pool.query(`
            SELECT
              TO_CHAR(DATE_TRUNC('month', COALESCE(captured_at, released_at)), 'YYYY-MM') AS month,
              COALESCE(SUM(helper_payout), 0) AS revenue
            FROM payments
            WHERE payee_id = $1
              AND status IN ('captured','released')
              AND COALESCE(captured_at, released_at) >= NOW() - INTERVAL '6 months'
            GROUP BY 1
            ORDER BY 1
          `, [userId])
        : Promise.resolve({ rows: [] }),

      // Business-tagged expenses by month
      pool.query(`
        SELECT
          TO_CHAR(DATE_TRUNC('month', occurred_at::date), 'YYYY-MM') AS month,
          COALESCE(SUM(amount), 0)                                     AS expenses
        FROM expenses
        WHERE business_id = $1
          AND type = 'expense'
          AND occurred_at >= CURRENT_DATE - INTERVAL '6 months'
        GROUP BY 1
        ORDER BY 1
      `, [bizId]),

      // OxSteed job stats (primary business only)
      biz.is_primary
        ? pool.query(`
            SELECT
              COUNT(*)::int AS jobs_completed,
              COALESCE(AVG(helper_payout), 0) AS avg_job_value,
              COALESCE(MAX(helper_payout), 0) AS max_job_value
            FROM payments
            WHERE payee_id = $1
              AND status IN ('captured','released')
              AND COALESCE(captured_at, released_at) >= NOW() - INTERVAL '6 months'
          `, [userId])
        : Promise.resolve({ rows: [{ jobs_completed: 0, avg_job_value: 0, max_job_value: 0 }] }),

      // Outstanding invoices summary
      pool.query(`
        SELECT
          COALESCE(SUM(total - amount_paid) FILTER (WHERE status IN ('sent','overdue')), 0) AS outstanding,
          COALESCE(SUM(total - amount_paid) FILTER (WHERE status = 'overdue'), 0)            AS overdue,
          COUNT(*) FILTER (WHERE status IN ('sent','overdue'))                                AS outstanding_count
        FROM business_invoices
        WHERE business_id = $1
      `, [bizId]),
    ]);

    // Merge monthly revenue (invoice + OxSteed) and expenses into a unified series
    const months = generateLast6Months();
    const invoiceByMonth  = Object.fromEntries(invoiceRevRes.rows.map(r  => [r.month, parseFloat(r.revenue)]));
    const oxsteedByMonth  = Object.fromEntries(oxsteedRevRes.rows.map(r  => [r.month, parseFloat(r.revenue)]));
    const expenseByMonth  = Object.fromEntries(expenseRes.rows.map(r     => [r.month, parseFloat(r.expenses)]));

    const monthly = months.map(m => {
      const revenue  = round2((invoiceByMonth[m] || 0) + (oxsteedByMonth[m] || 0));
      const expenses = round2(expenseByMonth[m] || 0);
      return { month: m, revenue, expenses, profit: round2(revenue - expenses) };
    });

    // MTD totals (current month only)
    const thisMo    = monthly[monthly.length - 1];
    const lastMo    = monthly[monthly.length - 2];

    // YTD totals
    const currentYear = new Date().getFullYear().toString();
    const ytd = monthly
      .filter(m => m.month.startsWith(currentYear))
      .reduce((acc, m) => ({
        revenue:  round2(acc.revenue + m.revenue),
        expenses: round2(acc.expenses + m.expenses),
        profit:   round2(acc.profit + m.profit),
      }), { revenue: 0, expenses: 0, profit: 0 });

    const jobStats    = jobStatsRes.rows[0];
    const invSummary  = invoiceSummaryRes.rows[0];

    return res.json({
      business_id: bizId,
      monthly,
      mtd: thisMo || { revenue: 0, expenses: 0, profit: 0 },
      last_month: lastMo || { revenue: 0, expenses: 0, profit: 0 },
      ytd,
      jobs_completed_6m:  parseInt(jobStats.jobs_completed || 0),
      avg_job_value:      round2(parseFloat(jobStats.avg_job_value || 0)),
      max_job_value:      round2(parseFloat(jobStats.max_job_value || 0)),
      outstanding_invoices: round2(parseFloat(invSummary.outstanding || 0)),
      overdue_invoices:     round2(parseFloat(invSummary.overdue || 0)),
      outstanding_count:    parseInt(invSummary.outstanding_count || 0),
    });
  } catch (err) {
    logger.error('getBusinessAnalytics error', { err: err.message });
    return res.status(500).json({ error: 'Failed to load analytics' });
  }
}

// ── Tax estimates ─────────────────────────────────────────────────────────────
// GET /api/businesses/:id/tax  — returns current + future estimates
// POST /api/businesses/:id/tax/refresh — recalculate based on latest data
async function getBusinessTax(req, res) {
  try {
    const biz = await ownedBusiness(req.user.id, req.params.id);
    if (!biz) return res.status(404).json({ error: 'Business not found' });

    const { rows } = await pool.query(
      `SELECT * FROM business_tax_estimates
       WHERE user_id = $1 AND (business_id = $2 OR business_id IS NULL)
       ORDER BY tax_year ASC, quarter ASC`,
      [req.user.id, biz.id]
    );

    return res.json({ estimates: rows, tax_rate: biz.tax_rate });
  } catch (err) {
    logger.error('getBusinessTax error', { err: err.message });
    return res.status(500).json({ error: 'Failed to load tax estimates' });
  }
}

async function refreshTaxEstimates(req, res) {
  try {
    const biz = await ownedBusiness(req.user.id, req.params.id);
    if (!biz) return res.status(404).json({ error: 'Business not found' });

    const userId   = req.user.id;
    const bizId    = biz.id;
    const taxRate  = parseFloat(biz.tax_rate) / 100;
    const year     = new Date().getFullYear();
    const cq       = currentQuarter();

    // Build estimates for current quarter + remaining quarters of this year
    const upserted = [];

    for (let q = cq; q <= 4; q++) {
      const range = QUARTER_RANGES[q];
      const qStart = `${year}-${range.start}`;
      const qEnd   = `${year}-${range.end}`;
      const dueDate = q < 4 ? TAX_DUE_DATES[q](year) : TAX_DUE_DATES[4](year);

      // Quarterly net income = OxSteed income (primary) + invoice income - biz expenses
      const [oxRes, invRes, expRes] = await Promise.all([
        biz.is_primary
          ? pool.query(`
              SELECT COALESCE(SUM(helper_payout), 0) AS total
              FROM payments
              WHERE payee_id = $1
                AND status IN ('captured','released')
                AND COALESCE(captured_at, released_at) BETWEEN $2::date AND $3::date + INTERVAL '1 day'
            `, [userId, qStart, qEnd])
          : Promise.resolve({ rows: [{ total: 0 }] }),

        pool.query(`
          SELECT COALESCE(SUM(total), 0) AS total
          FROM business_invoices
          WHERE business_id = $1 AND status = 'paid'
            AND paid_at BETWEEN $2::date AND $3::date + INTERVAL '1 day'
        `, [bizId, qStart, qEnd]),

        pool.query(`
          SELECT COALESCE(SUM(amount), 0) AS total
          FROM expenses
          WHERE business_id = $1 AND type = 'expense'
            AND occurred_at BETWEEN $2 AND $3
        `, [bizId, qStart, qEnd]),
      ]);

      const gross   = parseFloat(oxRes.rows[0].total) + parseFloat(invRes.rows[0].total);
      const deduct  = parseFloat(expRes.rows[0].total);
      const net     = Math.max(0, gross - deduct);
      const estTax  = round2(net * taxRate);

      const { rows: [est] } = await pool.query(`
        INSERT INTO business_tax_estimates
          (user_id, business_id, tax_year, quarter, estimated_net_income,
           tax_rate_used, estimated_tax, due_date, last_refreshed_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
        ON CONFLICT (user_id, business_id, tax_year, quarter)
        DO UPDATE SET
          estimated_net_income = EXCLUDED.estimated_net_income,
          tax_rate_used        = EXCLUDED.tax_rate_used,
          estimated_tax        = EXCLUDED.estimated_tax,
          last_refreshed_at    = NOW(),
          updated_at           = NOW()
        RETURNING *
      `, [userId, bizId, year, q, round2(net), parseFloat(biz.tax_rate), estTax, dueDate]);

      upserted.push(est);
    }

    return res.json({ estimates: upserted, tax_rate: biz.tax_rate });
  } catch (err) {
    logger.error('refreshTaxEstimates error', { err: err.message });
    return res.status(500).json({ error: 'Failed to refresh tax estimates' });
  }
}

async function markTaxPaid(req, res) {
  try {
    const biz = await ownedBusiness(req.user.id, req.params.id);
    if (!biz) return res.status(404).json({ error: 'Business not found' });

    const { amount } = req.body;
    const paidAmt = parseFloat(amount || 0);
    if (paidAmt <= 0) return res.status(400).json({ error: 'Amount must be positive' });

    const { rows: [est] } = await pool.query(`
      UPDATE business_tax_estimates
      SET status       = 'paid',
          paid_amount  = $1,
          paid_at      = NOW(),
          updated_at   = NOW()
      WHERE id = $2 AND user_id = $3
      RETURNING *
    `, [paidAmt, req.params.estimateId, req.user.id]);

    if (!est) return res.status(404).json({ error: 'Estimate not found' });
    return res.json({ estimate: est });
  } catch (err) {
    logger.error('markTaxPaid error', { err: err.message });
    return res.status(500).json({ error: 'Failed to mark tax paid' });
  }
}

// ── Business goals ────────────────────────────────────────────────────────────
async function listGoals(req, res) {
  try {
    const biz = await ownedBusiness(req.user.id, req.params.id);
    if (!biz) return res.status(404).json({ error: 'Business not found' });

    const { rows } = await pool.query(
      `SELECT * FROM business_goals WHERE business_id = $1 ORDER BY created_at DESC`,
      [biz.id]
    );
    return res.json({ goals: rows });
  } catch (err) {
    logger.error('listGoals error', { err: err.message });
    return res.status(500).json({ error: 'Failed to load goals' });
  }
}

async function createGoal(req, res) {
  try {
    const biz = await ownedBusiness(req.user.id, req.params.id);
    if (!biz) return res.status(404).json({ error: 'Business not found' });

    const { title, goal_type, period, target_value, period_start, period_end } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'Title is required' });
    if (!target_value || parseFloat(target_value) <= 0) return res.status(400).json({ error: 'Target value must be positive' });

    const { rows: [goal] } = await pool.query(`
      INSERT INTO business_goals
        (user_id, business_id, title, goal_type, period, target_value, period_start, period_end)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING *
    `, [
      req.user.id, biz.id, title.trim(), goal_type || 'revenue',
      period || 'monthly', parseFloat(target_value),
      period_start || null, period_end || null,
    ]);

    return res.status(201).json({ goal });
  } catch (err) {
    logger.error('createGoal error', { err: err.message });
    return res.status(500).json({ error: 'Failed to create goal' });
  }
}

async function updateGoal(req, res) {
  try {
    const biz = await ownedBusiness(req.user.id, req.params.id);
    if (!biz) return res.status(404).json({ error: 'Business not found' });

    const { title, target_value, current_value, is_completed } = req.body;
    const { rows: [goal] } = await pool.query(`
      UPDATE business_goals
      SET title         = COALESCE($1, title),
          target_value  = COALESCE($2, target_value),
          current_value = COALESCE($3, current_value),
          is_completed  = COALESCE($4, is_completed),
          updated_at    = NOW()
      WHERE id = $5 AND business_id = $6 AND user_id = $7
      RETURNING *
    `, [
      title, target_value ? parseFloat(target_value) : null,
      current_value != null ? parseFloat(current_value) : null,
      is_completed != null ? is_completed : null,
      req.params.goalId, biz.id, req.user.id,
    ]);

    if (!goal) return res.status(404).json({ error: 'Goal not found' });
    return res.json({ goal });
  } catch (err) {
    logger.error('updateGoal error', { err: err.message });
    return res.status(500).json({ error: 'Failed to update goal' });
  }
}

async function deleteGoal(req, res) {
  try {
    const biz = await ownedBusiness(req.user.id, req.params.id);
    if (!biz) return res.status(404).json({ error: 'Business not found' });

    const { rowCount } = await pool.query(
      'DELETE FROM business_goals WHERE id = $1 AND business_id = $2 AND user_id = $3',
      [req.params.goalId, biz.id, req.user.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Goal not found' });
    return res.json({ ok: true });
  } catch (err) {
    logger.error('deleteGoal error', { err: err.message });
    return res.status(500).json({ error: 'Failed to delete goal' });
  }
}

// ── helper: generate last 6 calendar month keys (YYYY-MM) ────────────────────
function generateLast6Months() {
  const months = [];
  const d = new Date();
  for (let i = 5; i >= 0; i--) {
    const t = new Date(d.getFullYear(), d.getMonth() - i, 1);
    months.push(
      `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`
    );
  }
  return months;
}

// ── Public business profile ───────────────────────────────────────────────────
// GET /api/businesses/:id/public — no auth required.
// Returns everything a customer needs to see the business profile page.
async function getBusinessPublicProfile(req, res) {
  try {
    const bizId = req.params.id;

    // Core business record + owner info
    const bizRes = await pool.query(
      `SELECT
         b.id, b.business_name, b.business_type, b.description,
         b.website, b.phone, b.logo_url,
         COALESCE(b.cover_photo_url, hp.cover_photo_url) AS cover_photo_url,
         b.address_city, b.address_state,
         b.is_primary, b.is_active, b.created_at,
         u.id           AS owner_id,
         u.first_name   AS owner_first_name,
         u.last_name    AS owner_last_name,
         hp.profile_headline,
         hp.profile_photo_url,
         hp.bio_short,
         hp.service_city, hp.service_state, hp.service_radius_miles,
         hp.avg_rating, hp.total_reviews, hp.completed_jobs_count,
         hp.is_identity_verified, hp.is_background_checked,
         hp.is_insured, hp.is_licensed
       FROM businesses b
       JOIN users u          ON u.id  = b.user_id
       LEFT JOIN helper_profiles hp ON hp.user_id = b.user_id
       WHERE b.id        = $1
         AND b.is_active = TRUE
         AND u.deleted_at IS NULL`,
      [bizId]
    );

    const biz = bizRes.rows[0];
    if (!biz) return res.status(404).json({ error: 'Business not found' });

    const ownerId = biz.owner_id;

    // Parallel: services, reviews, gallery, FAQs, policies, active team members
    const [svcRes, reviewRes, galRes, faqRes, polRes, teamRes] = await Promise.all([
      pool.query(
        `SELECT id, name, description, price, price_unit, duration, popular, category, sort_order
         FROM helper_services
         WHERE user_id = $1 AND is_active = TRUE
         ORDER BY sort_order, id`,
        [ownerId]
      ),
      pool.query(
        `SELECT r.id, r.rating, r.comment, r.created_at, r.response, r.response_at,
                u.first_name, u.last_name
         FROM reviews r
         JOIN users u ON u.id = r.reviewer_id
         WHERE r.reviewee_id = $1 AND r.is_public = TRUE
         ORDER BY r.created_at DESC
         LIMIT 20`,
        [ownerId]
      ),
      pool.query(
        `SELECT id, url, caption FROM helper_gallery WHERE user_id = $1 ORDER BY sort_order, id`,
        [ownerId]
      ),
      pool.query(
        `SELECT id, question, answer FROM helper_faqs WHERE user_id = $1 ORDER BY sort_order, id`,
        [ownerId]
      ),
      pool.query(
        `SELECT id, title, content, icon FROM helper_policies WHERE user_id = $1 ORDER BY sort_order, id`,
        [ownerId]
      ),
      // Active team members (name + role only — no email exposed publicly)
      pool.query(
        `SELECT bm.role, u.first_name, u.last_name
         FROM business_members bm
         JOIN users u ON u.id = bm.member_id
         WHERE bm.business_id = $1 AND bm.status = 'active'
         ORDER BY bm.accepted_at`,
        [bizId]
      ),
    ]);

    return res.json({
      business: {
        id:             biz.id,
        business_name:  biz.business_name,
        business_type:  biz.business_type,
        description:    biz.description,
        website:        biz.website,
        phone:          biz.phone,
        logo_url:       biz.logo_url,
        cover_photo_url: biz.cover_photo_url || null,
        address_city:   biz.address_city    || biz.service_city,
        address_state:  biz.address_state   || biz.service_state,
        service_radius_miles: biz.service_radius_miles,
        is_primary:     biz.is_primary,
        member_since:   biz.created_at,
        // Badge flags from owner's helper profile
        is_identity_verified:    biz.is_identity_verified,
        is_background_checked:   biz.is_background_checked,
        is_insured:              biz.is_insured,
        is_licensed:             biz.is_licensed,
        avg_rating:              biz.avg_rating,
        total_reviews:           biz.total_reviews,
        completed_jobs_count:    biz.completed_jobs_count,
        // Owner context — needed for chat initiation
        owner_id:        ownerId,
        owner_name:      `${biz.owner_first_name} ${biz.owner_last_name}`.trim(),
        owner_photo:     biz.profile_photo_url,
        profile_headline: biz.profile_headline,
        bio_short:       biz.bio_short,
      },
      services:  svcRes.rows,
      reviews:   reviewRes.rows,
      gallery:   galRes.rows,
      faqs:      faqRes.rows,
      policies:  polRes.rows,
      team:      teamRes.rows,
    });
  } catch (err) {
    logger.error('getBusinessPublicProfile error', { err: err.message });
    return res.status(500).json({ error: 'Failed to load business profile' });
  }
}

// ── Authenticated profile editor payload ──────────────────────────────────────
// GET /api/businesses/:id/profile-edit — owner or active manager; includes full address.
async function getBusinessProfileForEditor(req, res) {
  try {
    const { id } = req.params;
    const access = await canEditProfile(req.user.id, id);
    if (!access) return res.status(404).json({ error: 'Business not found' });

    const { rows: [row] } = await pool.query(
      `SELECT
         b.id,
         b.business_name,
         b.business_type,
         b.description,
         b.website,
         b.phone,
         b.address_street,
         b.address_city,
         b.address_state,
         b.address_zip,
         b.logo_url,
         b.cover_photo_url,
         hp.profile_headline,
         hp.service_radius_miles,
         hp.bio_short
       FROM businesses b
       LEFT JOIN helper_profiles hp ON hp.user_id = b.user_id
       WHERE b.id = $1`,
      [id]
    );
    if (!row) return res.status(404).json({ error: 'Business not found' });
    return res.json({ business: row });
  } catch (err) {
    logger.error('getBusinessProfileForEditor error', { err: err.message });
    return res.status(500).json({ error: 'Failed to load business profile' });
  }
}

module.exports = {
  listBusinesses, addBusiness, updateBusiness, setPrimary, deleteBusiness,
  uploadBusinessPhotos,
  getBusinessPublicProfile,
  getBusinessProfileForEditor,
  getBusinessAnalytics,
  getBusinessTax, refreshTaxEstimates, markTaxPaid,
  listGoals, createGoal, updateGoal, deleteGoal,
};
