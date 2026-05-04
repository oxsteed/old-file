const pool = require('../db');
const logger = require('../utils/logger');
const AppError = require('../utils/apiError').AppError;

/**
 * Get cancellation statistics for a customer (job poster)
 * Shows: total cancellations, rate, patterns, timing
 * Visible to: helpers bidding on jobs, public (filtered)
 */
exports.getCustomerCancellationStats = async (req, res, next) => {
  try {
    const { userId } = req.params;

    const result = await pool.query(
      `
        SELECT
          client_id,
          cancellations_total,
          cancellations_6m,
          total_jobs_posted,
          jobs_posted_6m,
          cancellation_rate_percent,
          cancellation_rate_6m_percent,
          avg_days_before_cancel,
          first_job_posted,
          last_job_posted,
          last_cancellation,
          cancellations_within_24h_of_start,
          cancellations_1_to_7_days_before,
          cancellations_7plus_days_before,
          CASE
            WHEN cancellations_total = 0 THEN 'reliable'
            WHEN cancellation_rate_percent < 5 THEN 'reliable'
            WHEN cancellation_rate_percent < 15 THEN 'caution'
            WHEN cancellation_rate_percent < 30 THEN 'warning'
            ELSE 'high_risk'
          END as reliability_score
        FROM customer_cancellation_stats
        WHERE client_id = $1
      `,
      [userId]
    );

    if (result.rows.length === 0) {
      // New user with no job history
      return res.json({
        success: true,
        data: {
          client_id: userId,
          cancellations_total: 0,
          cancellations_6m: 0,
          total_jobs_posted: 0,
          jobs_posted_6m: 0,
          cancellation_rate_percent: 0,
          cancellation_rate_6m_percent: 0,
          avg_days_before_cancel: null,
          first_job_posted: null,
          last_job_posted: null,
          last_cancellation: null,
          cancellations_within_24h_of_start: 0,
          cancellations_1_to_7_days_before: 0,
          cancellations_7plus_days_before: 0,
          reliability_score: 'new_user'
        }
      });
    }

    const stats = result.rows[0];

    // Determine cancellation pattern
    const total_cancellations = stats.cancellations_total || 0;
    let pattern = 'no_cancellations';
    if (total_cancellations > 0) {
      const within_24h = stats.cancellations_within_24h_of_start || 0;
      const ratio_24h = within_24h / total_cancellations;

      if (ratio_24h > 0.7) {
        pattern = 'cancels_close_to_start';
      } else if (stats.avg_days_before_cancel < 3) {
        pattern = 'cancels_shortly_before';
      } else if (stats.avg_days_before_cancel > 14) {
        pattern = 'cancels_far_in_advance';
      } else {
        pattern = 'variable_timing';
      }
    }

    res.json({
      success: true,
      data: {
        ...stats,
        cancellation_pattern: pattern,
        risk_level: calculateRiskLevel(stats)
      }
    });
  } catch (error) {
    logger.error('Error fetching customer cancellation stats', {
      userId: req.params.userId,
      error: error.message
    });
    next(error);
  }
};

/**
 * Get cancellation statistics for a helper (of accepted jobs)
 * Shows: accepted job cancellations, reliability
 * Visible to: customers considering this helper
 */
exports.getHelperCancellationStats = async (req, res, next) => {
  try {
    const { userId } = req.params;

    const result = await pool.query(
      `
        SELECT
          assigned_helper_id,
          accepted_job_cancellations,
          accepted_job_cancellations_6m,
          total_jobs_accepted,
          jobs_accepted_6m,
          accepted_job_cancellation_rate,
          avg_days_from_acceptance_to_cancel,
          last_cancellation,
          CASE
            WHEN accepted_job_cancellations = 0 THEN 'reliable'
            WHEN accepted_job_cancellation_rate < 5 THEN 'reliable'
            WHEN accepted_job_cancellation_rate < 15 THEN 'caution'
            WHEN accepted_job_cancellation_rate < 30 THEN 'warning'
            ELSE 'high_risk'
          END as reliability_score
        FROM helper_cancellation_stats
        WHERE assigned_helper_id = $1
      `,
      [userId]
    );

    if (result.rows.length === 0) {
      // New helper with no accepted jobs
      return res.json({
        success: true,
        data: {
          assigned_helper_id: userId,
          accepted_job_cancellations: 0,
          accepted_job_cancellations_6m: 0,
          total_jobs_accepted: 0,
          jobs_accepted_6m: 0,
          accepted_job_cancellation_rate: 0,
          avg_days_from_acceptance_to_cancel: null,
          last_cancellation: null,
          reliability_score: 'new_helper'
        }
      });
    }

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    logger.error('Error fetching helper cancellation stats', {
      userId: req.params.userId,
      error: error.message
    });
    next(error);
  }
};

/**
 * Get simplified cancellation summary for quick display
 * Used when showing customer risk level on bid form
 */
