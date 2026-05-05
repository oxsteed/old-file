/**
 * enforcementPolicyController.js
 * Public enforcement policies, user status checks, and appeal management
 */

const pool = require('../db');
const logger = require('../utils/logger');
const { AppError } = require('../middleware/errorHandler');
const { withTransaction } = require('../utils/transaction');

/**
 * Public endpoint: Get enforcement policy thresholds
 * GET /api/enforcement-policy
 *
 * Returns the public enforcement policy so users know when they'll be restricted
 */
exports.getEnforcementPolicy = async (req, res) => {
  try {
    res.json({
      success: true,
      data: {
        cancellationPolicy: {
          description: 'Users with high cancellation rates may face restrictions',
          thresholds: [
            {
              level: 'caution',
              cancellationRate: '5-15%',
              message: 'Elevated cancellation rate; consider why cancellations are frequent',
              action: 'none'
            },
            {
              level: 'warning',
              cancellationRate: '15-50%',
              message: 'Significant cancellation history; you may face restrictions soon',
              action: 'none'
            },
            {
              level: 'restricted',
              cancellationRate: '>50%',
              message: 'Your account is restricted due to excessive cancellations',
              action: 'posting_restricted' // customers: cannot post jobs
              // OR: bidding_restricted (helpers: cannot bid)
            }
          ]
        },
        helperLateNicancePolicy: {
          description: 'Helpers who cancel last-minute may face bidding restrictions',
          lateWindow: '< 24 hours before scheduled start',
          restrictions: {
            oneLateCancel: 'Recorded on profile',
            threeLateIn30Days: 'May face bidding restrictions',
            fiveOrMoreLate: 'Bidding restricted for 30 days'
          }
        },
        disputePolicy: {
          description: 'False disputes may result in warnings or restrictions',
          submissionWindow: '3 days after job completion',
          resolutionTime: '5 business days for admin review',
          falseDespute: 'Multiple false disputes may result in warnings or restrictions'
        },
        reviewAbusePolicy: {
          description: 'Vindictive or false reviews may be removed or reported',
          reportProcess: 'Click "Report Review" on any review you believe is false',
          adminAction: 'Admins can remove, hide, or flag reviews for abuse'
        },
        appeals: {
          description: 'If you believe a restriction is unfair, you can appeal',
          window: '30 days from restriction date',
          process: 'Submit your appeal with evidence of why the restriction should be lifted',
          responseTime: '5-10 business days'
        }
      }
    });
  } catch (err) {
    logger.error('Error fetching enforcement policy', { error: err.message });
    res.status(500).json({ success: false, error: 'Failed to fetch policy' });
  }
};

/**
 * Authenticated endpoint: Check user's current enforcement status
 * GET /api/my-enforcement-status
 *
 * Returns user's current stats vs. thresholds
 */
