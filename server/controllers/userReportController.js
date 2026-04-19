const db = require('../db');
const logger = require('../utils/logger');

// Map report types to severity levels
const SEVERITY_MAP = {
  'fraud': 'critical',        // Fraudulent activity - highest priority
  'non_payment': 'high',      // Payment non-compliance - high priority
  'tool_damage': 'medium',    // Tool condition disputes - medium priority
  'non_return': 'high',       // Missing/non-returned tools - high priority
  'other': 'low'              // General issues - low priority
};

const getReportSeverity = (reportType) => {
  return SEVERITY_MAP[reportType] || 'medium';
};

const submitReport = async (req, res) => {
  try {
    const { reportedUserId, bookingId, reportType, description } = req.body;
    const reporterId = req.user.id;

    // Validate report type
    const validTypes = ['non_payment', 'tool_damage', 'non_return', 'fraud', 'other'];
    if (!validTypes.includes(reportType)) {
      return res.status(400).json({ error: 'Invalid report type' });
    }

    if (!description || description.trim().length < 10) {
      return res.status(400).json({ error: 'Description must be at least 10 characters' });
    }

    if (reporterId === reportedUserId) {
      return res.status(400).json({ error: 'Cannot report yourself' });
    }

    // Prevent duplicate reports for same user+booking combo (within 30 days)
    const existingReport = await db.query(
      `SELECT id FROM user_reports
       WHERE reporter_id = $1 AND reported_user_id = $2 AND booking_id = $3
       AND created_at > NOW() - INTERVAL '30 days'`,
      [reporterId, reportedUserId, bookingId]
    );

    if (existingReport.rows.length > 0) {
      return res.status(400).json({ error: 'You have already reported this user for this booking' });
    }

    // Determine severity based on report type
    const severity = getReportSeverity(reportType);

    // Create report with intelligent severity mapping
    const result = await db.query(
      `INSERT INTO user_reports
       (reporter_id, reported_user_id, booking_id, report_type, description, status, severity)
       VALUES ($1, $2, $3, $4, $5, 'open', $6)
       RETURNING id, report_type, status, severity, created_at`,
      [reporterId, reportedUserId, bookingId, reportType, description.trim(), severity]
    );

    const report = result.rows[0];

    res.json({
      reportId: report.id,
      status: report.status,
      message: 'Report submitted. Our team will review it within 48 hours.'
    });

    logger.info('User report submitted', {
      reportId: report.id,
      reporterId,
      reportedUserId,
      reportType
    });
  } catch (err) {
    logger.error('submitReport error', { err });
    res.status(500).json({ error: 'Failed to submit report' });
  }
};

const getMyReports = async (req, res) => {
  try {
    const userId = req.user.id;
    const { status } = req.query;

    let query = `
      SELECT ur.id, ur.reported_user_id, ur.report_type, ur.description, ur.status,
             ur.severity, ur.created_at, u.first_name, u.last_name, u.email
      FROM user_reports ur
      JOIN users u ON ur.reported_user_id = u.id
      WHERE ur.reporter_id = $1
    `;

    const params = [userId];

    if (status) {
      query += ` AND ur.status = $2`;
      params.push(status);
    }

    query += ` ORDER BY ur.created_at DESC`;

    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (err) {
    logger.error('getMyReports error', { err });
    res.status(500).json({ error: 'Failed to load reports' });
  }
};

const getReportsAgainstMe = async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 50 } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 50));
    const offset = (pageNum - 1) * limitNum;

    // Get total count
    const countResult = await db.query(
      `SELECT COUNT(*) as total FROM user_reports WHERE reported_user_id = $1`,
      [userId]
    );
    const total = parseInt(countResult.rows[0].total);

    // Get paginated results
    const result = await db.query(
      `SELECT ur.id, ur.reporter_id, ur.report_type, ur.description, ur.status,
              ur.severity, ur.created_at, u.first_name, u.last_name, u.email
       FROM user_reports ur
       JOIN users u ON ur.reporter_id = u.id
       WHERE ur.reported_user_id = $1
       ORDER BY ur.severity DESC, ur.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limitNum, offset]
    );

    res.json({
      reports: result.rows,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum)
      }
    });
  } catch (err) {
    logger.error('getReportsAgainstMe error', { err });
    res.status(500).json({ error: 'Failed to load reports against you' });
  }
};

const adminGetReports = async (req, res) => {
  try {
    // Require admin role
    if (!req.user || !['admin', 'super_admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { status, severity, page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;

    let whereClause = '';
    const params = [];

    if (status) {
      params.push(status);
      whereClause += `status = $${params.length} AND `;
    }

    if (severity) {
      params.push(severity);
      whereClause += `severity = $${params.length} AND `;
    }

    if (whereClause) {
      whereClause = `WHERE ${whereClause.slice(0, -5)}`;
    }

    params.push(limit);
    params.push(offset);

    const result = await db.query(
      `SELECT ur.id, ur.reporter_id, ur.reported_user_id, ur.report_type,
              ur.description, ur.status, ur.severity, ur.platform_action,
              ur.created_at, ur.updated_at,
              ur_user.first_name as reported_first, ur_user.last_name as reported_last,
              rep_user.first_name as reporter_first, rep_user.last_name as reporter_last
       FROM user_reports ur
       JOIN users ur_user ON ur.reported_user_id = ur_user.id
       JOIN users rep_user ON ur.reporter_id = rep_user.id
       ${whereClause}
       ORDER BY ur.severity DESC, ur.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json(result.rows);
  } catch (err) {
    logger.error('adminGetReports error', { err });
    res.status(500).json({ error: 'Failed to load reports' });
  }
};

const adminUpdateReportStatus = async (req, res) => {
  try {
    const { reportId } = req.params;
    const { status, platformAction } = req.body;

    const validStatuses = ['open', 'investigating', 'resolved', 'dismissed', 'closed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const result = await db.query(
      `UPDATE user_reports
       SET status = $1, platform_action = $2, updated_at = CURRENT_TIMESTAMP,
           resolved_at = CASE WHEN $1 IN ('resolved', 'dismissed', 'closed') THEN CURRENT_TIMESTAMP ELSE resolved_at END
       WHERE id = $3
       RETURNING *`,
      [status, platformAction || null, reportId]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ error: 'Report not found' });
    }

    res.json(result.rows[0]);

    logger.info('Report status updated', {
      reportId,
      newStatus: status,
      platformAction
    });
  } catch (err) {
    logger.error('adminUpdateReportStatus error', { err });
    res.status(500).json({ error: 'Failed to update report' });
  }
};

module.exports = {
  submitReport,
  getMyReports,
  getReportsAgainstMe,
  adminGetReports,
  adminUpdateReportStatus
};
