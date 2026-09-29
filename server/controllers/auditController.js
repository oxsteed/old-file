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

// ── GET ─────────────────────────────────────────────────────────────────────

exports.listUserActions = async (req, res) => {
  try {
    const filters = {
      adminId:      req.query.admin_id      || null,
      targetUserId: req.query.target_user_id || null,
      actionType:   req.query.action_type   || null,
      regionId:     req.query.region_id     ? parseInt(req.query.region_id, 10) : null,
      fromDate:     req.query.from_date     || null,
      toDate:       req.query.to_date       || null,
      limit:        req.query.limit         || 100,
      offset:       req.query.offset        || 0,
    };

    const { rows, total } = await getUserActionLogs(filters);
    return res.json({ logs: rows, total, limit: parseInt(filters.limit, 10) || 100 });
  } catch (err) {
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

exports.exportUserActions = async (req, res) => {
  try {
    const filters = {
      adminId:      req.query.admin_id      || null,
      targetUserId: req.query.target_user_id || null,
      actionType:   req.query.action_type   || null,
      regionId:     req.query.region_id     ? parseInt(req.query.region_id, 10) : null,
      fromDate:     req.query.from_date     || null,
      toDate:       req.query.to_date       || null,
      limit:        500,
      offset:       0,
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
    return res.end();
  } catch (err) {
    logger.error('exportUserActions error', { err: err.message });
    return res.status(500).json({ error: 'Failed to export audit logs.' });
  }
};
