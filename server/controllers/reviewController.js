const db            = require('../db');
const { sendNotification } = require('../services/notificationService');

// ─── SUBMIT REVIEW ────────────────────────────────────────────
exports.submitReview = async (req, res) => {
  const dbClient = await db.connect();
  try {
    await dbClient.query('BEGIN');

    const reviewerId  = req.user.id;
    const { jobId }   = req.params;
    const { rating, title, body } = req.body;

    // Validate rating
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5.' });
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
        AND j.status = 'closed'
        AND (j.client_id = $2 OR j.assigned_helper_id = $2)
    `, [jobId, reviewerId]);

    if (!jobRows.length) {
      return res.status(403).json({
        error: 'Can only review completed and closed jobs you were part of.'
      });
    }

    const job = jobRows[0];

    // Determine reviewer role and reviewee
    const isClient    = job.client_id === reviewerId;
    const revieweeId  = isClient ? job.assigned_helper_id : job.client_id;

    if (!revieweeId) {
      return res.status(400).json({ error: 'No reviewee found for this job.' });
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
    await dbClient.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({
        error: 'You have already reviewed this job.'
      });
    }
    console.error('submitReview error:', err);
    res.status(500).json({ error: 'Failed to submit review.' });
  } finally {
    dbClient.release();
  }
};

// ─── GET REVIEWS FOR A USER ───────────────────────────────────
exports.getUserReviews = async (req, res) => {
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
    console.error('getUserReviews error:', err);
    res.status(500).json({ error: 'Failed to fetch reviews.' });
  }
};

// ─── CHECK REVIEW ELIGIBILITY ─────────────────────────────────
exports.getReviewEligibility = async (req, res) => {
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
      return res.status(404).json({ error: 'Job not found.' });
    }

    const { status, already_reviewed } = rows[0];
    const eligible = status === 'closed' && !already_reviewed;

    res.json({ eligible, already_reviewed, job_status: status });
  } catch (err) {
    console.error('getReviewEligibility error:', err);
    res.status(500).json({ error: 'Failed to check eligibility.' });
  }
};

// ─── ADMIN: HIDE REVIEW ───────────────────────────────────────
exports.adminHideReview = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { id }  = req.params;
    const { reason } = req.body;

    if (!reason?.trim()) {
      return res.status(400).json({ error: 'Hide reason required.' });
    }

    const { rows } = await db.query(`
      UPDATE reviews
      SET is_public  = false,
          updated_at = now()
      WHERE id = $1
      RETURNING *
    `, [id]);

    if (!rows.length) {
      return res.status(404).json({ error: 'Review not found.' });
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
    console.error('adminHideReview error:', err);
    res.status(500).json({ error: 'Failed to hide review.' });
  }
};

// ─── RESPOND TO REVIEW ────────────────────────────────────────
exports.respondToReview = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { response } = req.body;

    if (!response?.trim()) {
      return res.status(400).json({ error: 'Response text is required.' });
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
      return res.status(404).json({
        error: 'Review not found, you are not the reviewee, or already responded.'
      });
    }

    res.json({ review: rows[0] });
  } catch (err) {
    console.error('respondToReview error:', err);
    res.status(500).json({ error: 'Failed to respond to review.' });
  }
};
