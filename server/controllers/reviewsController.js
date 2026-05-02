const pool = require('../db');
const { sendError, sendSuccess } = require('../utils/apiError');
const logger = require('../utils/logger');

// ── Submit a review for a completed business lead ─────────────────────────────
exports.submitReview = async (req, res) => {
  try {
    const { businessId } = req.params;
    const { leadId, rating, testimonial } = req.body;
    const customerId = req.user.id;

    // Validate inputs
    if (!rating || !Number.isInteger(rating) || rating < 1 || rating > 5) {
      return sendError(res, 400, 'Rating must be between 1 and 5');
    }
    if (!testimonial || !testimonial.trim()) {
      return sendError(res, 400, 'Testimonial is required');
    }
    const trimmedTestimonial = testimonial.trim();
    if (trimmedTestimonial.length < 10) {
      return sendError(res, 400, 'Testimonial must be at least 10 characters long');
    }
    if (trimmedTestimonial.length > 500) {
      return sendError(res, 400, 'Testimonial exceeds 500 character limit');
    }
    if (!leadId || !Number.isInteger(parseInt(leadId, 10))) {
      return sendError(res, 400, 'Valid lead ID is required');
    }

    // Verify the lead exists, belongs to the business, and was completed
    const leadRes = await pool.query(
      `SELECT l.id, l.status, l.completed_at, l.customer_id
       FROM business_leads l
       WHERE l.id = $1 AND l.business_id = $2 AND l.customer_id = $3`,
      [leadId, businessId, customerId]
    );

    if (!leadRes.rows[0]) {
      return sendError(res, 404, 'Lead not found or you do not have permission to review it');
    }

    const lead = leadRes.rows[0];

    // Verify the lead is completed
    if (lead.status !== 'completed') {
      return sendError(res, 400, 'Can only review completed leads');
    }

    // Check if review already exists for this customer+lead combination
    const existingRes = await pool.query(
      `SELECT id FROM business_reviews WHERE customer_id = $1 AND lead_id = $2`,
      [customerId, leadId]
    );

    if (existingRes.rows[0]) {
      return sendError(res, 409, 'You have already reviewed this lead');
    }

    // Insert the review
    const result = await pool.query(
      `INSERT INTO business_reviews
       (business_id, customer_id, lead_id, rating, testimonial)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, business_id, customer_id, lead_id, rating, testimonial, response, created_at, updated_at`,
      [businessId, customerId, leadId, rating, trimmedTestimonial]
    );

    const review = result.rows[0];

    // Notify business owner (non-critical failure)
    try {
      const bizOwnerRes = await pool.query(
        `SELECT user_id FROM businesses WHERE id = $1`,
        [businessId]
      );

      if (bizOwnerRes.rows[0]) {
        await pool.query(
          `INSERT INTO notifications (user_id, type, title, message, reference_id, reference_type)
           VALUES ($1, 'review_received', 'New Review', $2, $3, 'business_review')`,
          [bizOwnerRes.rows[0].user_id, `New ${rating}-star review received`, review.id]
        );
      }
    } catch (notifErr) {
      logger.warn('Failed to create review notification', { reviewId: review.id, error: notifErr.message });
    }

    sendSuccess(res, review, 'Review submitted successfully', 201);
  } catch (err) {
    logger.error('submitReview failed', { error: err.message, userId: req.user.id });
    sendError(res, 500, 'Failed to submit review');
  }
};

// ── Get reviews for a business (public endpoint) ──────────────────────────────
exports.getBusinessReviews = async (req, res) => {
  try {
    const { businessId } = req.params;
    const { page = 1, limit = 10, sortBy = 'recent' } = req.query;

    // Validate pagination
    let parsedPage = parseInt(page, 10);
    let parsedLimit = parseInt(limit, 10);
    if (!Number.isInteger(parsedPage) || parsedPage < 1) parsedPage = 1;
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 50) parsedLimit = 10;

    // Validate sort option
    const validSortOptions = ['recent', 'helpful', 'rating-high', 'rating-low'];
    let orderClause = 'br.created_at DESC';
    if (sortBy === 'helpful') orderClause = 'br.created_at DESC'; // Can add upvote counts later
    if (sortBy === 'rating-high') orderClause = 'br.rating DESC, br.created_at DESC';
    if (sortBy === 'rating-low') orderClause = 'br.rating ASC, br.created_at DESC';

    // Fetch reviews with customer info
    const result = await pool.query(
      `SELECT
         br.id, br.business_id, br.customer_id, br.rating, br.testimonial, br.response,
         br.created_at, br.updated_at,
         u.first_name, u.last_name
       FROM business_reviews br
       JOIN users u ON u.id = br.customer_id
       WHERE br.business_id = $1
       ORDER BY ${orderClause}
       LIMIT $2 OFFSET $3`,
      [businessId, parsedLimit, (parsedPage - 1) * parsedLimit]
    );

    // Get total count and stats
    const countRes = await pool.query(
      `SELECT
         COUNT(*) as total,
         ROUND(AVG(rating)::NUMERIC, 2) as avg_rating,
         COUNT(*) FILTER (WHERE rating = 5) as five_star_count,
         COUNT(*) FILTER (WHERE rating = 4) as four_star_count,
         COUNT(*) FILTER (WHERE rating = 3) as three_star_count,
         COUNT(*) FILTER (WHERE rating = 2) as two_star_count,
         COUNT(*) FILTER (WHERE rating = 1) as one_star_count
       FROM business_reviews
       WHERE business_id = $1`,
      [businessId]
    );

    const stats = countRes.rows[0];

    sendSuccess(res, {
      reviews: result.rows,
      pagination: {
        page: parsedPage,
        limit: parsedLimit,
        total: parseInt(stats.total, 10),
      },
      stats: {
        avg_rating: parseFloat(stats.avg_rating) || 0,
        total_reviews: parseInt(stats.total, 10),
        distribution: {
          five_star: parseInt(stats.five_star_count, 10),
          four_star: parseInt(stats.four_star_count, 10),
          three_star: parseInt(stats.three_star_count, 10),
          two_star: parseInt(stats.two_star_count, 10),
          one_star: parseInt(stats.one_star_count, 10),
        },
      },
    });
  } catch (err) {
    logger.error('getBusinessReviews failed', { error: err.message, businessId: req.params.businessId });
    sendError(res, 500, 'Failed to fetch reviews');
  }
};

