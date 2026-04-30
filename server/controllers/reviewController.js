const db            = require('../db');
const logger        = require('../utils/logger');
const { sendNotification } = require('../services/notificationService');
const { AppError } = require('../middleware/errorHandler');

// ─── SUBMIT REVIEW ────────────────────────────────────────────
exports.submitReview = async (req, res, next) => {
  let dbClient;
  try {
    dbClient = await db.connect();
  } catch (connErr) {
    logger.error('submitReview: DB connection failed', { message: connErr.message });
    throw new AppError('Database unavailable', 503, 'database_error');
  }

  try {
    await dbClient.query('BEGIN');

    const reviewerId  = req.user.id;
    const { jobId }   = req.params;
    const { rating, title, body } = req.body;

    // Validate rating
    if (!rating || rating < 1 || rating > 5) {
      throw new AppError('Rating must be between 1 and 5', 400, 'validation_failed', { rating: 'Rating must be between 1 and 5' });
    }

    // Get job — verify reviewer was involved
    const { rows: jobRows } = await dbClient.query(`
      SELECT j.*,
             u_c.first_name AS client_first,
             u_h.first_name AS helper_first
      FROM jobs j
      JOIN users u_c ON j.client_id = u_c.id
      LEFT JOIN users u_h ON j.assigned_helper_id = u_h.id
      WHERE j.id = $1
        AND j.status IN ('completed', 'closed')
        AND (j.client_id = $2 OR j.assigned_helper_id = $2)
    `, [jobId, reviewerId]);

    if (!jobRows.length) {
      throw new AppError('Can only review completed and closed jobs you were part of', 403, 'forbidden');
    }

    const job = jobRows[0];

    // Determine reviewer role and reviewee
    const isClient    = job.client_id === reviewerId;
    const revieweeId  = isClient ? job.assigned_helper_id : job.client_id;

    if (!revieweeId) {
      throw new AppError('No reviewee found for this job', 400, 'invalid_job_state');
    }

    // Combine title and body into comment field (DB has 'comment', not 'title'/'body')
    const comment = title ? `${title}: ${body || ''}` : (body || '');

    // Insert review
    const { rows } = await dbClient.query(`
      INSERT INTO reviews
        (job_id, reviewer_id, reviewee_id, rating, comment)
      VALUES ($1,$2,$3,$4,$5)
      RETURNING *
    `, [jobId, reviewerId, revieweeId, rating, comment]);

    const review = rows[0];

    // Update helper's avg_rating if helper was reviewed
    if (isClient) {
      await dbClient.query(`
        UPDATE helper_profiles
        SET avg_rating = (
              SELECT ROUND(AVG(rating)::numeric, 2)
              FROM reviews
              WHERE reviewee_id = $1
                AND is_public = true
            ),
            total_reviews = (
              SELECT COUNT(*)
              FROM reviews
              WHERE reviewee_id = $1
                AND is_public = true
            ),
            updated_at = now()
        WHERE user_id = $1
      `, [revieweeId]);
    }

    await dbClient.query('COMMIT');

    // Notify reviewee
    const reviewerName = isClient
      ? job.client_first
      : job.helper_first;

    await sendNotification({
      userId:     revieweeId,
      type:       'new_review',
      title:      'You received a new review',
      body:       `${reviewerName} left you a ${rating}-star review.`,
      data:       { jobId, reviewId: review.id },
      action_url: `/profile#reviews`
    });

    res.status(201).json({ review });
  } catch (err) {
    try { await dbClient.query('ROLLBACK'); } catch (_) {}
    if (err.code === '23505') {
      next(new AppError('You have already reviewed this job', 409, 'already_exists'));
    } else {
      next(err);
    }
  } finally {
    if (dbClient) dbClient.release();
  }
};

