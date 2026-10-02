'use strict';

/**
 * Admin User-Action Audit Log Viewer
 *
 * Surfaces the structured per-field audit trail captured by
 * `auditService.logUserAction` (table: admin_user_action_log).
 *
 * Endpoints:
 *   GET /admin/super/audit-log/user-actions          (filterable list + total)
 *   GET /admin/super/audit-log/user-actions/export   (CSV stream)
 */

const logger = require('../utils/logger');
const { getUserActionLogs } = require('../services/auditService');
const { withDbBudget } = require('../utils/dbBudgets');
const { parsePagination } = require('../utils/boundedPagination');
const { resolveScope } = require('../utils/scopeFilter');

/**
 * E05: resolve the caller's region scope for audit-log reads.
 * Returns undefined for global (super-admin, no filter), an array of
 * region ids otherwise (empty array = fail closed, no rows). Throws
 * ScopeUnavailableError when scope cannot be established.
 */
function auditScopeRegionIds(req) {
  const scope = resolveScope(req);
  return scope.type === 'global' ? undefined : scope.regionIds;
}

function scopeFailureResponse(res, err) {
  return res.status(err.statusCode || 503).json({
    error: 'Request scope is temporarily unavailable. Please retry.',
    code: err.code || 'SCOPE_UNAVAILABLE',
  });
}

// ── GET ─────────────────────────────────────────────────────────────────────

exports.listUserActions = async (req, res) => {
  try {
    // E04: bounded pagination at the edge so no unbounded list query can
    // exhaust the pool.
    const { limit, offset } = parsePagination(req.query, { defaultLimit: 100, maxLimit: 500 });
    const filters = {
      adminId:      req.query.admin_id      || null,
      targetUserId: req.query.target_user_id || null,
      actionType:   req.query.action_type   || null,
      regionId:     req.query.region_id     ? parseInt(req.query.region_id, 10) : null,
      fromDate:     req.query.from_date     || null,
      toDate:       req.query.to_date       || null,
      limit,
      offset,
      // E05: server-side region scoping, fail closed.
      scopeRegionIds: auditScopeRegionIds(req),
    };

    const { rows, total } = await getUserActionLogs(filters);
    return res.json({ logs: rows, total, limit });
  } catch (err) {
    if (err && err.code === 'SCOPE_UNAVAILABLE') return scopeFailureResponse(res, err);
    logger.error('listUserActions error', { err: err.message });
    return res.status(500).json({ error: 'Failed to fetch audit logs.' });
  }
};

// ── GET .../export → CSV ────────────────────────────────────────────────────

const CSV_COLUMNS = [
  'created_at', 'admin_email', 'admin_name', 'target_email', 'target_name',
  'action_type', 'field_name', 'old_value', 'new_value',
  'ip_address', 'region_name', 'user_notified',
];

function csvEscape(val) {
  if (val === null || val === undefined) return '';
  let s = String(val);
  // Keep exported audit values inert when opened in spreadsheet software.
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

exports.exportUserActions = async (req, res, next) => {
  try {
    // E04: heavy exports run under the 'exports' workload budget so they
    // cannot starve the web tier. On exhaustion the error middleware
    // answers 503 with code DB_BUDGET_EXHAUSTED (fail closed).
    await withDbBudget('exports', async () => {
      const filters = {
        adminId:      req.query.admin_id      || null,
        targetUserId: req.query.target_user_id || null,
        actionType:   req.query.action_type   || null,
        regionId:     req.query.region_id     ? parseInt(req.query.region_id, 10) : null,
        fromDate:     req.query.from_date     || null,
        toDate:       req.query.to_date       || null,
        limit:        500,
        offset:       0,
        // E05: server-side region scoping, fail closed.
        scopeRegionIds: auditScopeRegionIds(req),
      };

      const { rows } = await getUserActionLogs(filters);

      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="user-actions-${new Date().toISOString().slice(0, 10)}.csv"`
      );

      res.write(CSV_COLUMNS.join(',') + '\r\n');
      for (const r of rows) {
        res.write(CSV_COLUMNS.map(c => csvEscape(r[c])).join(',') + '\r\n');
      }
      res.end();
    });
  } catch (err) {
    if (err && err.code === 'DB_BUDGET_EXHAUSTED') return next(err);
    if (err && err.code === 'SCOPE_UNAVAILABLE') return scopeFailureResponse(res, err);
    logger.error('exportUserActions error', { err: err.message });
    return res.status(500).json({ error: 'Failed to export audit logs.' });
  }
};
