/**
 * reviewModerationController.js
 * Review reporting and moderation by admins
 */

const pool = require('../db');
const logger = require('../utils/logger');
const { AppError } = require('../middleware/errorHandler');
const { withTransaction } = require('../utils/transaction');
const { sendNotification } = require('../services/notificationService');
const { getClientRequestId } = require('../utils/idempotency');

const REPORT_REASONS = Object.freeze({
  FALSE_REVIEW: 'false_review',
  INAPPROPRIATE_LANGUAGE: 'inappropriate_language',
  SPAM: 'spam',
  OFF_TOPIC: 'off_topic',
  UNRELATED_TO_PRODUCT: 'unrelated_to_product',
  HARASSMENT: 'harassment'
});

const REPORT_REASON_VALUES = Object.freeze(Object.values(REPORT_REASONS));

const MODERATION_ACTIONS = Object.freeze({
  HIDDEN: 'hidden',
  REMOVED: 'removed',
  WARNING_ISSUED: 'warning_issued',
  FLAGGED: 'flagged'
});

// ─── USER: REPORT A REVIEW ───────────────────────────────────
/**
 * POST /api/reviews/:reviewId/report
 * Allow users to report inappropriate or false reviews
 */
exports.reportReview = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { reviewId } = req.params;
    const { reason, description } = req.body;
    const clientRequestId = getClientRequestId(req);
    if (clientRequestId === false) {
      throw new AppError('Validation failed', 400, 'validation_failed', { clientRequestId: 'Must be a valid UUID' });
    }

    const fields = {};
    if (!REPORT_REASON_VALUES.includes(reason)) {
      fields.reason = `Invalid reason. Must be one of: ${REPORT_REASON_VALUES.join(', ')}`;
    }
    if (!description || description.trim().length < 10) {
      fields.description = 'Please provide at least 10 characters of detail';
    }
    if (Object.keys(fields).length) {
      throw new AppError('Validation failed', 400, 'validation_failed', fields);
    }

    // Verify review exists
    const { rows: reviewRows } = await pool.query(
      'SELECT id, helper_id, product_id FROM product_reviews WHERE id = $1',
      [reviewId]
    );

    if (!reviewRows.length) {
      throw new AppError('Review not found', 404, 'not_found');
    }

    const review = reviewRows[0];

    // Cannot report own review
    if (review.helper_id === userId) {
      throw new AppError('You cannot report your own review', 400, 'validation_failed');
    }

    if (clientRequestId) {
      const { rows: keyedReports } = await pool.query(
        `SELECT * FROM review_reports
          WHERE review_id = $1 AND reported_by = $2 AND client_request_id = $3
          LIMIT 1`,
        [reviewId, userId, clientRequestId],
      );
      if (keyedReports[0]) {
        return res.status(200).json({
          success: true,
          data: keyedReports[0],
          idempotent: true,
          message: 'Review reported. Thank you for helping keep our community safe.',
        });
      }
    }

    // Check for duplicate pending report from same user
    const { rows: existingReports } = await pool.query(
      `SELECT id FROM review_reports
       WHERE review_id = $1 AND reported_by = $2 AND status IN ('open', 'under_review')`,
      [reviewId, userId]
    );

    if (existingReports.length > 0) {
      throw new AppError('You have already reported this review', 409, 'already_reported');
    }

    // Create report
    const { rows: reportRows } = await pool.query(
      `INSERT INTO review_reports (review_id, reported_by, reason, description, status, submitted_at, client_request_id)
       VALUES ($1, $2, $3, $4, 'open', NOW(), $5)
       ON CONFLICT (reported_by, client_request_id)
       WHERE client_request_id IS NOT NULL DO NOTHING
       RETURNING *`,
      [reviewId, userId, reason, description.trim(), clientRequestId]
    );

    let report = reportRows[0];
    let replayed = false;
    if (!report && clientRequestId) {
      const { rows: existingRows } = await pool.query(
        `SELECT * FROM review_reports
          WHERE reported_by = $1 AND client_request_id = $2
          LIMIT 1`,
        [userId, clientRequestId],
      );
      report = existingRows[0];
      replayed = Boolean(report);
    }
    if (!report) throw new AppError('Review report retry could not be recovered', 409, 'report_retry_failed');

    if (replayed) {
      return res.status(200).json({
        success: true,
        data: report,
        idempotent: true,
        message: 'Review reported. Thank you for helping keep our community safe.',
      });
    }

    // Increment report count on review
    await pool.query(
      'UPDATE product_reviews SET report_count = report_count + 1, updated_at = NOW() WHERE id = $1',
      [reviewId]
    );

    // Notify admins
    try {
      const { rows: adminRows } = await pool.query(
        `SELECT id FROM users WHERE role IN ('admin', 'super_admin') AND is_active = true LIMIT 5`
      );

      await Promise.allSettled(
        adminRows.map(admin =>
          sendNotification({
            userId: admin.id,
            type: 'review_reported',
            title: 'Review Reported for Moderation',
            body: `A review has been reported as ${reason.replace(/_/g, ' ')}`,
            data: { reviewId, reportId: report.id },
            action_url: `/admin/reviews/reports/${report.id}`
          })
        )
      );
    } catch (notifyErr) {
      logger.warn('Failed to notify admins of review report', { reportId: report.id, error: notifyErr.message });
    }

    res.status(201).json({
      success: true,
      data: report,
      idempotent: false,
      message: 'Review reported. Thank you for helping keep our community safe.'
    });
  } catch (err) {
    next(err);
  }
};