// ─── GET REVIEWS FOR A USER ───────────────────────────────────
exports.getUserReviews = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    let condition = `WHERE r.reviewee_id = $1 AND r.is_public = true`;
    const params = [userId];
    let paramIdx = 2;

    const { rows } = await db.query(`
      SELECT
        r.*,
        u.first_name || ' ' || u.last_name AS reviewer_name,
        j.title AS job_title
      FROM reviews r
      JOIN users u ON r.reviewer_id = u.id
      JOIN jobs  j ON r.job_id     = j.id
      ${condition}
      ORDER BY r.created_at DESC
      LIMIT $${paramIdx++} OFFSET $${paramIdx++}
    `, [...params, limit, offset]);

    const { rows: statsRows } = await db.query(`
      SELECT
        COUNT(*)                                    AS total_reviews,
        ROUND(AVG(rating)::numeric, 2)              AS average_rating,
        COUNT(*) FILTER (WHERE rating = 5)          AS five_star,
        COUNT(*) FILTER (WHERE rating = 4)          AS four_star,
        COUNT(*) FILTER (WHERE rating = 3)          AS three_star,
        COUNT(*) FILTER (WHERE rating = 2)          AS two_star,
        COUNT(*) FILTER (WHERE rating = 1)          AS one_star
      FROM reviews
      WHERE reviewee_id = $1
        AND is_public = true
    `, [userId]);

    res.json({
      reviews: rows,
      stats:   statsRows[0],
      page:    parseInt(page),
      limit:   parseInt(limit)
    });
  } catch (err) {
    next(err);
  }
};

// ─── CHECK REVIEW ELIGIBILITY ─────────────────────────────────
exports.getReviewEligibility = async (req, res, next) => {
  try {
    const userId  = req.user.id;
    const { jobId } = req.params;

    const { rows } = await db.query(`
      SELECT
        j.status,
        j.client_id,
        j.assigned_helper_id,
        EXISTS (
          SELECT 1 FROM reviews
          WHERE job_id = j.id
            AND reviewer_id = $2
        ) AS already_reviewed
      FROM jobs j
      WHERE j.id = $1
        AND (j.client_id = $2 OR j.assigned_helper_id = $2)
    `, [jobId, userId]);

    if (!rows.length) {
      throw new AppError('Job not found', 404, 'not_found');
    }

    const { status, already_reviewed } = rows[0];
    const eligible = (status === 'completed' || status === 'closed') && !already_reviewed;

    res.json({ eligible, already_reviewed, job_status: status });
  } catch (err) {
    next(err);
  }
};

// ─── ADMIN: HIDE REVIEW ───────────────────────────────────────
exports.adminHideReview = async (req, res, next) => {
  try {
    if (!['admin', 'super_admin'].includes(req.user.role)) {
      throw new AppError('Admin access required', 403, 'forbidden');
    }
    const adminId = req.user.id;
    const { id }  = req.params;
    const { reason } = req.body;

    const fields = {};
    if (!reason?.trim()) fields.reason = 'Hide reason required';
    if (Object.keys(fields).length) {
      throw new AppError('Validation failed', 400, 'validation_failed', fields);
    }

    const { rows } = await db.query(`
      UPDATE reviews
      SET is_public  = false,
          updated_at = now()
      WHERE id = $1
      RETURNING *
    `, [id]);

    if (!rows.length) {
      throw new AppError('Review not found', 404, 'not_found');
    }

    // Recalculate helper rating after hiding
    await db.query(`
      UPDATE helper_profiles
      SET avg_rating = (
            SELECT ROUND(AVG(rating)::numeric, 2)
            FROM reviews
            WHERE reviewee_id = $1 AND is_public = true
          ),
          total_reviews = (
            SELECT COUNT(*) FROM reviews
            WHERE reviewee_id = $1 AND is_public = true
          ),
          updated_at = now()
      WHERE user_id = $1
    `, [rows[0].reviewee_id]);

    const { logAdminAction } = require('../services/auditService');
    await logAdminAction({
      adminId,
      action:      'review_hidden',
      targetType:  'review',
      targetId:    id,
      description: reason,
      req
    });

    res.json({ message: 'Review hidden successfully.' });
  } catch (err) {
    next(err);
  }
};

// ─── RESPOND TO REVIEW ────────────────────────────────────────
exports.respondToReview = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { response } = req.body;

    const fields = {};
    if (!response?.trim()) fields.response = 'Response text is required';
    if (Object.keys(fields).length) {
      throw new AppError('Validation failed', 400, 'validation_failed', fields);
    }

    // Only the reviewee can respond
    const { rows } = await db.query(`
      UPDATE reviews
      SET response = $1,
          response_at = now(),
          updated_at = now()
      WHERE id = $2
        AND reviewee_id = $3
        AND response IS NULL
      RETURNING *
    `, [response.trim(), id, userId]);

    if (!rows.length) {
      throw new AppError('Review not found, you are not the reviewee, or already responded', 404, 'not_found');
    }

    res.json({ review: rows[0] });
  } catch (err) {
    next(err);
  }
};