// ── Get reviews stats for a business ──────────────────────────────────────────
exports.getReviewStats = async (req, res) => {
  try {
    const { businessId } = req.params;

    const statsRes = await pool.query(
      `SELECT
         COUNT(*) as total_reviews,
         ROUND(AVG(rating)::NUMERIC, 2) as avg_rating,
         COUNT(*) FILTER (WHERE rating = 5) as five_star_count,
         COUNT(*) FILTER (WHERE rating = 4) as four_star_count,
         COUNT(*) FILTER (WHERE rating = 3) as three_star_count,
         COUNT(*) FILTER (WHERE rating = 2) as two_star_count,
         COUNT(*) FILTER (WHERE rating = 1) as one_star_count
       FROM business_reviews
       WHERE business_id = $1`,
      [businessId]
    );

    const stats = statsRes.rows[0];

    sendSuccess(res, {
      total_reviews: parseInt(stats.total_reviews, 10),
      avg_rating: parseFloat(stats.avg_rating) || 0,
      distribution: {
        five_star: parseInt(stats.five_star_count, 10),
        four_star: parseInt(stats.four_star_count, 10),
        three_star: parseInt(stats.three_star_count, 10),
        two_star: parseInt(stats.two_star_count, 10),
        one_star: parseInt(stats.one_star_count, 10),
      },
    });
  } catch (err) {
    logger.error('getReviewStats failed', { error: err.message });
    sendError(res, 500, 'Failed to fetch review stats');
  }
};

// ── Respond to a review (business owner only) ─────────────────────────────────
exports.respondToReview = async (req, res) => {
  try {
    const { reviewId } = req.params;
    const { response } = req.body;

    if (!response || !response.trim()) {
      return sendError(res, 400, 'Response is required');
    }
    const trimmedResponse = response.trim();
    if (trimmedResponse.length < 10) {
      return sendError(res, 400, 'Response must be at least 10 characters long');
    }
    if (trimmedResponse.length > 500) {
      return sendError(res, 400, 'Response exceeds 500 character limit');
    }

    // Get the review and verify ownership
    const reviewRes = await pool.query(
      `SELECT br.id, br.business_id
       FROM business_reviews br
       WHERE br.id = $1`,
      [reviewId]
    );

    if (!reviewRes.rows[0]) {
      return sendError(res, 404, 'Review not found');
    }

    const review = reviewRes.rows[0];

    // Verify the user owns the business or is an active member
    const isOwner = await pool.query(
      `SELECT 1 FROM businesses WHERE id = $1 AND user_id = $2`,
      [review.business_id, req.user.id]
    ).then(r => r.rows.length > 0);

    const isMember = await pool.query(
      `SELECT 1 FROM business_members
       WHERE business_id = $1 AND user_id = $2 AND status = 'active'`,
      [review.business_id, req.user.id]
    ).then(r => r.rows.length > 0);

    if (!isOwner && !isMember) {
      return sendError(res, 403, 'You do not have permission to respond to this review');
    }

    // Update the response
    const result = await pool.query(
      `UPDATE business_reviews
       SET response = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, business_id, customer_id, lead_id, rating, testimonial, response, created_at, updated_at`,
      [trimmedResponse, reviewId]
    );

    sendSuccess(res, result.rows[0], 'Response added successfully');
  } catch (err) {
    logger.error('respondToReview failed', { error: err.message, userId: req.user.id });
    sendError(res, 500, 'Failed to respond to review');
  }
};

// ── Delete a review (customer or business owner) ──────────────────────────────
exports.deleteReview = async (req, res) => {
  try {
    const { reviewId } = req.params;
    const userId = req.user.id;

    // Get the review
    const reviewRes = await pool.query(
      `SELECT br.id, br.business_id, br.customer_id
       FROM business_reviews br
       WHERE br.id = $1`,
      [reviewId]
    );

    if (!reviewRes.rows[0]) {
      return sendError(res, 404, 'Review not found');
    }

    const review = reviewRes.rows[0];

    // Verify authorization: customer who posted it OR business owner
    const isCustomer = review.customer_id === userId;
    const isBizOwner = await pool.query(
      `SELECT 1 FROM businesses WHERE id = $1 AND user_id = $2`,
      [review.business_id, userId]
    ).then(r => r.rows.length > 0);

    if (!isCustomer && !isBizOwner) {
      return sendError(res, 403, 'You do not have permission to delete this review');
    }

    // Delete the review with authorization safeguard and RETURNING
    const delResult = await pool.query(
      `DELETE FROM business_reviews WHERE id = $1 AND (customer_id = $2 OR business_id IN (SELECT id FROM businesses WHERE user_id = $2)) RETURNING id`,
      [reviewId, userId]
    );

    if (!delResult.rows.length) {
      return sendError(res, 403, 'Delete authorization check failed');
    }

    sendSuccess(res, null, 'Review deleted successfully');
  } catch (err) {
    logger.error('deleteReview failed', { error: err.message, userId: req.user.id });
    sendError(res, 500, 'Failed to delete review');
  }
};