// ─── USER: GET MY REPORTS ───────────────────────────────────
/**
 * GET /api/reviews/my-reports
 */
exports.getMyReports = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const { rows: reports } = await pool.query(
      `SELECT
         r.*,
         pr.rating, pr.title, pr.comment, pr.helper_id,
         u_helper.first_name || ' ' || u_helper.last_name AS helper_name
       FROM review_reports r
       JOIN product_reviews pr ON r.review_id = pr.id
       JOIN users u_helper ON pr.helper_id = u_helper.id
       WHERE r.reported_by = $1
       ORDER BY r.submitted_at DESC`,
      [userId]
    );

    res.json({
      success: true,
      data: reports
    });
  } catch (err) {
    next(err);
  }
};

// ─── ADMIN: LIST REVIEW REPORTS ───────────────────────────────
/**
 * GET /api/admin/reviews/reports
 * List all review reports with filtering
 */
exports.listReports = async (req, res, next) => {
  try {
    const { status = 'open', limit = 20, offset = 0 } = req.query;

    const validStatuses = ['open', 'under_review', 'resolved', 'dismissed'];
    if (!validStatuses.includes(status)) {
      throw new AppError('Invalid status filter', 400, 'validation_failed');
    }

    const { rows: reports, rowCount } = await pool.query(
      `SELECT
         r.*,
         pr.rating, pr.title, pr.comment, pr.helper_id, pr.report_count,
         u_helper.first_name || ' ' || u_helper.last_name AS helper_name,
         u_reporter.first_name || ' ' || u_reporter.last_name AS reporter_name,
         u_admin.first_name || ' ' || u_admin.last_name AS reviewed_by_name
       FROM review_reports r
       JOIN product_reviews pr ON r.review_id = pr.id
       JOIN users u_helper ON pr.helper_id = u_helper.id
       JOIN users u_reporter ON r.reported_by = u_reporter.id
       LEFT JOIN users u_admin ON r.reviewed_by = u_admin.id
       WHERE r.status = $1
       ORDER BY r.submitted_at DESC
       LIMIT $2 OFFSET $3`,
      [status, limit, offset]
    );

    res.json({
      success: true,
      data: reports,
      total: parseInt(rowCount),
      pagination: { limit: parseInt(limit), offset: parseInt(offset) }
    });
  } catch (err) {
    next(err);
  }
};

