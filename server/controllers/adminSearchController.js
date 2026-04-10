'use strict';
const db = require('../db');
const logger = require('../utils/logger');

// ── Valid entity types the search engine covers ───────────────────────────────
const ALL_ENTITY_TYPES = ['users', 'jobs', 'messages'];
const MAX_PER_TYPE = 10; // per-entity cap; total ≤ 30 results per search

// ── Main search handler ───────────────────────────────────────────────────────

exports.search = async (req, res) => {
  const adminId = req.user.id;
  const rawQuery = (req.query.q || '').trim();

  // Require at least 2 characters to avoid log spam and full-table scans
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

  // Escape ILIKE special characters so % and _ in the input match literally
  const escaped = rawQuery.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
  const ilike = `%${escaped}%`;

  try {
    // ── Run all searches in parallel ─────────────────────────────────────────
    const [usersRes, jobsRes, messagesRes] = await Promise.allSettled([

      // Users: search by name, email, phone, or UUID prefix
      requestedTypes.includes('users')
        ? db.query(`
            SELECT
              u.id,
              u.first_name,
              u.last_name,
              u.email,
              u.role,
              u.is_active,
              u.is_banned,
              u.created_at,
              hp.avg_rating,
              hp.completed_jobs_count
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
            LIMIT $2
          `, [ilike, MAX_PER_TYPE])
        : Promise.resolve({ rows: [] }),

      // Jobs: search by title, description, city, category, or UUID prefix
      requestedTypes.includes('jobs')
        ? db.query(`
            SELECT
              j.id,
              j.title,
              j.status,
              j.category_name,
              j.location_city,
              j.location_state,
              j.budget_min,
              j.budget_max,
              j.created_at,
              u.first_name || ' ' || u.last_name AS client_name,
              u.email AS client_email
            FROM jobs j
            JOIN users u ON u.id = j.client_id
            WHERE (
              j.title          ILIKE $1
              OR j.description ILIKE $1
              OR j.location_city ILIKE $1
              OR j.category_name ILIKE $1
              OR j.id::text    ILIKE $1
              OR (u.first_name || ' ' || u.last_name) ILIKE $1
              OR u.email       ILIKE $1
            )
            ORDER BY j.created_at DESC
            LIMIT $2
          `, [ilike, MAX_PER_TYPE])
        : Promise.resolve({ rows: [] }),

      // Messages: search message body + conversation participants
      requestedTypes.includes('messages')
        ? db.query(`
            SELECT
              m.id,
              m.content,
              m.created_at,
              m.conversation_id,
              s.first_name || ' ' || s.last_name AS sender_name,
              s.email AS sender_email,
              s.id AS sender_id
            FROM messages m
            JOIN users s ON s.id = m.sender_id
            WHERE m.content ILIKE $1
            ORDER BY m.created_at DESC
            LIMIT $2
          `, [ilike, MAX_PER_TYPE])
        : Promise.resolve({ rows: [] }),
    ]);

    const users    = usersRes.status    === 'fulfilled' ? usersRes.value.rows    : [];
    const jobs     = jobsRes.status     === 'fulfilled' ? jobsRes.value.rows     : [];
    const messages = messagesRes.status === 'fulfilled' ? messagesRes.value.rows : [];

    const totalCount = users.length + jobs.length + messages.length;

    // ── Log the search (non-blocking) ────────────────────────────────────────
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || null;
    db.query(
      `INSERT INTO admin_search_log (admin_id, query, entity_types, result_count, ip_address)
       VALUES ($1, $2, $3, $4, $5)`,
      [adminId, rawQuery, requestedTypes, totalCount, ipAddress]
    ).catch(err => logger.error('adminSearchLog insert error:', err));

    res.json({
      query: rawQuery,
      entity_types: requestedTypes,
      total: totalCount,
      results: { users, jobs, messages },
    });
  } catch (err) {
    logger.error('adminSearch error:', err);
    res.status(500).json({ error: 'Search failed.' });
  }
};

// ── Search log viewer (super-admin only) ─────────────────────────────────────

exports.getSearchLogs = async (req, res) => {
  try {
    const {
      admin_id,
      q,
      limit = 50,
      offset = 0,
    } = req.query;

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

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const pageLimit  = Math.min(parseInt(limit)  || 50,  200);
    const pageOffset = Math.max(parseInt(offset) || 0, 0);

    params.push(pageLimit, pageOffset);

    const { rows } = await db.query(`
      SELECT
        sl.id,
        sl.query,
        sl.entity_types,
        sl.result_count,
        sl.ip_address,
        sl.created_at,
        u.first_name || ' ' || u.last_name AS admin_name,
        u.email AS admin_email,
        u.role  AS admin_role
      FROM admin_search_log sl
      JOIN users u ON u.id = sl.admin_id
      ${where}
      ORDER BY sl.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    // Count for pagination
    const countParams = params.slice(0, -2);
    const { rows: countRows } = await db.query(
      `SELECT COUNT(*) AS total FROM admin_search_log sl ${where}`,
      countParams
    );

    res.json({
      logs: rows,
      total: parseInt(countRows[0].total),
      limit: pageLimit,
      offset: pageOffset,
    });
  } catch (err) {
    logger.error('getSearchLogs error:', err);
    res.status(500).json({ error: 'Failed to fetch search logs.' });
  }
};

// ── Search log stats (for super-admin overview) ───────────────────────────────

exports.getSearchStats = async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT
        COUNT(*) AS total_searches,
        COUNT(DISTINCT admin_id) AS unique_admins,
        ROUND(AVG(result_count), 1) AS avg_results,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours') AS searches_24h,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') AS searches_7d
      FROM admin_search_log
    `);

    // Top queries (last 30 days)
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

    // Most active searchers
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

    res.json({
      summary: rows[0],
      top_queries: topQueries,
      top_admins: topAdmins,
    });
  } catch (err) {
    logger.error('getSearchStats error:', err);
    res.status(500).json({ error: 'Failed to fetch search stats.' });
  }
};
