'use strict';
const db = require('../db');
const { hashIP } = require('../utils/encryption');

// ── Valid entity types the search engine covers ───────────────────────────────
const ALL_ENTITY_TYPES = [
  'users', 'jobs', 'messages',
  'disputes', 'payments', 'support_tickets', 'reviews', 'bids',
];
const MAX_PER_TYPE = 10; // per-entity cap per page
const DEFAULT_PAGE = 1;

// ── Main search handler ───────────────────────────────────────────────────────

exports.search = async (req, res) => {
  const adminId = req.user.id;
  const rawQuery = (req.query.q || '').trim();

  if (rawQuery.length < 2) {
    return res.status(400).json({ error: 'Query must be at least 2 characters.' });
  }
  if (rawQuery.length > 200) {
    return res.status(400).json({ error: 'Query too long.' });
  }

  // Which entity types to search (defaults to all)
  const requestedTypes = req.query.types
    ? req.query.types.split(',').map(t => t.trim()).filter(t => ALL_ENTITY_TYPES.includes(t))
    : [...ALL_ENTITY_TYPES];

  if (requestedTypes.length === 0) {
    return res.status(400).json({ error: `Valid types: ${ALL_ENTITY_TYPES.join(', ')}` });
  }

  // Pagination
  const page   = Math.max(1, parseInt(req.query.page) || DEFAULT_PAGE);
  const limit  = Math.min(Math.max(1, parseInt(req.query.limit) || MAX_PER_TYPE), 50);
  const offset = (page - 1) * limit;

  // Escape ILIKE special characters
  const escaped = rawQuery.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
  const ilike   = `%${escaped}%`;

  try {
    // ── Run all searches in parallel ─────────────────────────────────────────
    const [
      usersRes, jobsRes, messagesRes,
      disputesRes, paymentsRes, supportRes, reviewsRes, bidsRes,
    ] = await Promise.allSettled([

      // ── Users ──────────────────────────────────────────────────────────────
      requestedTypes.includes('users')
        ? db.query(`
            SELECT
              u.id, u.first_name, u.last_name, u.email, u.role,
              u.is_active, u.is_banned, u.created_at,
              hp.avg_rating, hp.completed_jobs_count,
              COUNT(*) OVER() AS total_count
            FROM users u
            LEFT JOIN helper_profiles hp ON hp.user_id = u.id
            WHERE u.deleted_at IS NULL
              AND u.role NOT IN ('admin', 'super_admin')
              AND (
                u.first_name ILIKE $1
                OR u.last_name  ILIKE $1
                OR u.email      ILIKE $1
                OR u.phone      ILIKE $1
                OR (u.first_name || ' ' || u.last_name) ILIKE $1
                OR u.id::text   ILIKE $1
              )
            ORDER BY u.created_at DESC
            LIMIT $2 OFFSET $3
          `, [ilike, limit, offset])
        : Promise.resolve({ rows: [] }),

      // ── Jobs ───────────────────────────────────────────────────────────────
      requestedTypes.includes('jobs')
        ? db.query(`
            SELECT
              j.id, j.title, j.status, j.category_name,
              j.location_city, j.location_state,
              j.budget_min, j.budget_max, j.created_at,
              u.first_name || ' ' || u.last_name AS client_name,
              u.email AS client_email,
              COUNT(*) OVER() AS total_count
            FROM jobs j
            JOIN users u ON u.id = j.client_id
            WHERE (
              j.title            ILIKE $1
              OR j.description   ILIKE $1
              OR j.location_city ILIKE $1
              OR j.category_name ILIKE $1
              OR j.id::text      ILIKE $1
              OR (u.first_name || ' ' || u.last_name) ILIKE $1
              OR u.email         ILIKE $1
            )
            ORDER BY j.created_at DESC
            LIMIT $2 OFFSET $3
          `, [ilike, limit, offset])
        : Promise.resolve({ rows: [] }),

      // ── Messages ───────────────────────────────────────────────────────────
      requestedTypes.includes('messages')
        ? db.query(`
            SELECT
              m.id, m.content, m.created_at, m.conversation_id,
              s.first_name || ' ' || s.last_name AS sender_name,
              s.email AS sender_email, s.id AS sender_id,
              COUNT(*) OVER() AS total_count
            FROM messages m
            JOIN users s ON s.id = m.sender_id
            WHERE m.content ILIKE $1
            ORDER BY m.created_at DESC
            LIMIT $2 OFFSET $3
          `, [ilike, limit, offset])
        : Promise.resolve({ rows: [] }),

      // ── Disputes ───────────────────────────────────────────────────────────
      requestedTypes.includes('disputes')
        ? db.query(`
            SELECT
              d.id, d.reason, d.description, d.status,
              d.resolution_type, d.refund_amount, d.created_at,
              j.title AS job_title, j.id AS job_id,
              rb.first_name || ' ' || rb.last_name AS raised_by_name,
              rb.email AS raised_by_email,
              au.first_name || ' ' || au.last_name AS against_name,
              au.email AS against_email,
              COUNT(*) OVER() AS total_count
            FROM disputes d
            JOIN jobs  j  ON j.id  = d.job_id
            JOIN users rb ON rb.id = d.raised_by
            JOIN users au ON au.id = d.against_user
            WHERE (
              d.description ILIKE $1
              OR d.reason    ILIKE $1
              OR d.resolution ILIKE $1
              OR d.id::text  ILIKE $1
              OR j.title     ILIKE $1
              OR (rb.first_name || ' ' || rb.last_name) ILIKE $1
              OR rb.email    ILIKE $1
              OR (au.first_name || ' ' || au.last_name) ILIKE $1
              OR au.email    ILIKE $1
            )
            ORDER BY d.created_at DESC
            LIMIT $2 OFFSET $3
          `, [ilike, limit, offset])
        : Promise.resolve({ rows: [] }),

      // ── Payments ───────────────────────────────────────────────────────────
      requestedTypes.includes('payments')
        ? db.query(`
            SELECT
              p.id, p.amount, p.platform_fee, p.helper_payout,
              p.status, p.escrow_status, p.currency,
              p.stripe_payment_intent_id, p.stripe_charge_id,
              p.created_at,
              j.title AS job_title, j.id AS job_id,
              pr.first_name || ' ' || pr.last_name AS payer_name,
              pr.email AS payer_email,
              pe.first_name || ' ' || pe.last_name AS payee_name,
              pe.email AS payee_email,
              COUNT(*) OVER() AS total_count
            FROM payments p
            JOIN jobs  j  ON j.id  = p.job_id
            JOIN users pr ON pr.id = p.payer_id
            JOIN users pe ON pe.id = p.payee_id
            WHERE (
              p.stripe_payment_intent_id ILIKE $1
              OR p.stripe_charge_id      ILIKE $1
              OR p.stripe_transfer_id    ILIKE $1
              OR p.id::text              ILIKE $1
              OR j.title                 ILIKE $1
              OR (pr.first_name || ' ' || pr.last_name) ILIKE $1
              OR pr.email                ILIKE $1
              OR (pe.first_name || ' ' || pe.last_name) ILIKE $1
              OR pe.email                ILIKE $1
            )
            ORDER BY p.created_at DESC
            LIMIT $2 OFFSET $3
          `, [ilike, limit, offset])
        : Promise.resolve({ rows: [] }),

      // ── Support Tickets ────────────────────────────────────────────────────
      requestedTypes.includes('support_tickets')
        ? db.query(`
            SELECT
              st.id, st.ticket_number, st.subject, st.category,
              st.priority, st.status, st.name, st.email,
              st.created_at, st.resolved_at,
              u.first_name || ' ' || u.last_name AS user_name,
              u.id AS user_id,
              COUNT(*) OVER() AS total_count
            FROM support_tickets st
            LEFT JOIN users u ON u.id = st.user_id
            WHERE (
              st.subject    ILIKE $1
              OR st.name    ILIKE $1
              OR st.email   ILIKE $1
              OR st.category ILIKE $1
              OR st.ticket_number::text ILIKE $1
              OR st.id::text ILIKE $1
              OR (u.first_name || ' ' || u.last_name) ILIKE $1
            )
            ORDER BY st.created_at DESC
            LIMIT $2 OFFSET $3
          `, [ilike, limit, offset])
        : Promise.resolve({ rows: [] }),

      // ── Reviews ────────────────────────────────────────────────────────────
      requestedTypes.includes('reviews')
        ? db.query(`
            SELECT
              r.id, r.rating, r.comment, r.is_public, r.created_at,
              j.title AS job_title, j.id AS job_id,
              rr.first_name || ' ' || rr.last_name AS reviewer_name,
              rr.email AS reviewer_email,
              re.first_name || ' ' || re.last_name AS reviewee_name,
              re.email AS reviewee_email,
              COUNT(*) OVER() AS total_count
            FROM reviews r
            JOIN jobs  j  ON j.id  = r.job_id
            JOIN users rr ON rr.id = r.reviewer_id
            JOIN users re ON re.id = r.reviewee_id
            WHERE (
              r.comment  ILIKE $1
              OR r.id::text ILIKE $1
              OR j.title ILIKE $1
              OR (rr.first_name || ' ' || rr.last_name) ILIKE $1
              OR rr.email ILIKE $1
              OR (re.first_name || ' ' || re.last_name) ILIKE $1
              OR re.email ILIKE $1
            )
            ORDER BY r.created_at DESC
            LIMIT $2 OFFSET $3
          `, [ilike, limit, offset])
        : Promise.resolve({ rows: [] }),

      // ── Bids ───────────────────────────────────────────────────────────────
      requestedTypes.includes('bids')
        ? db.query(`
            SELECT
              b.id, b.amount, b.status, b.message, b.eta_hours,
              b.created_at,
              j.title AS job_title, j.id AS job_id,
              h.first_name || ' ' || h.last_name AS helper_name,
              h.email AS helper_email, h.id AS helper_id,
              COUNT(*) OVER() AS total_count
            FROM bids b
            JOIN jobs  j ON j.id = b.job_id
            JOIN users h ON h.id = b.helper_id
            WHERE (
              b.message   ILIKE $1
              OR b.id::text ILIKE $1
              OR j.title  ILIKE $1
              OR (h.first_name || ' ' || h.last_name) ILIKE $1
              OR h.email  ILIKE $1
            )
            ORDER BY b.created_at DESC
            LIMIT $2 OFFSET $3
          `, [ilike, limit, offset])
        : Promise.resolve({ rows: [] }),
    ]);

    // ── Extract rows + totals ─────────────────────────────────────────────────
    function extract(settled) {
      if (settled.status !== 'fulfilled') return { rows: [], total: 0 };
      const rows = settled.value.rows;
      const total = rows.length > 0 ? parseInt(rows[0].total_count || 0) : 0;
      // Strip the window function column before sending to client
      return { rows: rows.map(({ total_count, ...r }) => r), total };
    }

    const users         = extract(usersRes);
    const jobs          = extract(jobsRes);
    const messages      = extract(messagesRes);
    const disputes      = extract(disputesRes);
    const payments      = extract(paymentsRes);
    const support       = extract(supportRes);
    const reviews       = extract(reviewsRes);
    const bids          = extract(bidsRes);

    const totalCount =
      users.rows.length + jobs.rows.length + messages.rows.length +
      disputes.rows.length + payments.rows.length + support.rows.length +
      reviews.rows.length + bids.rows.length;

    // ── Totals per type (for pagination indicators) ───────────────────────────
    const totals = {
      users:          users.total,
      jobs:           jobs.total,
      messages:       messages.total,
      disputes:       disputes.total,
      payments:       payments.total,
      support_tickets: support.total,
      reviews:        reviews.total,
      bids:           bids.total,
    };

    // ── Log the search (non-blocking) ─────────────────────────────────────────
    const rawIpAddress = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    const ipAddress = hashIP(rawIpAddress);
    db.query(
      `INSERT INTO admin_search_log (admin_id, query, entity_types, result_count, ip_address)
       VALUES ($1, $2, $3, $4, $5)`,
      [adminId, rawQuery, requestedTypes, totalCount, ipAddress]
    ).catch(err => console.error('adminSearchLog insert error:', err));

    res.json({
      query:        rawQuery,
      entity_types: requestedTypes,
      total:        totalCount,
      totals,
      page,
      limit,
      results: {
        users:           users.rows,
        jobs:            jobs.rows,
        messages:        messages.rows,
        disputes:        disputes.rows,
        payments:        payments.rows,
        support_tickets: support.rows,
        reviews:         reviews.rows,
        bids:            bids.rows,
      },
    });
  } catch (err) {
    console.error('adminSearch error:', err);
    res.status(500).json({ error: 'Search failed.' });
  }
};