// ─── ADMIN: GET REPORT DETAIL ────────────────────────────────
/**
 * GET /api/admin/reviews/reports/:reportId
 */
exports.getReportDetail = async (req, res, next) => {
  try {
    const { reportId } = req.params;

    const { rows: reportRows } = await pool.query(
      `SELECT
         r.*,
         pr.rating, pr.title, pr.comment, pr.helper_id, pr.product_id,
         u_helper.first_name || ' ' || u_helper.last_name AS helper_name,
         u_reporter.first_name || ' ' || u_reporter.last_name AS reporter_name,
         u_admin.first_name || ' ' || u_admin.last_name AS reviewed_by_name,
         p.name AS product_name
       FROM review_reports r
       JOIN product_reviews pr ON r.review_id = pr.id
       JOIN users u_helper ON pr.helper_id = u_helper.id
       JOIN users u_reporter ON r.reported_by = u_reporter.id
       LEFT JOIN users u_admin ON r.reviewed_by = u_admin.id
       LEFT JOIN marketplace_products p ON pr.product_id = p.id
       WHERE r.id = $1`,
      [reportId]
    );

    if (!reportRows.length) {
      throw new AppError('Report not found', 404, 'not_found');
    }

    const report = reportRows[0];

    // Get moderation history
    const { rows: history } = await pool.query(
      `SELECT
         m.*,
         u.first_name || ' ' || u.last_name AS performed_by_name
       FROM review_moderation_log m
       JOIN users u ON m.performed_by = u.id
       WHERE m.review_id = $1
       ORDER BY m.created_at DESC`,
      [report.review_id]
    );

    res.json({
      success: true,
      data: {
        ...report,
        moderation_history: history
      }
    });
  } catch (err) {
    next(err);
  }
};

// ─── ADMIN: REVIEW AND RESOLVE REPORT ────────────────────────
/**
 * PUT /api/admin/reviews/reports/:reportId/resolve
 * Admin reviews a report and takes action
 */