exports.getMyEnforcementStatus = async (req, res, next) => {
  try {
    const userId = req.user.id;

    // Get user's reputation
    const { rows: repRows } = await pool.query(`
      SELECT
        user_id,
        total_jobs,
        cancelled_jobs,
        cancellation_rate,
        reliability_score,
        caution_level,
        last_calculated_at
      FROM user_reputation_scores
      WHERE user_id = $1
    `, [userId]);

    const reputation = repRows.length > 0 ? repRows[0] : {
      total_jobs: 0,
      cancelled_jobs: 0,
      cancellation_rate: 0,
      reliability_score: 100,
      caution_level: 'none'
    };

    // Get active enforcement actions
    const { rows: enforcementRows } = await pool.query(`
      SELECT
        id,
        action_type,
        reason,
        description,
        restrictions,
        effective_at,
        expires_at,
        is_active
      FROM enforcement_actions
      WHERE user_id = $1 AND is_active = true
      ORDER BY created_at DESC
    `, [userId]);

    // Determine warning status
    let warningStatus = 'clear';
    let nextThreshold = null;

    if (reputation.cancellation_rate > 50) {
      warningStatus = 'restricted';
    } else if (reputation.cancellation_rate > 25) {
      warningStatus = 'caution';
      nextThreshold = {
        threshold: 50,
        current: reputation.cancellation_rate,
        message: 'If you reach 50% cancellations, you may face restrictions'
      };
    } else if (reputation.cancellation_rate > 5) {
      warningStatus = 'watch';
      nextThreshold = {
        threshold: 25,
        current: reputation.cancellation_rate,
        message: 'You are approaching a caution level'
      };
    }

    res.json({
      success: true,
      data: {
        userId,
        overallStatus: warningStatus,
        reputation: {
          totalJobs: reputation.total_jobs,
          cancelledJobs: reputation.cancelled_jobs,
          cancellationRate: `${reputation.cancellation_rate}%`,
          reliabilityScore: reputation.reliability_score,
          cautionLevel: reputation.caution_level,
          lastCalculated: reputation.last_calculated_at
        },
        nextThreshold,
        activeRestrictions: enforcementRows.map(row => ({
          id: row.id,
          type: row.action_type,
          reason: row.reason,
          description: row.description,
          restrictions: row.restrictions,
          effectiveAt: row.effective_at,
          expiresAt: row.expires_at,
          canAppeal: row.expires_at == null || new Date(row.expires_at) > new Date()
        })),
        recommendations: warningStatus === 'restricted' ?
          ['Your account is restricted. Consider appealing this decision if you believe it is unfair.'] :
          warningStatus === 'caution' ?
          ['Your cancellation rate is high. Try to complete more jobs to improve your standing.'] :
          []
      }
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Submit an appeal of an enforcement restriction
 * POST /api/enforcement-appeals
 *
 * Body:
 * {
 *   enforcementId: enforcement_actions.id,
 *   appeal Text: 'Why this restriction is unfair...',
 *   evidence: [
 *     { type: 'text', content: '...' },
 *     { type: 'document_url', url: '...' }
 *   ]
 * }
 */
exports.submitAppeal = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { enforcementId, appealText, evidence = [] } = req.body;

    if (!appealText || appealText.trim().length < 50) {
      throw new AppError('Appeal must be at least 50 characters', 400, 'validation_failed', {
        appealText: 'Please provide a detailed explanation'
      });
    }

    // Verify enforcement action exists and belongs to user
    const { rows: enfRows } = await pool.query(`
      SELECT id, action_type, reason, expires_at
      FROM enforcement_actions
      WHERE id = $1 AND user_id = $2
    `, [enforcementId, userId]);

    if (!enfRows.length) {
      throw new AppError('Enforcement action not found', 404, 'enforcement_not_found');
    }

    const enforcement = enfRows[0];

    // Check if already appealed (prevent duplicate appeals)
    const { rows: existingAppeal } = await pool.query(`
      SELECT id FROM enforcement_appeals
      WHERE enforcement_id = $1 AND status IN ('pending', 'under_review')
    `, [enforcementId]);

    if (existingAppeal.length > 0) {
      throw new AppError('You already have a pending appeal for this restriction', 409, 'appeal_exists');
    }

    // Create appeal
    const { rows: appealRows } = await pool.query(`
      INSERT INTO enforcement_appeals (
        enforcement_id, user_id, appeal_text, evidence, status, submitted_at, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, 'pending', NOW(), NOW(), NOW())
      RETURNING *
    `, [enforcementId, userId, appealText.trim(), JSON.stringify(evidence)]);

    const appeal = appealRows[0];

    // Notify admins
    try {
      const { rows: adminRows } = await pool.query(`
        SELECT id FROM users
        WHERE role IN ('admin', 'super_admin') AND is_active = true
        LIMIT 5
      `);

      const { sendNotification } = require('../services/notificationService');

      await Promise.allSettled(
        adminRows.map(admin =>
          sendNotification({
            userId: admin.id,
            type: 'enforcement_appeal_submitted',
            title: 'New Enforcement Appeal',
            body: `${req.user.first_name} ${req.user.last_name} has appealed their ${enforcement.action_type} restriction`,
            data: { appealId: appeal.id, enforcementId },
            action_url: `/admin/enforcement-appeals/${appeal.id}`
          })
        )
      );
    } catch (notifyErr) {
      logger.warn('Failed to notify admins of appeal', { appealId: appeal.id, error: notifyErr.message });
    }

    res.status(201).json({
      success: true,
      data: appeal,
      message: 'Appeal submitted. Admin review typically takes 5-10 business days.'
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Get user's appeals
 * GET /api/my-enforcement-appeals
 */
exports.getMyAppeals = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const { rows: appeals } = await pool.query(`
      SELECT
        a.*,
        e.action_type,
        e.reason,
        u_admin.first_name || ' ' || u_admin.last_name AS reviewed_by_name
      FROM enforcement_appeals a
      JOIN enforcement_actions e ON a.enforcement_id = e.id
      LEFT JOIN users u_admin ON a.reviewed_by = u_admin.id
      WHERE a.user_id = $1
      ORDER BY a.submitted_at DESC
    `, [userId]);

    res.json({
      success: true,
      data: appeals.map(appeal => ({
        ...appeal,
        canResubmit: appeal.status === 'denied' &&
          (Date.now() - new Date(appeal.reviewed_at)) > (30 * 24 * 60 * 60 * 1000) // 30 days
      }))
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Admin endpoint: Review and respond to an appeal
 * PUT /api/admin/enforcement-appeals/:appealId/review
 *
 * Body:
 * {
 *   decision: 'approved' | 'denied',
 *   adminNotes: 'Explanation...',
 *   actionIfApproved: 'lift_restriction' (will deactivate enforcement_action)
 * }
 */
exports.reviewAppeal = async (req, res, next) => {
  try {
    const { appealId } = req.params;
    const { decision, adminNotes } = req.body;

    if (!['approved', 'denied'].includes(decision)) {
      throw new AppError('Decision must be approved or denied', 400, 'validation_failed');
    }

    // Review in transaction
    const result = await withTransaction(pool, async (client) => {
      // Fetch and lock appeal
      const { rows: appealRows } = await client.query(`
        SELECT * FROM enforcement_appeals WHERE id = $1 FOR UPDATE
      `, [appealId]);

      if (!appealRows.length) {
        throw new AppError('Appeal not found', 404, 'appeal_not_found');
      }

      const appeal = appealRows[0];

      // Update appeal
      const { rows: updatedAppealRows } = await client.query(`
        UPDATE enforcement_appeals
        SET
          status = $1,
          admin_notes = $2,
          reviewed_by = $3,
          reviewed_at = NOW(),
          updated_at = NOW()
        WHERE id = $4
        RETURNING *
      `, [decision === 'approved' ? 'approved' : 'denied', adminNotes || null, req.user.id, appealId]);

      const updatedAppeal = updatedAppealRows[0];

      // If approved, lift the restriction
      if (decision === 'approved') {
        await client.query(`
          UPDATE enforcement_actions
          SET is_active = false, updated_at = NOW()
          WHERE id = $1
        `, [appeal.enforcement_id]);

        logger.info('Enforcement restriction lifted via appeal', {
          appealId,
          enforcementId: appeal.enforcement_id,
          userId: appeal.user_id
        });
      }

      return updatedAppeal;
    }, 'review_appeal');

    // Notify user of decision
    try {
      const { sendNotification } = require('../services/notificationService');
      const message = decision === 'approved' ?
        'Your appeal has been approved. Your restriction has been lifted.' :
        'Your appeal has been reviewed. Your restriction remains in effect. You can resubmit in 30 days.';

      await sendNotification({
        userId: result.user_id,
        type: 'enforcement_appeal_decision',
        title: `Your appeal has been ${decision}`,
        body: message,
        data: { appealId },
        action_url: '/my-enforcement-status'
      });
    } catch (notifyErr) {
      logger.warn('Failed to notify appeal decision', { appealId, error: notifyErr.message });
    }

    res.json({
      success: true,
      data: result,
      message: `Appeal ${decision}`
    });
  } catch (err) {
    next(err);
  }
};