// ── Search log viewer (super-admin only) ─────────────────────────────────────

exports.getSearchLogs = async (req, res) => {
  try {
    const { admin_id, q, limit = 50, offset = 0 } = req.query;

    const conditions = [];
    const params = [];

    if (admin_id) {
      params.push(admin_id);
      conditions.push(`sl.admin_id = $${params.length}`);
    }
    if (q) {
      const escapedQ = q.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
      params.push(`%${escapedQ}%`);
      conditions.push(`sl.query ILIKE $${params.length}`);
    }

    const where      = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const pageLimit  = Math.min(parseInt(limit)  || 50,  200);
    const pageOffset = Math.max(parseInt(offset) || 0,   0);

    params.push(pageLimit, pageOffset);

    const { rows } = await db.query(`
      SELECT
        sl.id, sl.query, sl.entity_types, sl.result_count,
        sl.ip_address, sl.created_at,
        u.first_name || ' ' || u.last_name AS admin_name,
        u.email AS admin_email,
        u.role  AS admin_role
      FROM admin_search_log sl
      JOIN users u ON u.id = sl.admin_id
      ${where}
      ORDER BY sl.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    const countParams = params.slice(0, -2);
    const { rows: countRows } = await db.query(
      `SELECT COUNT(*) AS total FROM admin_search_log sl ${where}`,
      countParams
    );

    res.json({
      logs:   rows,
      total:  parseInt(countRows[0].total),
      limit:  pageLimit,
      offset: pageOffset,
    });
  } catch (err) {
    console.error('getSearchLogs error:', err);
    res.status(500).json({ error: 'Failed to fetch search logs.' });
  }
};

// ── Search log stats ──────────────────────────────────────────────────────────

exports.getSearchStats = async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT
        COUNT(*) AS total_searches,
        COUNT(DISTINCT admin_id) AS unique_admins,
        ROUND(AVG(result_count), 1) AS avg_results,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours') AS searches_24h,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')   AS searches_7d
      FROM admin_search_log
    `);

    const { rows: topQueries } = await db.query(`
      SELECT
        query,
        COUNT(*) AS search_count,
        MAX(created_at) AS last_searched_at
      FROM admin_search_log
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY query
      ORDER BY search_count DESC
      LIMIT 10
    `);

    const { rows: topAdmins } = await db.query(`
      SELECT
        u.first_name || ' ' || u.last_name AS admin_name,
        u.email AS admin_email,
        COUNT(*) AS search_count,
        MAX(sl.created_at) AS last_search_at
      FROM admin_search_log sl
      JOIN users u ON u.id = sl.admin_id
      WHERE sl.created_at >= NOW() - INTERVAL '30 days'
      GROUP BY sl.admin_id, u.first_name, u.last_name, u.email
      ORDER BY search_count DESC
      LIMIT 10
    `);

    res.json({ summary: rows[0], top_queries: topQueries, top_admins: topAdmins });
  } catch (err) {
    console.error('getSearchStats error:', err);
    res.status(500).json({ error: 'Failed to fetch search stats.' });
  }
};
