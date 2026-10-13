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

// Review targets a report can point at. product_reviews uses UUID ids;
// business_reviews and food_reviews use BIGINT ids in their own tables,
// so each type has its own reference column on review_reports.
const REVIEW_TYPES = Object.freeze({
  product: Object.freeze({
    idColumn: 'review_id',
    table: 'product_reviews',
    reviewerColumn: 'helper_id',
    lookupSql: 'SELECT id, helper_id AS reviewer_id FROM product_reviews WHERE id = $1',
    bumpCountSql: 'UPDATE product_reviews SET report_count = report_count + 1, updated_at = NOW() WHERE id = $1',
  }),
  business: Object.freeze({
    idColumn: 'business_review_id',
    table: 'business_reviews',
    reviewerColumn: 'customer_id',
    lookupSql: 'SELECT id, customer_id AS reviewer_id FROM business_reviews WHERE id = $1',
    bumpCountSql: 'UPDATE business_reviews SET report_count = report_count + 1, updated_at = NOW() WHERE id = $1',
  }),
  food: Object.freeze({
    idColumn: 'food_review_id',
    table: 'food_reviews',
    reviewerColumn: 'customer_id',
    lookupSql: 'SELECT id, customer_id AS reviewer_id FROM food_reviews WHERE id = $1',
    bumpCountSql: 'UPDATE food_reviews SET report_count = report_count + 1 WHERE id = $1',
  }),
});
const REVIEW_TYPE_VALUES = Object.freeze(Object.keys(REVIEW_TYPES));

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
    const { reason, description, reviewType = 'product' } = req.body;
    const clientRequestId = getClientRequestId(req);
    if (clientRequestId === false) {
      throw new AppError('Validation failed', 400, 'validation_failed', { clientRequestId: 'Must be a valid UUID' });
    }

    const fields = {};
    if (!REVIEW_TYPE_VALUES.includes(reviewType)) {
      fields.reviewType = `Invalid review type. Must be one of: ${REVIEW_TYPE_VALUES.join(', ')}`;
    }
    if (!REPORT_REASON_VALUES.includes(reason)) {
      fields.reason = `Invalid reason. Must be one of: ${REPORT_REASON_VALUES.join(', ')}`;
    }
    if (!description || description.trim().length < 10) {
      fields.description = 'Please provide at least 10 characters of detail';
    }
    if (Object.keys(fields).length) {
      throw new AppError('Validation failed', 400, 'validation_failed', fields);
    }

    const typeCfg = REVIEW_TYPES[reviewType];

    // Verify review exists (business and food reviews live in their own tables)
    const { rows: reviewRows } = await pool.query(typeCfg.lookupSql, [reviewId]);

    if (!reviewRows.length) {
      throw new AppError('Review not found', 404, 'not_found');
    }

    const review = reviewRows[0];

    // Cannot report own review
    if (review.reviewer_id === userId) {
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

    // Check for duplicate pending report from same user (scoped to review type)
    const { rows: existingReports } = await pool.query(
      `SELECT id FROM review_reports
       WHERE review_type = $1 AND ${typeCfg.idColumn} = $2 AND reported_by = $3 AND status IN ('open', 'under_review')`,
      [reviewType, reviewId, userId]
    );

    if (existingReports.length > 0) {
      throw new AppError('You have already reported this review', 409, 'already_reported');
    }

    // Create report
    const { rows: reportRows } = await pool.query(
      `INSERT INTO review_reports (review_type, ${typeCfg.idColumn}, reported_by, reason, description, status, submitted_at, client_request_id)
       VALUES ($1, $2, $3, $4, $5, 'open', NOW(), $6)
       ON CONFLICT (reported_by, client_request_id)
       WHERE client_request_id IS NOT NULL DO NOTHING
       RETURNING *`,
      [reviewType, reviewId, userId, reason, description.trim(), clientRequestId]
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
    await pool.query(typeCfg.bumpCountSql, [reviewId]);

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
            body: `A ${reviewType} review has been reported as ${reason.replace(/_/g, ' ')}`,
            data: { reviewId, reviewType, reportId: report.id },
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
         COALESCE(pr.rating, br.rating, fr.rating) AS rating,
         pr.title AS product_title,
         pr.comment AS product_comment,
         pr.helper_id,
         br.testimonial AS business_testimonial,
         br.business_id,
         fr.body AS food_body,
         fr.restaurant_id,
         COALESCE(pr.helper_id, br.customer_id, fr.customer_id) AS reviewer_id,
         u_rev.first_name || ' ' || u_rev.last_name AS reviewer_name
       FROM review_reports r
       LEFT JOIN product_reviews pr ON r.review_type = 'product' AND r.review_id = pr.id
       LEFT JOIN business_reviews br ON r.review_type = 'business' AND r.business_review_id = br.id
       LEFT JOIN food_reviews fr ON r.review_type = 'food' AND r.food_review_id = fr.id
       LEFT JOIN users u_rev ON u_rev.id = COALESCE(pr.helper_id, br.customer_id, fr.customer_id)
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
         COALESCE(pr.rating, br.rating, fr.rating) AS rating,
         pr.title AS product_title, pr.comment AS product_comment,
         pr.helper_id, pr.product_id,
         br.testimonial AS business_testimonial, br.business_id,
         fr.body AS food_body, fr.restaurant_id,
         COALESCE(pr.helper_id, br.customer_id, fr.customer_id) AS reviewer_id,
         u_rev.first_name || ' ' || u_rev.last_name AS reviewer_name,
         u_reporter.first_name || ' ' || u_reporter.last_name AS reporter_name,
         u_admin.first_name || ' ' || u_admin.last_name AS reviewed_by_name,
         p.name AS product_name,
         b.business_name AS business_name,
         fr_rest.display_name AS restaurant_name
       FROM review_reports r
       LEFT JOIN product_reviews pr ON r.review_type = 'product' AND r.review_id = pr.id
       LEFT JOIN business_reviews br ON r.review_type = 'business' AND r.business_review_id = br.id
       LEFT JOIN food_reviews fr ON r.review_type = 'food' AND r.food_review_id = fr.id
       LEFT JOIN users u_rev ON u_rev.id = COALESCE(pr.helper_id, br.customer_id, fr.customer_id)
       JOIN users u_reporter ON r.reported_by = u_reporter.id
       LEFT JOIN users u_admin ON r.reviewed_by = u_admin.id
       LEFT JOIN marketplace_products p ON pr.product_id = p.id
       LEFT JOIN businesses b ON br.business_id = b.id
       LEFT JOIN food_restaurants fr_rest ON fr.restaurant_id = fr_rest.id
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
         COALESCE(pr.rating, br.rating, fr.rating) AS rating,
         pr.title AS product_title, pr.comment AS product_comment,
         pr.helper_id, pr.product_id,
         br.testimonial AS business_testimonial, br.business_id,
         fr.body AS food_body, fr.restaurant_id,
         COALESCE(pr.helper_id, br.customer_id, fr.customer_id) AS reviewer_id,
         u_rev.first_name || ' ' || u_rev.last_name AS reviewer_name,
         u_reporter.first_name || ' ' || u_reporter.last_name AS reporter_name,
         u_admin.first_name || ' ' || u_admin.last_name AS reviewed_by_name,
         p.name AS product_name,
         b.business_name AS business_name,
         fr_rest.display_name AS restaurant_name
       FROM review_reports r
       LEFT JOIN product_reviews pr ON r.review_type = 'product' AND r.review_id = pr.id
       LEFT JOIN business_reviews br ON r.review_type = 'business' AND r.business_review_id = br.id
       LEFT JOIN food_reviews fr ON r.review_type = 'food' AND r.food_review_id = fr.id
       LEFT JOIN users u_rev ON u_rev.id = COALESCE(pr.helper_id, br.customer_id, fr.customer_id)
       JOIN users u_reporter ON r.reported_by = u_reporter.id
       LEFT JOIN users u_admin ON r.reviewed_by = u_admin.id
       LEFT JOIN marketplace_products p ON pr.product_id = p.id
       LEFT JOIN businesses b ON br.business_id = b.id
       LEFT JOIN food_restaurants fr_rest ON fr.restaurant_id = fr_rest.id
       WHERE r.id = $1`,
      [reportId]
    );

    if (!reportRows.length) {
      throw new AppError('Report not found', 404, 'not_found');
    }

    const report = reportRows[0];
    const detailCfg = REVIEW_TYPES[report.review_type] || REVIEW_TYPES.product;

    // Get moderation history
    const { rows: history } = await pool.query(
      `SELECT
         m.*,
         u.first_name || ' ' || u.last_name AS performed_by_name
       FROM review_moderation_log m
       JOIN users u ON m.performed_by = u.id
       WHERE m.review_type = $1
         AND (
           (m.review_id = $2 AND $1 = 'product')
           OR (m.business_review_id = $2 AND $1 = 'business')
           OR (m.food_review_id = $2 AND $1 = 'food')
         )
       ORDER BY m.created_at DESC`,
      [report.review_type, report[detailCfg.idColumn]]
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
      const resolveCfg = REVIEW_TYPES[report.review_type] || REVIEW_TYPES.product;
      const targetReviewId = report[resolveCfg.idColumn];

      // Moderation-log insert shared by all review types; only the
      // matching reference column is populated.
      const logModeration = (action, reason) => client.query(
        `INSERT INTO review_moderation_log
           (review_type, review_id, business_review_id, food_review_id, action, reason, performed_by, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          report.review_type,
          report.review_type === 'product' ? targetReviewId : null,
          report.review_type === 'business' ? targetReviewId : null,
          report.review_type === 'food' ? targetReviewId : null,
          action,
          reason,
          req.user.id,
          JSON.stringify({ reportId, decision }),
        ]
      );

      // Notify reviewer of warning
      const notifyReviewerOfWarning = async () => {
        try {
          const { rows: reviewRows } = await client.query(
            `SELECT ${resolveCfg.reviewerColumn} AS reviewer_id FROM ${resolveCfg.table} WHERE id = $1`,
            [targetReviewId]
          );

          if (reviewRows.length > 0 && reviewRows[0].reviewer_id) {
            const reviewerId = reviewRows[0].reviewer_id;
            await sendNotification({
              userId: reviewerId,
              type: 'review_warning',
              title: 'Review Content Warning',
              body: 'One of your reviews has been flagged for moderation. Please review our community guidelines.',
              data: { reviewId: targetReviewId, reviewType: report.review_type },
              action_url: '/my-profile/reviews'
            });
          }
        } catch (notifyErr) {
          logger.warn('Failed to notify reviewer of warning', { reportId, error: notifyErr.message });
        }
      };

      // If upheld, take action on review
      if (decision === 'upheld') {
        if (actionType === 'removed') {
          if (report.review_type === 'product') {
            await client.query(
              `UPDATE product_reviews
               SET is_removed = true, removed_at = NOW(), moderation_reason = $1, updated_at = NOW()
               WHERE id = $2`,
              [`Removed due to: ${report.reason}`, targetReviewId]
            );
          } else {
            // food_reviews has no updated_at column; business_reviews does.
            await client.query(
              report.review_type === 'business'
                ? `UPDATE business_reviews
                   SET is_hidden = true, moderation_reason = $1, updated_at = NOW()
                   WHERE id = $2`
                : `UPDATE food_reviews
                   SET is_hidden = true, moderation_reason = $1
                   WHERE id = $2`,
              [`Removed due to: ${report.reason}`, targetReviewId]
            );
          }

          await logModeration('removed', report.reason);
        } else if (actionType === 'hidden') {
          if (report.review_type === 'product') {
            await client.query(
              `UPDATE product_reviews
               SET is_hidden = true, hidden_at = NOW(), moderation_reason = $1, updated_at = NOW()
               WHERE id = $2`,
              [`Hidden due to: ${report.reason}`, targetReviewId]
            );
          } else if (report.review_type === 'business') {
            await client.query(
              `UPDATE business_reviews
               SET is_hidden = true, moderation_reason = $1, updated_at = NOW()
               WHERE id = $2`,
              [`Hidden due to: ${report.reason}`, targetReviewId]
            );
          } else {
            await client.query(
              `UPDATE food_reviews
               SET is_hidden = true, moderation_reason = $1
               WHERE id = $2`,
              [`Hidden due to: ${report.reason}`, targetReviewId]
            );
          }

          await logModeration('hidden', report.reason);
        } else if (actionType === 'warning_issued') {
          await logModeration('warning_issued', `Warning issued to reviewer for: ${report.reason}`);
          await notifyReviewerOfWarning();
        }
      }

      logger.info('Review report resolved', {
        reportId,
        reviewId: targetReviewId,
        reviewType: report.review_type,
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
