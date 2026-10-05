/**
 * Helper quote routes — formal line-item estimates helpers send to clients for specific jobs.
 * POST   /api/helper-quotes              — create/send a quote
 * GET    /api/helper-quotes/sent         — helper: list quotes they've sent
 * GET    /api/helper-quotes/job/:jobId   — client: quotes received for a job
 * GET    /api/helper-quotes/:id          — get a single quote
 * PATCH  /api/helper-quotes/:id/status   — client: accept or decline
 * DELETE /api/helper-quotes/:id          — helper: withdraw (draft/sent only)
 */
'use strict';

const express  = require('express');
const router   = express.Router();
const pool     = require('../db');
const { authenticate } = require('../middleware/auth');

// ── Create / send a quote ────────────────────────────────────────────────────
router.post('/', authenticate, async (req, res, next) => {
  const helperId = req.user.id;
  const { job_id, line_items, tax_rate = 0, notes, valid_days = 7 } = req.body;

  if (!job_id)         return res.status(400).json({ error: 'job_id is required' });
  if (!Array.isArray(line_items) || line_items.length === 0)
    return res.status(400).json({ error: 'line_items must be a non-empty array' });

  // Validate each line item
  for (const item of line_items) {
    if (!item.description || typeof item.unit_price_cents !== 'number' || item.unit_price_cents < 0)
      return res.status(400).json({ error: 'Each line item requires description and unit_price_cents >= 0' });
    if (typeof item.quantity !== 'number' || item.quantity <= 0)
      return res.status(400).json({ error: 'Each line item requires quantity > 0' });
  }

  // Compute totals
  const subtotal_cents = line_items.reduce(
    (sum, i) => sum + Math.round(i.unit_price_cents * i.quantity), 0
  );
  const taxRate = Math.min(Math.max(parseFloat(tax_rate) || 0, 0), 1);
  const tax_cents    = Math.round(subtotal_cents * taxRate);
  const total_cents  = subtotal_cents + tax_cents;

  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + (parseInt(valid_days) || 7));

  try {
    const row = await pool.query(`
      INSERT INTO helper_quotes
        (job_id, helper_id, line_items, tax_rate, subtotal_cents, tax_cents, total_cents,
         notes, status, valid_until)
      VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, 'sent', $9)
      RETURNING *
    `, [
      job_id, helperId,
      JSON.stringify(line_items),
      taxRate, subtotal_cents, tax_cents, total_cents,
      notes || null, validUntil,
    ]);
    res.status(201).json(row.rows[0]);
  } catch (err) {
    // Table doesn't exist yet — return a clear message
    if (err.code === '42P01') {
      return res.status(503).json({ error: 'helper_quotes table not yet migrated.' });
    }
    next(err);
  }
});

// ── List quotes sent by the authenticated helper ─────────────────────────────
router.get('/sent', authenticate, async (req, res, next) => {
  const helperId = req.user.id;
  const limit  = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = parseInt(req.query.offset) || 0;

  try {
    const rows = await pool.query(`
      SELECT hq.*,
             j.title AS job_title, j.status AS job_status,
             COALESCE(u.first_name || ' ' || u.last_name, u.email) AS client_name
      FROM helper_quotes hq
      JOIN jobs j  ON j.id = hq.job_id
      JOIN users u ON u.id = j.client_id
      WHERE hq.helper_id = $1
      ORDER BY hq.created_at DESC
      LIMIT $2 OFFSET $3
    `, [helperId, limit, offset]).catch(() => ({ rows: [] }));

    res.json({ quotes: rows.rows, limit, offset });
  } catch (err) { next(err); }
});

// ── List quotes received for a job (client only) ─────────────────────────────
router.get('/job/:jobId', authenticate, async (req, res, next) => {
  const userId = req.user.id;
  const { jobId } = req.params;

  try {
    // Verify requester is the job owner or the helper who sent the quote
    const job = await pool.query('SELECT client_id FROM jobs WHERE id = $1', [jobId])
      .catch(() => ({ rows: [] }));
    if (!job.rows[0]) return res.status(404).json({ error: 'Job not found' });

    const isClient = job.rows[0].client_id === userId;
    const rows = await pool.query(`
      SELECT hq.*,
             COALESCE(NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''), u.email) AS helper_name,
             hp.profile_photo_url AS helper_photo,
             hp.avg_rating AS average_rating
      FROM helper_quotes hq
      JOIN users u ON u.id = hq.helper_id
      LEFT JOIN helper_profiles hp ON hp.user_id = hq.helper_id
      WHERE hq.job_id = $1
        AND ($2 OR hq.helper_id = $3)
      ORDER BY hq.total_cents ASC
    `, [jobId, isClient, userId]).catch(() => ({ rows: [] }));

    res.json({ quotes: rows.rows });
  } catch (err) { next(err); }
});

// ── Get single quote ─────────────────────────────────────────────────────────
router.get('/:id', authenticate, async (req, res, next) => {
  const userId = req.user.id;
  try {
    const row = await pool.query(`
      SELECT hq.*,
             j.title AS job_title, j.client_id,
             COALESCE(NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''), u.email) AS helper_name
      FROM helper_quotes hq
      JOIN jobs j  ON j.id = hq.job_id
      JOIN users u ON u.id = hq.helper_id
      LEFT JOIN helper_profiles hp ON hp.user_id = hq.helper_id
      WHERE hq.id = $1
        AND (hq.helper_id = $2 OR j.client_id = $2)
    `, [req.params.id, userId]).catch(() => ({ rows: [] }));

    if (!row.rows[0]) return res.status(404).json({ error: 'Quote not found' });
    res.json(row.rows[0]);
  } catch (err) { next(err); }
});

// ── Accept or decline a quote (client) ───────────────────────────────────────
router.patch('/:id/status', authenticate, async (req, res, next) => {
  const userId = req.user.id;
  const { status } = req.body;

  if (!['accepted', 'declined'].includes(status))
    return res.status(400).json({ error: 'status must be accepted or declined' });

  try {
    // Ensure requester is the job's client
    const check = await pool.query(`
      SELECT hq.id FROM helper_quotes hq
      JOIN jobs j ON j.id = hq.job_id
      WHERE hq.id = $1 AND j.client_id = $2 AND hq.status = 'sent'
    `, [req.params.id, userId]).catch(() => ({ rows: [] }));

    if (!check.rows[0])
      return res.status(403).json({ error: 'Cannot update this quote' });

    const updated = await pool.query(`
      UPDATE helper_quotes SET status = $1, updated_at = NOW()
      WHERE id = $2 RETURNING *
    `, [status, req.params.id]);

    res.json(updated.rows[0]);
  } catch (err) { next(err); }
});

// ── Withdraw a quote (helper) ─────────────────────────────────────────────────
router.delete('/:id', authenticate, async (req, res, next) => {
  const userId = req.user.id;
  try {
    const result = await pool.query(`
      UPDATE helper_quotes SET status = 'withdrawn', updated_at = NOW()
      WHERE id = $1 AND helper_id = $2 AND status IN ('draft', 'sent')
      RETURNING id
    `, [req.params.id, userId]).catch(() => ({ rows: [] }));

    if (!result.rows[0]) return res.status(404).json({ error: 'Quote not found or already finalised' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
