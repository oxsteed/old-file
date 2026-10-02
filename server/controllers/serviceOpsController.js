'use strict';

/**
 * M3 — Global Service Operations, Capacity, Safety.
 *
 * Read/write surface for the ops runbook registry and the capacity
 * dashboard. All routes are mounted behind requireAdmin +
 * requirePermission('manage_operations') in server/routes/serviceOps.js.
 *
 * Capacity honesty note: the schema has no booking-to-region linkage.
 * `booking_requests` (the real booking entity) carries only a free-text
 * `service_location`; `admin_regions` rows are grant-scoping territories,
 * not demand attribution; neither users nor businesses carry a region
 * field. The endpoint therefore probes for a demand table
 * (`booking_requests` first, then `bookings`, then `jobs` as the
 * marketplace demand proxy), groups by a region-ish column when one
 * exists, and always returns status/day aggregates plus a
 * `region_attribution` flag so the UI can label the caveat instead of
 * implying precision it lacks.
 */

const db = require('../db');
const logger = require('../utils/logger');

const RUNBOOK_CATEGORIES = ['incident', 'deployment', 'safety', 'vendor', 'compliance'];
const CODE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SQL_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

// Demand sources in preference order: the real booking entity first
// (booking_requests: helper booking flow), then a generic `bookings`
// table if a deployment has one, then jobs as the marketplace demand proxy.
const DEMAND_TABLES = ['booking_requests', 'bookings', 'jobs'];
// Region-ish columns to probe on the demand table, in preference order.
const REGION_COLUMNS = ['region', 'region_code', 'location_state', 'state'];
const COMPLETED_STATUS = 'completed';
const INACTIVE_STATUSES = new Set([
  'completed', 'cancelled', 'canceled', 'closed', 'expired', 'refunded', 'rejected', 'declined',
]);

function assertIdentifier(value) {
  if (!SQL_IDENTIFIER.test(value)) throw new Error(`Unsafe SQL identifier: ${value}`);
  return value;
}

function clampDays(raw) {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return 30;
  return Math.min(90, Math.max(1, parsed));
}

