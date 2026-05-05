/**
 * reportingController.js
 * Handles user reports for abuse, harassment, safety violations
 */

const pool = require('../db');
const { AppError } = require('../utils/apiError');
const logger = require('../utils/logger');
const { sendValidationError, sendError } = require('../utils/apiError');

/**
 * Submit a report against another user
 * POST /api/reports
 */
async function submitReport(req, res) {
  try {
    const { reportedUserId, reason, description, evidenceUrls, jobId, conversationId } = req.body;
    const reporterId = req.user.id;

    // Validation
    if (!reportedUserId) {
      return sendValidationError(res, { reportedUserId: 'Required' });
    }
    if (!reason) {
      return sendValidationError(res, { reason: 'Required' });
    }
    if (!description || description.trim().length === 0) {
      return sendValidationError(res, { description: 'Required' });
    }
    if (description.length > 2000) {
      return sendValidationError(res, { description: 'Max 2000 characters' });
    }

    // Cannot report self
    if (reporterId === reportedUserId) {
      throw new AppError('Cannot report yourself', 400, 'SELF_REPORT');
    }

    // Verify reason is valid
    const validReasons = ['harassment', 'no_show', 'damaged_property', 'abusive_language', 'safety_violation', 'scam', 'other'];
    if (!validReasons.includes(reason)) {
      return sendValidationError(res, { reason: 'Invalid reason' });
    }

    // Verify user exists
    const userResult = await pool.query('SELECT id FROM users WHERE id = $1', [reportedUserId]);
    if (!userResult.rows.length) {
      throw new AppError('User not found', 404, 'USER_NOT_FOUND');
    }

    // Create report
    const result = await pool.query(
      `INSERT INTO job_user_reports (
        reporter_id, reported_user_id, reason, description, evidence_urls,
        job_id, conversation_id, status, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'submitted', CURRENT_TIMESTAMP)
      RETURNING id, reporter_id, reported_user_id, reason, status, created_at`,
      [reporterId, reportedUserId, reason, description, evidenceUrls || null, jobId || null, conversationId || null]
    );

    const report = result.rows[0];
    logger.info('User report submitted', {
      reportId: report.id,
      reporterId,
      reportedUserId,
      reason
    });

    res.status(201).json({
      success: true,
      data: {
        id: report.id,
        reportedUserId: report.reported_user_id,
        reason: report.reason,
        status: report.status,
        createdAt: report.created_at
      }
    });
  } catch (err) {
    logger.error('Error submitting report', { error: err.message });
    if (err instanceof AppError) {
      return res.status(err.statusCode).json({ success: false, error: err.message });
    }
    sendError(res, 500, 'Failed to submit report');
  }
}

/**
 * Get user's own reports (reports they filed)
 * GET /api/reports/my-reports
 */
async function getMyReports(req, res) {
  try {
    const userId = req.user.id;

    const result = await pool.query(
      `SELECT
        id, reported_user_id, reason, description, evidence_urls,
        job_id, conversation_id, status, admin_notes, reviewed_by,
        resolution, created_at, updated_at, resolved_at
      FROM job_user_reports
      WHERE reporter_id = $1
      ORDER BY created_at DESC
      LIMIT 50`,
      [userId]
    );

    res.json({
      success: true,
      data: result.rows.map(row => ({
        id: row.id,
        reportedUserId: row.reported_user_id,
        reason: row.reason,
        description: row.description,
        evidenceUrls: row.evidence_urls,
        jobId: row.job_id,
        conversationId: row.conversation_id,
        status: row.status,
        adminNotes: row.admin_notes,
        reviewedBy: row.reviewed_by,
        resolution: row.resolution,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        resolvedAt: row.resolved_at
      }))
    });
  } catch (err) {
    logger.error('Error fetching reports', { error: err.message, userId: req.user.id });
    sendError(res, 500, 'Failed to fetch reports');
  }
}

/**
 * Admin: Get all reports with filtering
 * GET /api/admin/reports
 */
