/**
 * reputationController.js
 * Manages user reputation scores and visibility
 */

const pool = require('../db');
const { AppError } = require('../utils/apiError');
const logger = require('../utils/logger');
const { resolvePublicDisplayName } = require('../utils/publicDisplayName');

/**
 * Get user reputation score (public - for profile display)
 * GET /api/reputation/:userId
 */
/**
 * Public reputation summary for one user (no fee history). Shared by
 * GET /api/reputation/:userId and the business-scoped
 * GET /api/businesses/:id/reputation (which omits the owner's user id).
 */
async function loadReputationSummary(userId) {
  const result = await pool.query(
    `SELECT
      user_id,
      total_jobs,
      completed_jobs,
      cancelled_jobs,
      cancellation_rate,
      cancelled_24h_or_less,
      cancelled_24h_to_3d,
      cancelled_3d_plus,
      reliability_score,
      caution_level,
      last_calculated_at
    FROM user_reputation_scores
    WHERE user_id = $1`,
    [userId]
  );

  if (!result.rows.length) {
    return {
      userId,
      totalJobs: 0,
      completedJobs: 0,
      cancelledJobs: 0,
      cancellationRate: 0,
      reliabilityScore: 100,
      cautionLevel: 'none',
      lastCalculatedAt: null
    };
  }

  const rep = result.rows[0];
  return {
    userId: rep.user_id,
    totalJobs: rep.total_jobs,
    completedJobs: rep.completed_jobs,
    cancelledJobs: rep.cancelled_jobs,
    cancellationRate: rep.cancellation_rate,
    cancellationPattern: {
      lessThan24h: rep.cancelled_24h_or_less,
      from24hTo3d: rep.cancelled_24h_to_3d,
      threeDaysPlus: rep.cancelled_3d_plus
    },
    reliabilityScore: rep.reliability_score,
    cautionLevel: rep.caution_level,  // 'none', 'caution', 'restricted'
    lastCalculatedAt: rep.last_calculated_at
  };
}

async function getUserReputation(req, res) {
  try {
    const { userId } = req.params;
    const data = await loadReputationSummary(userId);
    res.json({ success: true, data });
  } catch (err) {
    logger.error('Error fetching user reputation', { error: err.message, userId: req.params.userId });
    res.status(500).json({ success: false, error: 'Failed to fetch reputation' });
  }
}

/**
 * Recalculate reputation for a user (admin/system)
 * POST /api/reputation/:userId/recalculate
 */
async function recalculateReputation(req, res) {
  try {
    const { userId } = req.params;

    // Verify user exists
    const userResult = await pool.query('SELECT id FROM users WHERE id = $1', [userId]);
    if (!userResult.rows.length) {
      throw new AppError('User not found', 404, 'USER_NOT_FOUND');
    }

    // Call the PL/pgSQL function
    await pool.query('SELECT update_user_reputation_scores($1)', [userId]);

    logger.info('Reputation recalculated', { userId });
    res.json({ success: true, message: 'Reputation recalculated' });
  } catch (err) {
    logger.error('Error recalculating reputation', { error: err.message, userId: req.params.userId });
    if (err instanceof AppError) {
      return res.status(err.statusCode).json({ success: false, error: err.message });
    }
    res.status(500).json({ success: false, error: 'Failed to recalculate reputation' });
  }
}

/**
 * Get enforcement actions for a user (admin/user self)
 * GET /api/reputation/:userId/enforcement
 */
async function getEnforcementActions(req, res) {
  try {
    const { userId } = req.params;

    // Check auth: only admins or the user themselves
    if (req.user.id !== userId && req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      throw new AppError('Unauthorized', 403, 'FORBIDDEN');
    }

    const result = await pool.query(
      `SELECT
        id,
        user_id,
        action_type,
        reason,
        description,
        restrictions,
        effective_at,
        expires_at,
        is_active
      FROM enforcement_actions
      WHERE user_id = $1
      ORDER BY created_at DESC`,
      [userId]
    );

    res.json({
      success: true,
      data: result.rows.map(row => ({
        id: row.id,
        userId: row.user_id,
        actionType: row.action_type,
        reason: row.reason,
        description: row.description,
        restrictions: row.restrictions,
        effectiveAt: row.effective_at,
        expiresAt: row.expires_at,
        isActive: row.is_active
      }))
    });
  } catch (err) {
    logger.error('Error fetching enforcement actions', { error: err.message, userId: req.params.userId });
    if (err instanceof AppError) {
      return res.status(err.statusCode).json({ success: false, error: err.message });
    }
    res.status(500).json({ success: false, error: 'Failed to fetch enforcement actions' });
  }
}

/**
 * Check if user has active restrictions
 * GET /api/reputation/:userId/check-restrictions
 */
