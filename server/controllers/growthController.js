/**
 * Growth controller — programs + community wholesale.
 * GET /api/growth/programs   → active programs, optionally filtered by persona
 * GET /api/growth/wholesale  → active wholesale listings
 */

const pool   = require('../db');
const logger = require('../utils/logger');

/**
 * GET /api/growth/programs?persona=helper
 * Returns active programs. If `persona` is provided, returns programs whose
 * persona_filter is NULL (all personas) or contains the given persona string.
 */
exports.getPrograms = async (req, res) => {
  try {
    const persona = req.query.persona || null;

    const { rows } = await pool.query(
      `SELECT id, title, subtitle, icon_name, color_key,
              cta_label, cta_url, cta_type, persona_filter, sort_order
       FROM growth_programs
       WHERE is_active = TRUE
         AND (
           $1::text IS NULL
           OR persona_filter IS NULL
           OR $1 = ANY(persona_filter)
         )
       ORDER BY sort_order ASC, id ASC`,
      [persona],
    );

    return res.json({ programs: rows });
  } catch (err) {
    // If migrations haven't been applied yet, return an empty list so the app/web UI
    // can render (other sections still work) instead of hard-failing.
    if (err && err.code === '42P01') {
      logger.warn('[growth] growth_programs table missing (migration 286 not applied yet)');
      return res.json({ programs: [] });
    }
    logger.error('[growth] getPrograms', { err: err.message, code: err.code });
    return res.status(500).json({ error: 'Failed to load programs' });
  }
};

/**
 * GET /api/growth/wholesale?limit=20
 * Returns active wholesale listings ordered by sort_order.
 */
exports.getWholesale = async (req, res) => {
  try {
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));

    const { rows } = await pool.query(
      `SELECT id, title, subtitle, icon_name,
              save_percent, joined_count, category, external_url, sort_order
       FROM wholesale_listings
       WHERE is_active = TRUE
       ORDER BY sort_order ASC, id ASC
       LIMIT $1`,
      [limit],
    );

    return res.json({ listings: rows });
  } catch (err) {
    if (err && err.code === '42P01') {
      logger.warn('[growth] wholesale_listings table missing (migration 286 not applied yet)');
      return res.json({ listings: [] });
    }
    logger.error('[growth] getWholesale', { err: err.message, code: err.code });
    return res.status(500).json({ error: 'Failed to load wholesale listings' });
  }
};

/**
 * POST /api/growth/wholesale/:id/join  (auth required)
 * Increments the joined_count for a wholesale listing.
 * Idempotent — one increment per user per listing via wholesale_joins join table.
 */
exports.joinWholesale = async (req, res) => {
  try {
    const listingId = parseInt(req.params.id, 10);
    if (!listingId) return res.status(400).json({ error: 'Invalid listing id' });

    // Ensure join table exists (graceful — created by migration)
    await pool.query(
      `INSERT INTO wholesale_joins (user_id, listing_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, listing_id) DO NOTHING`,
      [req.user.id, listingId],
    );

    // Re-derive joined_count from the join table for accuracy
    const { rows } = await pool.query(
      `UPDATE wholesale_listings
       SET joined_count = (
         SELECT COUNT(*) FROM wholesale_joins WHERE listing_id = $1
       ),
       updated_at = NOW()
       WHERE id = $1
       RETURNING id, joined_count`,
      [listingId],
    );

    if (!rows.length) return res.status(404).json({ error: 'Listing not found' });
    return res.json({ listing: rows[0] });
  } catch (err) {
    if (err && err.code === '42P01') {
      logger.warn('[growth] wholesale join tables missing (migration 286 not applied yet)');
      return res.status(503).json({ error: 'Wholesale is temporarily unavailable' });
    }
    logger.error('[growth] joinWholesale', { err: err.message, code: err.code });
    return res.status(500).json({ error: 'Failed to join listing' });
  }
};