exports.getCustomerCancellationSummary = async (req, res, next) => {
  try {
    const { userId } = req.params;

    const result = await pool.query(
      `
        SELECT
          client_id,
          cancellations_total,
          total_jobs_posted,
          cancellation_rate_percent,
          avg_days_before_cancel,
          CASE
            WHEN cancellations_total = 0 THEN 'reliable'
            WHEN cancellation_rate_percent < 5 THEN 'reliable'
            WHEN cancellation_rate_percent < 15 THEN 'caution'
            WHEN cancellation_rate_percent < 30 THEN 'warning'
            ELSE 'high_risk'
          END as reliability_score
        FROM customer_cancellation_stats
        WHERE client_id = $1
      `,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.json({
        success: true,
        data: {
          reliability_score: 'new_user',
          message: 'New customer with no job history'
        }
      });
    }

    const stats = result.rows[0];
    const riskLevel = stats.reliability_score;
    let message = '';

    if (riskLevel === 'reliable') {
      message = `This customer has posted ${stats.total_jobs_posted} jobs with no cancellations.`;
    } else if (riskLevel === 'caution') {
      message = `This customer has cancelled ${stats.cancellation_rate_percent}% of their ${stats.total_jobs_posted} jobs (${stats.cancellations_total} cancellations).`;
    } else if (riskLevel === 'warning') {
      message = `⚠️ This customer has cancelled ${stats.cancellation_rate_percent}% of their jobs. Consider pricing accordingly.`;
    } else {
      message = `🚨 High cancellation rate (${stats.cancellation_rate_percent}%). This customer frequently cancels.`;
    }

    res.json({
      success: true,
      data: {
        reliability_score: riskLevel,
        cancellation_rate: stats.cancellation_rate_percent,
        message,
        cancellations_total: stats.cancellations_total,
        total_jobs_posted: stats.total_jobs_posted
      }
    });
  } catch (error) {
    logger.error('Error fetching customer cancellation summary', {
      userId: req.params.userId,
      error: error.message
    });
    next(error);
  }
};

/**
 * Calculate detailed risk level based on stats
 */
function calculateRiskLevel(stats) {
  const riskLevel = {
    score: 0,
    level: 'reliable',
    factors: []
  };

  if (!stats.total_jobs_posted) {
    return { ...riskLevel, level: 'new_user' };
  }

  // Factor 1: Cancellation rate
  const cancelRate = stats.cancellation_rate_percent || 0;
  if (cancelRate >= 30) {
    riskLevel.score += 3;
    riskLevel.factors.push(`High cancellation rate: ${cancelRate}%`);
  } else if (cancelRate >= 15) {
    riskLevel.score += 2;
    riskLevel.factors.push(`Moderate cancellation rate: ${cancelRate}%`);
  } else if (cancelRate > 0) {
    riskLevel.score += 1;
    riskLevel.factors.push(`Some cancellations: ${cancelRate}%`);
  }

  // Factor 2: Last-minute cancellations (within 24h of scheduled start)
  const within24h = stats.cancellations_within_24h_of_start || 0;
  if (within24h > 0) {
    const ratio = within24h / (stats.cancellations_total || 1);
    if (ratio > 0.5) {
      riskLevel.score += 2;
      riskLevel.factors.push('Frequently cancels close to scheduled start time');
    } else {
      riskLevel.score += 1;
      riskLevel.factors.push('Some last-minute cancellations');
    }
  }

  // Factor 3: Recency
  if (stats.last_cancellation) {
    const daysSinceLastCancel = (Date.now() - new Date(stats.last_cancellation).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceLastCancel < 30) {
      riskLevel.score += 1;
      riskLevel.factors.push('Recent cancellation');
    }
  }

  // Determine level
  if (stats.cancellations_total === 0) {
    riskLevel.level = 'reliable';
  } else if (riskLevel.score <= 1) {
    riskLevel.level = 'reliable';
  } else if (riskLevel.score <= 2) {
    riskLevel.level = 'caution';
  } else if (riskLevel.score <= 3) {
    riskLevel.level = 'warning';
  } else {
    riskLevel.level = 'high_risk';
  }

  return riskLevel;
}

/**
 * Refresh materialized views (called by cron job or manual trigger)
 */
exports.refreshCancellationStats = async (req, res, next) => {
  try {
    // Require admin or system token
    if (!req.user || (req.user.role !== 'admin' && !req.headers['x-system-token'])) {
      throw new AppError('Unauthorized', 403);
    }

    const client = await pool.connect();
    try {
      await client.query('REFRESH MATERIALIZED VIEW CONCURRENTLY customer_cancellation_stats');
      logger.info('Refreshed customer_cancellation_stats');

      await client.query('REFRESH MATERIALIZED VIEW CONCURRENTLY helper_cancellation_stats');
      logger.info('Refreshed helper_cancellation_stats');

      // Update refresh log
      await client.query(
        `UPDATE mv_refresh_log SET last_refreshed_at = NOW(), next_refresh_at = NOW() + interval '1 hour'
         WHERE view_name IN ('customer_cancellation_stats', 'helper_cancellation_stats')`
      );

      res.json({
        success: true,
        message: 'Materialized views refreshed successfully'
      });
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error('Error refreshing cancellation stats', {
      error: error.message
    });
    next(error);
  }
};
