'use strict';

const db = require('../db');
const siteVisitService = require('../services/siteVisitService');
const logger = require('../utils/logger');

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

// ── Public beacon ─────────────────────────────────────────────────────────────
// POST /api/analytics/pageview  { path, referrer }
// Fire-and-forget: always answers 204 so a tracking failure can never break
// the page. Bots are recorded too (flagged is_bot) but hidden from the admin
// UI by default.
exports.recordPageview = async (req, res) => {
  try {
    const { path, referrer } = req.body || {};
    await siteVisitService.recordVisit({
      path,
      referrer,
      req,
      userId: req.user?.id || null,
    });
  } catch (err) {
    logger.warn({ err: err.message }, 'siteVisitController.recordPageview failed');
  }
  return res.status(204).end();
};

// ── Admin: visitor history ────────────────────────────────────────────────────
function parseRange(query) {
  const now = new Date();
  const to = query.to ? new Date(query.to) : now;
  const from = query.from
    ? new Date(query.from)
    : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const safeTo = Number.isNaN(to.getTime()) ? now : to;
  const safeFrom = Number.isNaN(from.getTime())
    ? new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    : from;
  return { from: safeFrom, to: safeTo };
}

function visitFilters(query) {
  const conditions = ['v.visited_at >= $1', 'v.visited_at <= $2'];
  const params = [];
  const { from, to } = parseRange(query);
  params.push(from.toISOString(), to.toISOString());

  if (query.country && /^[A-Za-z]{2}$/.test(query.country)) {
    params.push(query.country.toUpperCase());
    conditions.push(`v.country_code = $${params.length}`);
  }
  if (query.path) {
    params.push(`${String(query.path).slice(0, 200)}%`);
    conditions.push(`v.path LIKE $${params.length}`);
  }
  if (query.q) {
    params.push(`%${String(query.q).slice(0, 100)}%`);
    conditions.push(`(v.path ILIKE $${params.length} OR v.city ILIKE $${params.length} OR v.referrer ILIKE $${params.length})`);
  }
  if (query.includeBots !== 'true') {
    conditions.push('v.is_bot = FALSE');
  }
  if (query.device && ['desktop', 'mobile', 'tablet'].includes(query.device)) {
    params.push(query.device);
    conditions.push(`v.device_type = $${params.length}`);
  }
  return { conditions, params, from, to };
}

exports.listVisits = async (req, res) => {
  try {
    const { conditions, params } = visitFilters(req.query);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(req.query.limit, 10) || DEFAULT_LIMIT));
    const offset = (page - 1) * limit;
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countParams = [...params];
    const { rows: countRows } = await db.query(
      `SELECT COUNT(*)::int AS total FROM site_visits v ${where}`,
      countParams
    );

    const { rows } = await db.query(
      `SELECT
         v.id,
         v.visited_at,
         v.path,
         v.referrer,
         v.country_code,
         v.region_name,
         v.city,
         v.device_type,
         v.is_bot,
         v.user_id,
         u.display_name AS user_name,
         u.email AS user_email
       FROM site_visits v
       LEFT JOIN users u ON u.id = v.user_id
       ${where}
       ORDER BY v.visited_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );

    return res.json({ visits: rows, total: countRows[0]?.total || 0, page, limit });
  } catch (err) {
    logger.error({ err: err.message }, 'siteVisitController.listVisits failed');
    return res.status(500).json({ error: 'Failed to load visitor history' });
  }
};

exports.getSummary = async (req, res) => {
  try {
    const { conditions, params } = visitFilters(req.query);
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows: totals } = await db.query(
      `SELECT
         COUNT(*)::int AS visits,
         COUNT(DISTINCT ip_hash)::int AS unique_visitors
       FROM site_visits v ${where}`,
      params
    );

    const { rows: byCountry } = await db.query(
      `SELECT v.country_code, COUNT(*)::int AS visits,
              COUNT(DISTINCT v.ip_hash)::int AS unique_visitors
       FROM site_visits v ${where}
       GROUP BY v.country_code
       ORDER BY visits DESC
       LIMIT 15`,
      params
    );

    const { rows: topPages } = await db.query(
      `SELECT v.path, COUNT(*)::int AS visits
       FROM site_visits v ${where}
       GROUP BY v.path
       ORDER BY visits DESC
       LIMIT 10`,
      params
    );

    const { rows: perDay } = await db.query(
      `SELECT date_trunc('day', v.visited_at)::date AS day, COUNT(*)::int AS visits
       FROM site_visits v ${where}
       GROUP BY 1
       ORDER BY 1`,
      params
    );

    return res.json({
      totals: totals[0] || { visits: 0, unique_visitors: 0 },
      byCountry,
      topPages,
      perDay,
    });
  } catch (err) {
    logger.error({ err: err.message }, 'siteVisitController.getSummary failed');
    return res.status(500).json({ error: 'Failed to load visitor summary' });
  }
};
