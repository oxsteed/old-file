/**
 * Saved searches / listing alerts
 * GET    /api/saved-searches           — list mine
 * POST   /api/saved-searches           — create
 * PUT    /api/saved-searches/:id       — update
 * DELETE /api/saved-searches/:id       — delete
 *
 * Internal fan-out (not exposed publicly), called after a new listing is
 * created / goes live:
 *   notifyMatchingSavedSearches(job)            — new job posted
 *   notifyMatchingSavedSearchesForHelper(helper) — helper profile goes live
 *   notifyMatchingSavedSearchesForTool(tool)     — new tool listing created
 *
 * Alert dedupe: one notification per (saved search, item), enforced by the
 * saved_search_alerts table (migration 672) via INSERT ... ON CONFLICT
 * DO NOTHING. The notification is only sent when the dedupe insert lands.
 */
'use strict';

const express  = require('express');
const router   = express.Router();
const pool     = require('../db');
const { authenticate } = require('../middleware/auth');
const { sendNotification } = require('../services/notificationService');

const VALID_SEARCH_TYPES = ['job', 'helper', 'tool', 'food'];

function normalizeSearchType(value) {
  const v = String(value || 'job').toLowerCase();
  return VALID_SEARCH_TYPES.includes(v) ? v : null;
}

// Only plain JSON objects are stored; anything else becomes '{}'.
function normalizeFilters(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    try {
      return JSON.stringify(value).slice(0, 20000);
    } catch (_) { /* fall through */ }
  }
  return '{}';
}

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
          min_budget, max_budget, notify = true,
          search_type, query, filters } = req.body;

  if (!name || !name.trim())
    return res.status(400).json({ error: 'name is required' });

  const normalizedType = normalizeSearchType(search_type);
  if (search_type && !normalizedType)
    return res.status(400).json({ error: 'invalid search_type' });

  // query is the v2 free-text field; fall back to the legacy keyword column
  // so old clients keep working.
  const effectiveQuery = (query && String(query).trim())
    ? String(query).trim().slice(0, 500)
    : (keyword ? String(keyword).trim().slice(0, 500) : null);

  try {
    const row = await pool.query(`
      INSERT INTO saved_searches
        (user_id, name, search_type, query, filters,
         keyword, category, city, state, radius_miles,
         min_budget, max_budget, notify)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      RETURNING *
    `, [userId, name.trim(), normalizedType || 'job', effectiveQuery,
        normalizeFilters(filters),
        keyword || null, category || null,
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
          min_budget, max_budget, notify,
          search_type, query, filters } = req.body;

  let normalizedType = null;
  if (search_type !== undefined) {
    normalizedType = normalizeSearchType(search_type);
    if (!normalizedType)
      return res.status(400).json({ error: 'invalid search_type' });
  }

  try {
    const row = await pool.query(`
      UPDATE saved_searches SET
        name         = COALESCE($1, name),
        search_type  = COALESCE($2, search_type),
        query        = COALESCE($3, query),
        filters      = COALESCE($4, filters),
        keyword      = $5,
        category     = $6,
        city         = $7,
        state        = $8,
        radius_miles = $9,
        min_budget   = $10,
        max_budget   = $11,
        notify       = COALESCE($12, notify),
        updated_at   = NOW()
      WHERE id = $13 AND user_id = $14
      RETURNING *
    `, [
      name?.trim() || null,
      normalizedType,
      (query !== undefined ? (String(query).trim().slice(0, 500) || null) : null),
      (filters !== undefined ? normalizeFilters(filters) : null),
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

// ── Alert dedupe ──────────────────────────────────────────────────────────────
// Returns true when this is the first alert for (savedSearch, itemType,
// itemId). Uses INSERT ... ON CONFLICT DO NOTHING against the
// saved_search_alerts table (migration 672).
async function claimAlert(savedSearchId, itemType, itemId) {
  try {
    const { rows } = await pool.query(`
      INSERT INTO saved_search_alerts (saved_search_id, item_type, item_id)
      VALUES ($1, $2, $3)
      ON CONFLICT (saved_search_id, item_type, item_id) DO NOTHING
      RETURNING id
    `, [savedSearchId, itemType, String(itemId)]);
    return rows.length > 0;
  } catch (err) {
    // Table not migrated yet: fall back to the old always-notify behavior
    // rather than dropping alerts.
    if (err.code === '42P01') return true;
    return false;
  }
}

async function sendSearchAlert({ userId, searchId, itemType, itemId, notifType, title, body, data, actionUrl }) {
  const first = await claimAlert(searchId, itemType, itemId);
  if (!first) return false;
  await sendNotification({
    userId,
    type: notifType,
    title,
    body,
    data,
    action_url: actionUrl,
  }).catch(() => {});
  return true;
}

// Shared keyword predicate: matches against the v2 query column with a
// fallback to the legacy keyword column. NULLIF guards against empty
// strings, which would otherwise make '%%' match every listing.
const KEYWORD_PREDICATE = `(NULLIF(COALESCE(ss.query, ss.keyword), '') IS NULL
   OR $TEXT1 ILIKE '%' || NULLIF(COALESCE(ss.query, ss.keyword), '') || '%'
   OR $TEXT2 ILIKE '%' || NULLIF(COALESCE(ss.query, ss.keyword), '') || '%')`;

function keywordPredicate(text1Param, text2Param) {
  return KEYWORD_PREDICATE
    .replace(/\$TEXT1/g, text1Param)
    .replace(/\$TEXT2/g, text2Param);
}

// ── Internal: fan out alerts after a new job is posted ───────────────────────
// Called by the jobs controller after INSERT; not exposed publicly.
async function notifyMatchingSavedSearches(job) {
  try {
    const rows = await pool.query(`
      SELECT ss.id AS search_id, ss.user_id
      FROM saved_searches ss
      WHERE ss.notify = true
        AND ss.search_type = 'job'
        AND ss.user_id != $1
        AND ${keywordPredicate('$2', '$3')}
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

    for (const { search_id, user_id } of rows.rows) {
      await sendSearchAlert({
        userId: user_id,
        searchId: search_id,
        itemType: 'job',
        itemId: job.id,
        notifType: 'job_alert',
        title: 'New Job Alert',
        body: job.title || 'A new job matches your saved search',
        data: { type: 'job_alert', job_id: String(job.id) },
        actionUrl: `/jobs/${job.id}`,
      });
    }
  } catch (_) {}
}

// ── Internal: fan out alerts after a helper profile goes live ───────────────
// Called by the helpers controller when a profile flips is_listed to true.
// helper: { id, user_id, profile_headline, bio, service_city, service_state }
async function notifyMatchingSavedSearchesForHelper(helper) {
  try {
    const rows = await pool.query(`
      SELECT ss.id AS search_id, ss.user_id
      FROM saved_searches ss
      WHERE ss.notify = true
        AND ss.search_type = 'helper'
        AND ss.user_id != $1
        AND ${keywordPredicate('$2', '$3')}
        AND (ss.city  IS NULL OR LOWER(ss.city) = LOWER($4))
        AND (ss.state IS NULL OR LOWER(ss.state) = LOWER($5))
    `, [
      helper.user_id,
      [helper.profile_headline, helper.bio, helper.skill_names].filter(Boolean).join(' '),
      [helper.profile_headline, helper.bio, helper.skill_names].filter(Boolean).join(' '),
      helper.service_city || null, helper.service_state || null,
    ]).catch(() => ({ rows: [] }));

    for (const { search_id, user_id } of rows.rows) {
      await sendSearchAlert({
        userId: user_id,
        searchId: search_id,
        itemType: 'helper',
        itemId: helper.id,
        notifType: 'helper_alert',
        title: 'New Helper Alert',
        body: helper.profile_headline || 'A new helper matches your saved search',
        data: { type: 'helper_alert', helper_id: String(helper.id) },
        actionUrl: `/helpers/${helper.id}`,
      });
    }
  } catch (_) {}
}

// ── Internal: fan out alerts after a new tool listing is created ────────────
// Called by the tool rentals route after INSERT; not exposed publicly.
// tool: { id, user_id, name, category, description, location_city, location_state }
async function notifyMatchingSavedSearchesForTool(tool) {
  try {
    const rows = await pool.query(`
      SELECT ss.id AS search_id, ss.user_id
      FROM saved_searches ss
      WHERE ss.notify = true
        AND ss.search_type = 'tool'
        AND ss.user_id != $1
        AND ${keywordPredicate('$2', '$3')}
        AND (ss.category IS NULL OR ss.category = $4)
        AND (ss.city  IS NULL OR LOWER(ss.city) = LOWER($5))
        AND (ss.state IS NULL OR LOWER(ss.state) = LOWER($6))
    `, [
      tool.user_id,
      tool.name || '', tool.description || '',
      tool.category || null,
      tool.location_city || null, tool.location_state || null,
    ]).catch(() => ({ rows: [] }));

    for (const { search_id, user_id } of rows.rows) {
      await sendSearchAlert({
        userId: user_id,
        searchId: search_id,
        itemType: 'tool',
        itemId: tool.id,
        notifType: 'tool_alert',
        title: 'New Tool Alert',
        body: tool.name || 'A new tool matches your saved search',
        data: { type: 'tool_alert', tool_id: String(tool.id) },
        actionUrl: `/tool-rentals/${tool.id}`,
      });
    }
  } catch (_) {}
}

module.exports = router;
module.exports.notifyMatchingSavedSearches = notifyMatchingSavedSearches;
module.exports.notifyMatchingSavedSearchesForHelper = notifyMatchingSavedSearchesForHelper;
module.exports.notifyMatchingSavedSearchesForTool = notifyMatchingSavedSearchesForTool;
