/**
 * Saved searches / job alerts
 * GET    /api/saved-searches           — list mine
 * POST   /api/saved-searches           — create
 * PUT    /api/saved-searches/:id       — update
 * DELETE /api/saved-searches/:id       — delete
 * POST   /api/saved-searches/match     — internal: called after a new job is posted
 */
'use strict';

const express  = require('express');
const router   = express.Router();
const pool     = require('../db');
const { authenticate } = require('../middleware/auth');
const { sendNotification } = require('../services/notificationService');

// ── List saved searches ───────────────────────────────────────────────────────
router.get('/', authenticate, async (req, res, next) => {
  try {
    const rows = await pool.query(
      'SELECT * FROM saved_searches WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.id]
    ).catch(() => ({ rows: [] }));
    res.json({ searches: rows.rows });
  } catch (err) { next(err); }
});

// ── Create saved search ───────────────────────────────────────────────────────
router.post('/', authenticate, async (req, res, next) => {
  const userId = req.user.id;
  const { name, keyword, category, city, state, radius_miles,
          min_budget, max_budget, notify = true } = req.body;

  if (!name || !name.trim())
    return res.status(400).json({ error: 'name is required' });

  try {
    const row = await pool.query(`
      INSERT INTO saved_searches
        (user_id, name, keyword, category, city, state, radius_miles,
         min_budget, max_budget, notify)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING *
    `, [userId, name.trim(), keyword || null, category || null,
        city || null, state || null,
        radius_miles ? parseInt(radius_miles) : null,
        min_budget   ? parseInt(min_budget)   : null,
        max_budget   ? parseInt(max_budget)   : null,
        notify]);

    if (row.rows[0]) return res.status(201).json(row.rows[0]);
    res.status(503).json({ error: 'saved_searches table not yet migrated.' });
  } catch (err) {
    if (err.code === '42P01')
      return res.status(503).json({ error: 'saved_searches table not yet migrated.' });
    next(err);
  }
});

// ── Update saved search ───────────────────────────────────────────────────────
router.put('/:id', authenticate, async (req, res, next) => {
  const { name, keyword, category, city, state, radius_miles,
          min_budget, max_budget, notify } = req.body;
  try {
    const row = await pool.query(`
      UPDATE saved_searches SET
        name         = COALESCE($1, name),
        keyword      = $2,
        category     = $3,
        city         = $4,
        state        = $5,
        radius_miles = $6,
        min_budget   = $7,
        max_budget   = $8,
        notify       = COALESCE($9, notify),
        updated_at   = NOW()
      WHERE id = $10 AND user_id = $11
      RETURNING *
    `, [
      name?.trim() || null,
      keyword || null, category || null,
      city || null, state || null,
      radius_miles ? parseInt(radius_miles) : null,
      min_budget   ? parseInt(min_budget)   : null,
      max_budget   ? parseInt(max_budget)   : null,
      notify !== undefined ? notify : null,
      req.params.id, req.user.id,
    ]).catch(() => ({ rows: [] }));

    if (!row.rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(row.rows[0]);
  } catch (err) { next(err); }
});

// ── Delete saved search ───────────────────────────────────────────────────────
router.delete('/:id', authenticate, async (req, res, next) => {
  try {
    await pool.query(
      'DELETE FROM saved_searches WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    ).catch(() => {});
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── Internal: fan out push alerts after a new job is posted ──────────────────
// Called by jobs controller after INSERT; not exposed publicly.
async function notifyMatchingSavedSearches(job) {
  try {
    const rows = await pool.query(`
      SELECT ss.user_id
      FROM saved_searches ss
      WHERE ss.notify = true
        AND ss.user_id != $1
        AND (ss.keyword  IS NULL OR $2 ILIKE '%' || ss.keyword || '%' OR $3 ILIKE '%' || ss.keyword || '%')
        AND (ss.category IS NULL OR ss.category = $4)
        AND (ss.city     IS NULL OR LOWER(ss.city) = LOWER($5))
        AND (ss.state    IS NULL OR LOWER(ss.state) = LOWER($6))
        AND (ss.min_budget IS NULL OR $7 >= ss.min_budget)
        AND (ss.max_budget IS NULL OR $7 <= ss.max_budget)
    `, [
      job.client_id,
      job.title || '', job.description || '',
      job.category || null,
      job.city || null, job.state || null,
      job.budget_cents || 0,
    ]).catch(() => ({ rows: [] }));

    for (const { user_id } of rows.rows) {
      await sendNotification({
        userId: user_id,
        type: 'job_alert',
        title: 'New Job Alert',
        body: job.title || 'A new job matches your saved search',
        data:  { type: 'job_alert', job_id: String(job.id) },
        action_url: `/jobs/${job.id}`,
      }).catch(() => {});
    }
  } catch (_) {}
}

module.exports = router;
module.exports.notifyMatchingSavedSearches = notifyMatchingSavedSearches;