exports.resolveReport = async (req, res, next) => {
  try {
    const { reportId } = req.params;
    const { decision, adminNotes, actionType } = req.body; // decision: 'upheld' | 'dismissed'

    if (!['upheld', 'dismissed'].includes(decision)) {
      throw new AppError('Decision must be upheld or dismissed', 400, 'validation_failed');
    }

    const result = await withTransaction(pool, async (client) => {
      // Fetch and lock report
      const { rows: reportRows } = await client.query(
        'SELECT * FROM review_reports WHERE id = $1 FOR UPDATE',
        [reportId]
      );

      if (!reportRows.length) {
        throw new AppError('Report not found', 404, 'not_found');
      }

      const report = reportRows[0];

      // Update report status
      const resolutionAction = decision === 'upheld' ? actionType : 'no_action';
      const { rows: updatedReportRows } = await client.query(
        `UPDATE review_reports
         SET
           status = 'resolved',
           resolution_action = $1,
           admin_notes = $2,
           reviewed_by = $3,
           reviewed_at = NOW(),
           updated_at = NOW()
         WHERE id = $4
         RETURNING *`,
        [resolutionAction, adminNotes || null, req.user.id, reportId]
      );

      const updatedReport = updatedReportRows[0];

      // If upheld, take action on review
      if (decision === 'upheld') {
        if (actionType === 'removed') {
          await client.query(
            `UPDATE product_reviews
             SET is_removed = true, removed_at = NOW(), moderation_reason = $1, updated_at = NOW()
             WHERE id = $2`,
            [`Removed due to: ${report.reason}`, report.review_id]
          );

          await client.query(
            `INSERT INTO review_moderation_log (review_id, action, reason, performed_by, metadata)
             VALUES ($1, 'removed', $2, $3, $4)`,
            [report.review_id, report.reason, req.user.id, JSON.stringify({ reportId, decision })]
          );
        } else if (actionType === 'hidden') {
          await client.query(
            `UPDATE product_reviews
             SET is_hidden = true, hidden_at = NOW(), moderation_reason = $1, updated_at = NOW()
             WHERE id = $2`,
            [`Hidden due to: ${report.reason}`, report.review_id]
          );

          await client.query(
            `INSERT INTO review_moderation_log (review_id, action, reason, performed_by, metadata)
             VALUES ($1, 'hidden', $2, $3, $4)`,
            [report.review_id, report.reason, req.user.id, JSON.stringify({ reportId, decision })]
          );
        } else if (actionType === 'warning_issued') {
          await client.query(
            `INSERT INTO review_moderation_log (review_id, action, reason, performed_by, metadata)
             VALUES ($1, 'warning_issued', $2, $3, $4)`,
            [report.review_id, `Warning issued to reviewer for: ${report.reason}`, req.user.id, JSON.stringify({ reportId, decision })]
          );

          // Notify reviewer of warning
          try {
            const { rows: reviewRows } = await client.query(
              'SELECT helper_id FROM product_reviews WHERE id = $1',
              [report.review_id]
            );

            if (reviewRows.length > 0) {
              const reviewerId = reviewRows[0].helper_id;
              await sendNotification({
                userId: reviewerId,
                type: 'review_warning',
                title: 'Review Content Warning',
                body: 'One of your reviews has been flagged for moderation. Please review our community guidelines.',
                data: { reviewId: report.review_id },
                action_url: '/my-profile/reviews'
              });
            }
          } catch (notifyErr) {
            logger.warn('Failed to notify reviewer of warning', { reportId, error: notifyErr.message });
          }
        }
      }

      logger.info('Review report resolved', {
        reportId,
        reviewId: report.review_id,
        decision,
        actionType
      });

      return updatedReport;
    }, 'resolve_review_report');

    // Notify reporter of resolution
    try {
      const message = decision === 'upheld'
        ? 'Thank you for reporting. We have taken action on the review.'
        : 'We have reviewed the report and determined no action is needed at this time.';

      await sendNotification({
        userId: result.reported_by,
        type: 'report_resolved',
        title: 'Review Report Resolution',
        body: message,
        data: { reportId: result.id }
      });
    } catch (notifyErr) {
      logger.warn('Failed to notify reporter of resolution', { reportId, error: notifyErr.message });
    }

    res.json({
      success: true,
      data: result,
      message: `Report ${decision}`
    });
  } catch (err) {
    next(err);
  }
};

// ─── ADMIN: GET MODERATION STATS ─────────────────────────────
/**
 * GET /api/admin/reviews/stats
 */
exports.getModerationStats = async (req, res, next) => {
  try {
    const { rows: statsRows } = await pool.query(
      `SELECT
         COUNT(*) AS total_reports,
         COUNT(*) FILTER (WHERE status = 'open') AS open_reports,
         COUNT(*) FILTER (WHERE status = 'under_review') AS under_review_reports,
         COUNT(*) FILTER (WHERE status = 'resolved') AS resolved_reports,
         COUNT(*) FILTER (WHERE resolution_action = 'removed') AS reviews_removed,
         COUNT(*) FILTER (WHERE resolution_action = 'hidden') AS reviews_hidden,
         COUNT(*) FILTER (WHERE resolution_action = 'warning_issued') AS warnings_issued
       FROM review_reports`
    );

    const { rows: topReasonsRows } = await pool.query(
      `SELECT reason, COUNT(*) as count
       FROM review_reports
       GROUP BY reason
       ORDER BY count DESC`
    );

    res.json({
      success: true,
      data: {
        ...statsRows[0],
        top_reasons: topReasonsRows
      }
    });
  } catch (err) {
    next(err);
  }
};