async function checkRestrictions(req, res) {
  try {
    const { userId } = req.params;

    const result = await pool.query(
      `SELECT
        action_type,
        restrictions,
        expires_at
      FROM enforcement_actions
      WHERE user_id = $1 AND is_active = true AND (expires_at IS NULL OR expires_at > NOW())
      ORDER BY created_at DESC`,
      [userId]
    );

    const restrictions = {};
    result.rows.forEach(row => {
      const restr = row.restrictions || {};
      Object.assign(restrictions, restr);
    });

    res.json({
      success: true,
      data: {
        userId,
        hasRestrictions: result.rows.length > 0,
        restrictions,
        activeEnforcementCount: result.rows.length
      }
    });
  } catch (err) {
    logger.error('Error checking restrictions', { error: err.message, userId: req.params.userId });
    res.status(500).json({ success: false, error: 'Failed to check restrictions' });
  }
}

/**
 * Get cancellation fee history for a user (customer view)
 * GET /api/reputation/:userId/fee-history
 *
 * Returns:
 *   total_fees_paid_cents, cancellation_count, avg_days_before_start,
 *   recent_fees: [{ date, amount_cents, job_title, helper_name }]
 */
async function getFeeHistory(req, res) {
  try {
    const { userId } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);

    // Verify user exists
    const userCheck = await pool.query('SELECT id FROM users WHERE id = $1', [userId]);
    if (!userCheck.rows.length) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    // Aggregate stats
    const statsResult = await pool.query(
      `SELECT
        COUNT(*)                          AS cancellation_count,
        COALESCE(SUM(gross_fee_cents), 0) AS total_fees_paid_cents,
        ROUND(AVG(
          EXTRACT(EPOCH FROM (NOW() - cf.created_at)) / 86400
        ), 1)                             AS avg_days_since_fee
       FROM cancellation_fees cf
       WHERE cf.payer_id = $1
         AND cf.status IN ('collected','pending')`,
      [userId]
    );

    // Recent fees with job + helper info
    const recentResult = await pool.query(
      `SELECT
        cf.id,
        cf.gross_fee_cents   AS amount_cents,
        cf.status,
        cf.created_at        AS date,
        j.title              AS job_title,
        j.scheduled_date,
        cal.hours_before_start,
        u.first_name,
        u.last_name,
        u.display_name_preference,
        pb.business_name     AS primary_business_name,
        u.profile_photo_url  AS helper_avatar
       FROM cancellation_fees cf
       JOIN jobs j  ON j.id  = cf.job_id
       JOIN users u ON u.id  = cf.payee_id
       LEFT JOIN businesses pb ON pb.user_id = u.id AND pb.is_primary = TRUE AND pb.is_active = TRUE
       LEFT JOIN cancellation_audit_log cal ON cal.id = cf.audit_log_id
       WHERE cf.payer_id = $1
         AND cf.status IN ('collected','pending','failed')
       ORDER BY cf.created_at DESC
       LIMIT $2`,
      [userId, limit]
    );

    const stats = statsResult.rows[0];

    res.json({
      success: true,
      data: {
        userId,
        totalFeesPaidCents: parseInt(stats.total_fees_paid_cents) || 0,
        cancellationCount:  parseInt(stats.cancellation_count) || 0,
        recentFees: recentResult.rows.map(row => ({
          id:              row.id,
          date:            row.date,
          amountCents:     row.amount_cents,
          status:          row.status,
          jobTitle:        row.job_title,
          scheduledDate:   row.scheduled_date,
          hoursBeforeStart: row.hours_before_start ? parseFloat(row.hours_before_start) : null,
          helperName:      resolvePublicDisplayName(row),
          helperAvatar:    row.helper_avatar
        }))
      }
    });
  } catch (err) {
    logger.error('Error fetching fee history', { error: err.message, userId: req.params.userId });
    res.status(500).json({ success: false, error: 'Failed to fetch fee history' });
  }
}

/**
 * Exposed helper: recalculate a single user's reputation (called fire-and-forget from jobController)
 */
async function recalculateUserReputation(userId) {
  try {
    const result = await pool.query(
      `SELECT
        COUNT(*)                                    AS total_jobs,
        COUNT(*) FILTER (WHERE status='completed')  AS completed_jobs,
        COUNT(*) FILTER (WHERE status='cancelled')  AS cancelled_jobs
       FROM jobs
       WHERE (client_id = $1 OR assigned_helper_id = $1)
         AND deleted_at IS NULL`,
      [userId]
    );
    const row = result.rows[0];
    const total     = parseInt(row.total_jobs) || 0;
    const completed = parseInt(row.completed_jobs) || 0;
    const cancelled = parseInt(row.cancelled_jobs) || 0;
    const rate      = total > 0 ? parseFloat(((cancelled / total) * 100).toFixed(2)) : 0;
    const score     = Math.max(0, Math.round(100 - rate * 2));
    const level     = rate <= 5 ? 'none' : rate <= 15 ? 'caution' : 'restricted';

    await pool.query(
      `INSERT INTO user_reputation_scores
        (user_id, total_jobs, completed_jobs, cancelled_jobs, cancellation_rate,
         reliability_score, caution_level, last_calculated_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         total_jobs         = EXCLUDED.total_jobs,
         completed_jobs     = EXCLUDED.completed_jobs,
         cancelled_jobs     = EXCLUDED.cancelled_jobs,
         cancellation_rate  = EXCLUDED.cancellation_rate,
         reliability_score  = EXCLUDED.reliability_score,
         caution_level      = EXCLUDED.caution_level,
         last_calculated_at = NOW(),
         updated_at         = NOW()`,
      [userId, total, completed, cancelled, rate, score, level]
    );
  } catch (err) {
    logger.warn('Failed to recalculate user reputation', { userId, error: err.message });
  }
}