async function relationColumns(table) {
  assertIdentifier(table);
  const { rows } = await db.query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1`,
    [table]
  );
  return new Set(rows.map((row) => row.column_name));
}

function isActiveStatus(status) {
  return !INACTIVE_STATUSES.has(String(status || '').toLowerCase());
}

function zeroTotals() {
  return { bookings_total: 0, bookings_active: 0, bookings_completed: 0 };
}

// ── Capacity ────────────────────────────────────────────────────────────────

async function getCapacity(req, res, next) {
  try {
    const days = clampDays(req.query && req.query.days);

    let source = null;
    let columns = new Set();
    for (const candidate of DEMAND_TABLES) {
      const cols = await relationColumns(candidate);
      if (cols.size) {
        source = candidate;
        columns = cols;
        break;
      }
    }

    if (!source) {
      return res.json({
        window_days: days,
        available: false,
        reason: 'not_configured',
        source: null,
        region_attribution: 'unavailable',
        regions: [],
        by_status: [],
        by_day: [],
        totals: zeroTotals(),
      });
    }

    const safeTable = assertIdentifier(source);
    const regionColumn = REGION_COLUMNS.find((col) => columns.has(col)) || null;
    const hasCreatedAt = columns.has('created_at');
    const hasStatus = columns.has('status');
    const windowClause = hasCreatedAt ? `WHERE created_at >= NOW() - ($1 || ' days')::interval` : '';
    const windowParams = hasCreatedAt ? [String(days)] : [];

    let regions = [];
    let byStatus = [];
    let byDay = [];

    if (hasStatus) {
      const regionSelect = regionColumn
        ? `COALESCE(NULLIF(${assertIdentifier(regionColumn)}::text, ''), 'unassigned') AS region,`
        : `'unassigned' AS region,`;
      const { rows } = await db.query(
        `/* serviceops:capacity:region_status */
         SELECT ${regionSelect}
                COALESCE(status::text, 'unknown') AS status,
                COUNT(*)::integer AS count
           FROM ${safeTable}
          ${windowClause}
          GROUP BY 1, 2
          ORDER BY 1, 3 DESC`,
        windowParams
      );

      const regionMap = new Map();
      const statusMap = new Map();
      for (const row of rows) {
        const count = Number(row.count) || 0;
        const status = String(row.status || 'unknown');
        statusMap.set(status, (statusMap.get(status) || 0) + count);

        const regionName = regionColumn ? String(row.region || 'unassigned') : 'unassigned';
        if (!regionMap.has(regionName)) {
          regionMap.set(regionName, {
            region: regionName,
            bookings_total: 0,
            bookings_active: 0,
            bookings_completed: 0,
          });
        }
        const entry = regionMap.get(regionName);
        entry.bookings_total += count;
        if (status.toLowerCase() === COMPLETED_STATUS) entry.bookings_completed += count;
        if (isActiveStatus(status)) entry.bookings_active += count;
      }

      regions = regionColumn
        ? [...regionMap.values()].sort((a, b) => b.bookings_total - a.bookings_total)
        : [];
      byStatus = [...statusMap.entries()]
        .map(([status, count]) => ({ status, count }))
        .sort((a, b) => b.count - a.count);
    } else {
      const { rows } = await db.query(
        `SELECT COUNT(*)::integer AS count FROM ${safeTable} ${windowClause}`,
        windowParams
      );
      const count = Number(rows[0] && rows[0].count) || 0;
      byStatus = [{ status: 'unknown', count }];
    }

    if (hasCreatedAt) {
      const { rows } = await db.query(
        `/* serviceops:capacity:by_day */
         SELECT date_trunc('day', created_at)::date AS day, COUNT(*)::integer AS count
           FROM ${safeTable}
          WHERE created_at >= NOW() - ($1 || ' days')::interval
          GROUP BY 1
          ORDER BY 1`,
        [String(days)]
      );
      byDay = rows.map((row) => ({ day: String(row.day).slice(0, 10), count: Number(row.count) || 0 }));
    }

    const totals = zeroTotals();
    for (const entry of byStatus) {
      totals.bookings_total += entry.count;
      if (entry.status.toLowerCase() === COMPLETED_STATUS) totals.bookings_completed += entry.count;
      if (isActiveStatus(entry.status)) totals.bookings_active += entry.count;
    }

    return res.json({
      window_days: days,
      available: true,
      source,
      region_attribution: regionColumn ? 'table_column' : 'unavailable',
      region_column: regionColumn,
      attribution_note: regionColumn
        ? `Regions are grouped from ${source}.${regionColumn}; no booking-region linkage exists, so this is demand load by recorded location, not confirmed service region.`
        : 'No region attribution exists in the schema for demand records; showing status and daily aggregates only.',
      regions,
      by_status: byStatus,
      by_day: byDay,
      totals,
    });
  } catch (err) {
    logger.error('serviceOps.getCapacity failed', { error: err.message });
    return next(err);
  }
}

// ── Runbooks ────────────────────────────────────────────────────────────────

function validateRunbookInput({ code, title, category, body }, { requireCode }) {
  if (requireCode) {
    if (!code || !CODE_SLUG.test(String(code))) {
      return 'code must be a lowercase slug (letters, numbers, dashes).';
    }
  }
  if (title !== undefined && (!title || !String(title).trim())) {
    return 'title is required.';
  }
  if (category !== undefined && !RUNBOOK_CATEGORIES.includes(category)) {
    return `category must be one of: ${RUNBOOK_CATEGORIES.join(', ')}.`;
  }
  if (body !== undefined && (!body || !String(body).trim())) {
    return 'body is required.';
  }
  return null;
}

async function listRunbooks(req, res, next) {
  try {
    const { rows } = await db.query(
      `SELECT id, code, title, category, body, version, is_active, updated_by, updated_at
         FROM ops_runbooks
        WHERE is_active = TRUE
        ORDER BY category ASC, code ASC`
    );
    return res.json({ runbooks: rows });
  } catch (err) {
    logger.error('serviceOps.listRunbooks failed', { error: err.message });
    return next(err);
  }
}

async function createRunbook(req, res, next) {
  try {
    const { code, title, category, body } = req.body || {};
    const invalid = validateRunbookInput({ code, title, category, body }, { requireCode: true })
      || (!title || !String(title).trim() ? 'title is required.' : null)
      || (!body || !String(body).trim() ? 'body is required.' : null)
      || (!category ? 'category is required.' : null);
    if (invalid) {
      return res.status(400).json({ error: invalid, code: 'invalid_runbook' });
    }

    const { rows } = await db.query(
      `INSERT INTO ops_runbooks (code, title, category, body, updated_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, code, title, category, body, version, is_active, updated_by, updated_at`,
      [String(code).trim(), String(title).trim(), category, String(body), req.user ? req.user.id : null]
    );
    return res.status(201).json({ runbook: rows[0] });
  } catch (err) {
    if (err && err.code === '23505') {
      return res.status(409).json({
        error: 'A runbook with this code already exists.',
        code: 'duplicate_runbook_code',
      });
    }
    logger.error('serviceOps.createRunbook failed', { error: err.message });
    return next(err);
  }
}

async function updateRunbook(req, res, next) {
  try {
    const id = Number.parseInt(req.params && req.params.id, 10);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: 'Invalid runbook id.', code: 'invalid_runbook_id' });
    }
    const { title, category, body } = req.body || {};
    const invalid = validateRunbookInput({ title, category, body }, { requireCode: false });
    if (invalid) {
      return res.status(400).json({ error: invalid, code: 'invalid_runbook' });
    }

    const { rows } = await db.query(
      `UPDATE ops_runbooks
          SET title      = COALESCE($1, title),
              category   = COALESCE($2, category),
              body       = COALESCE($3, body),
              version    = version + 1,
              updated_by = $4,
              updated_at = NOW()
        WHERE id = $5 AND is_active = TRUE
      RETURNING id, code, title, category, body, version, is_active, updated_by, updated_at`,
      [
        title === undefined ? null : String(title).trim(),
        category === undefined ? null : category,
        body === undefined ? null : String(body),
        req.user ? req.user.id : null,
        id,
      ]
    );
    if (!rows.length) {
      return res.status(404).json({ error: 'Runbook not found.', code: 'runbook_not_found' });
    }
    return res.json({ runbook: rows[0] });
  } catch (err) {
    logger.error('serviceOps.updateRunbook failed', { error: err.message });
    return next(err);
  }
}

async function deleteRunbook(req, res, next) {
  try {
    const id = Number.parseInt(req.params && req.params.id, 10);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: 'Invalid runbook id.', code: 'invalid_runbook_id' });
    }

    // Soft delete only: the runbook stays in history for audit purposes.
    const { rows } = await db.query(
      `UPDATE ops_runbooks
          SET is_active = FALSE, updated_at = NOW()
        WHERE id = $1 AND is_active = TRUE
      RETURNING id, code`,
      [id]
    );
    if (!rows.length) {
      return res.status(404).json({ error: 'Runbook not found.', code: 'runbook_not_found' });
    }
    return res.json({ success: true, runbook: rows[0] });
  } catch (err) {
    logger.error('serviceOps.deleteRunbook failed', { error: err.message });
    return next(err);
  }
}

module.exports = {
  getCapacity,
  listRunbooks,
  createRunbook,
  updateRunbook,
  deleteRunbook,
};