async function listReports(req, res) {
  try {
    const { status, reason, reportedUserId, sortBy = 'created_at' } = req.query;
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const offset = Math.max(0, parseInt(req.query.offset) || 0);

    let query = 'SELECT id, reporter_id, reported_user_id, reason, status, resolution, created_at FROM job_user_reports WHERE 1=1';
    const params = [];
    let paramCount = 0;

    if (status) {
      paramCount++;
      query += ` AND status = $${paramCount}`;
      params.push(status);
    }
    if (reason) {
      paramCount++;
      query += ` AND reason = $${paramCount}`;
      params.push(reason);
    }
    if (reportedUserId) {
      paramCount++;
      query += ` AND reported_user_id = $${paramCount}`;
      params.push(reportedUserId);
    }

    // Validate sortBy
    const allowedSorts = ['created_at', 'status', 'reason', 'resolution'];
    const sort = allowedSorts.includes(sortBy) ? sortBy : 'created_at';
    query += ` ORDER BY ${sort} DESC`;

    query += ` LIMIT $${++paramCount} OFFSET $${++paramCount}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    // Get total count
    let countQuery = 'SELECT COUNT(*) as count FROM job_user_reports WHERE 1=1';
    const countParams = [];
    let countParamCount = 0;

    if (status) {
      countParamCount++;
      countQuery += ` AND status = $${countParamCount}`;
      countParams.push(status);
    }
    if (reason) {
      countParamCount++;
      countQuery += ` AND reason = $${countParamCount}`;
      countParams.push(reason);
    }
    if (reportedUserId) {
      countParamCount++;
      countQuery += ` AND reported_user_id = $${countParamCount}`;
      countParams.push(reportedUserId);
    }

    const countResult = await pool.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].count);

    res.json({
      success: true,
      data: result.rows.map(row => ({
        id: row.id,
        reporterId: row.reporter_id,
        reportedUserId: row.reported_user_id,
        reason: row.reason,
        status: row.status,
        resolution: row.resolution,
        createdAt: row.created_at
      })),
      pagination: {
        limit,
        offset,
        total,
        hasMore: offset + limit < total
      }
    });
  } catch (err) {
    logger.error('Error listing reports', { error: err.message });
    sendError(res, 500, 'Failed to fetch reports');
  }
}

/**
 * Admin: Get report detail
 * GET /api/admin/reports/:reportId
 */
async function getReportDetail(req, res) {
  try {
    const { reportId } = req.params;

    const result = await pool.query(
      `SELECT
        id, reporter_id, reported_user_id, reason, description, evidence_urls,
        job_id, conversation_id, status, admin_notes, reviewed_by,
        resolution, created_at, updated_at, resolved_at
      FROM job_user_reports
      WHERE id = $1`,
      [reportId]
    );

    if (!result.rows.length) {
      throw new AppError('Report not found', 404, 'REPORT_NOT_FOUND');
    }

    const row = result.rows[0];
    res.json({
      success: true,
      data: {
        id: row.id,
        reporterId: row.reporter_id,
        reportedUserId: row.reported_user_id,
        reason: row.reason,
        description: row.description,
        evidenceUrls: row.evidence_urls,
        jobId: row.job_id,
        conversationId: row.conversation_id,
        status: row.status,
        adminNotes: row.admin_notes,
        reviewedBy: row.reviewed_by,
        resolution: row.resolution,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        resolvedAt: row.resolved_at
      }
    });
  } catch (err) {
    logger.error('Error fetching report', { error: err.message, reportId: req.params.reportId });
    if (err instanceof AppError) {
      return res.status(err.statusCode).json({ success: false, error: err.message });
    }
    sendError(res, 500, 'Failed to fetch report');
  }
}

/**
 * Admin: Update report status
 * PATCH /api/admin/reports/:reportId/status
 */
async function updateReportStatus(req, res) {
  try {
    const { reportId } = req.params;
    const { status, adminNotes } = req.body;
    const adminId = req.user.id;

    const validStatuses = ['submitted', 'reviewing', 'resolved', 'dismissed', 'escalated'];
    if (!validStatuses.includes(status)) {
      return sendValidationError(res, { status: 'Invalid status' });
    }

    // Get report first
    const reportResult = await pool.query('SELECT reported_user_id FROM job_user_reports WHERE id = $1', [reportId]);
    if (!reportResult.rows.length) {
      throw new AppError('Report not found', 404, 'REPORT_NOT_FOUND');
    }

    const reportedUserId = reportResult.rows[0].reported_user_id;

    // Update report
    await pool.query(
      `UPDATE job_user_reports
      SET status = $1, admin_notes = $2, reviewed_by = $3, updated_at = CURRENT_TIMESTAMP,
          resolved_at = CASE WHEN $1 IN ('resolved', 'dismissed') THEN CURRENT_TIMESTAMP ELSE resolved_at END
      WHERE id = $4`,
      [status, adminNotes || null, adminId, reportId]
    );

    // Log admin action
    await pool.query(
      `INSERT INTO enforcement_audit_log (admin_id, action, target_user_id, report_id, reason_for_action, created_at)
      VALUES ($1, 'reviewed_report', $2, $3, $4, CURRENT_TIMESTAMP)`,
      [adminId, reportedUserId, reportId, adminNotes || null]
    );

    logger.info('Report status updated', {
      reportId,
      status,
      adminId
    });

    res.json({
      success: true,
      message: 'Report status updated'
    });
  } catch (err) {
    logger.error('Error updating report status', { error: err.message, reportId: req.params.reportId });
    if (err instanceof AppError) {
      return res.status(err.statusCode).json({ success: false, error: err.message });
    }
    sendError(res, 500, 'Failed to update report');
  }
}

module.exports = {
  submitReport,
  getMyReports,
  listReports,
  getReportDetail,
  updateReportStatus
};