/**
 * Get customer reliability stats (for helpers to see before bidding)
 * GET /api/customers/:userId/reliability
 *
 * Returns completion rate, cancellation rate, and cancellation patterns
 * Visible to ALL helpers (public information)
 */
async function getCustomerReliability(req, res) {
  try {
    const { userId } = req.params;

    // Verify user exists and is a customer (or can still be reviewed)
    const userCheck = await pool.query(
      `SELECT id, first_name, last_name, profile_photo_url
       FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [userId]
    );
    if (!userCheck.rows.length) {
      return res.status(404).json({ success: false, error: 'Customer not found' });
    }

    const user = userCheck.rows[0];

    // Get customer's job stats
    const statsResult = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status IN ('completed','closed'))   AS completed_count,
        COUNT(*) FILTER (WHERE status = 'cancelled')                AS cancelled_count,
        COUNT(*) FILTER (WHERE status IN ('completed','closed','cancelled','in_progress')) AS total_count,
        COUNT(*) FILTER (WHERE status = 'cancelled' AND
                               EXTRACT(EPOCH FROM (scheduled_date - NOW())) / 3600 < 24) AS cancelled_within_24h,
        COUNT(*) FILTER (WHERE status = 'cancelled' AND
                               EXTRACT(EPOCH FROM (scheduled_date - NOW())) / 3600 BETWEEN 24 AND 168) AS cancelled_1_to_7d,
        COUNT(*) FILTER (WHERE status = 'cancelled' AND
                               EXTRACT(EPOCH FROM (scheduled_date - NOW())) / 3600 > 168) AS cancelled_7d_plus
      FROM jobs
      WHERE client_id = $1 AND deleted_at IS NULL
    `, [userId]);

    const stats = statsResult.rows[0];
    const totalCount = parseInt(stats.total_count) || 0;
    const completedCount = parseInt(stats.completed_count) || 0;
    const cancelledCount = parseInt(stats.cancelled_count) || 0;
    const completionRate = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
    const cancellationRate = totalCount > 0 ? Math.round((cancelledCount / totalCount) * 100) : 0;

    // Determine reliability level
    let reliabilityLevel = 'excellent';
    if (cancellationRate > 50) reliabilityLevel = 'risky';
    else if (cancellationRate > 25) reliabilityLevel = 'caution';
    else if (cancellationRate > 5) reliabilityLevel = 'fair';

    // Get recent 5 cancellations for pattern analysis
    const recentCancellationsResult = await pool.query(`
      SELECT
        id,
        title,
        scheduled_date,
        cancelled_at,
        EXTRACT(EPOCH FROM (scheduled_date - cancelled_at)) / 3600 AS hours_before_cancellation
      FROM jobs
      WHERE client_id = $1 AND status = 'cancelled' AND deleted_at IS NULL
      ORDER BY cancelled_at DESC
      LIMIT 5
    `, [userId]);

    res.json({
      success: true,
      data: {
        userId,
        name: `${user.first_name} ${user.last_name}`,
        avatar: user.profile_photo_url,
        totalJobsPosted: totalCount,
        completedJobs: completedCount,
        cancelledJobs: cancelledCount,
        completionRate,
        cancellationRate,
        reliabilityLevel,
        cancellationPattern: {
          within24h: parseInt(stats.cancelled_within_24h) || 0,
          oneToSevenDays: parseInt(stats.cancelled_1_to_7d) || 0,
          sevenDaysPlus: parseInt(stats.cancelled_7d_plus) || 0
        },
        recentCancellations: recentCancellationsResult.rows.map(row => ({
          jobTitle: row.title,
          scheduledDate: row.scheduled_date,
          cancelledAt: row.cancelled_at,
          hoursBeforeScheduledStart: row.hours_before_cancellation ?
            parseFloat(row.hours_before_cancellation).toFixed(1) : null
        })),
        // Helper context
        message: cancellationRate > 25 ? 'This customer has a notable cancellation history. Consider asking clarifying questions before bidding.' :
                 cancellationRate > 5 ? 'This customer occasionally cancels. Review their job details carefully.' :
                 'This customer has a solid track record.'
      }
    });
  } catch (err) {
    logger.error('Error fetching customer reliability', { error: err.message, userId: req.params.userId });
    res.status(500).json({ success: false, error: 'Failed to fetch customer reliability' });
  }
}

module.exports = {
  getUserReputation,
  loadReputationSummary,
  recalculateReputation,
  getEnforcementActions,
  checkRestrictions,
  getFeeHistory,
  getCustomerReliability,
  recalculateUserReputation
};
