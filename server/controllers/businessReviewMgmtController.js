const pool = require('../db');

async function checkAccess(businessId, userId) {
  const { rows } = await pool.query(
    `SELECT role FROM business_members WHERE business_id=$1 AND user_id=$2 AND status='active'
     UNION
     SELECT 'owner' AS role FROM businesses WHERE id=$1 AND user_id=$2`,
    [businessId, userId]
  );
  return rows.length > 0;
}

async function hasBusinessReviewsTable() {
  const { rows } = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_name='business_reviews' LIMIT 1`
  );
  return rows.length > 0;
}

async function ensureReviewReplyColumns() {
  if (!await hasBusinessReviewsTable()) return false;

  await pool.query(`
    ALTER TABLE business_reviews
      ADD COLUMN IF NOT EXISTS owner_reply TEXT,
      ADD COLUMN IF NOT EXISTS owner_reply_at TIMESTAMPTZ
  `);
  return true;
}

exports.getReputation = async (req, res, next) => {
  try {
    const { businessId } = req.params;

    // Check if business_reviews table exists
    const tableCheck = await pool.query(
      `SELECT 1 FROM information_schema.tables WHERE table_name='business_reviews' LIMIT 1`
    );

    if (!tableCheck.rows.length) {
      return res.json({ avg_rating: null, review_count: 0, rating_trend: [], recent_reviews: [] });
    }

    const [statsRes, trendRes, recentRes] = await Promise.all([
      pool.query(
        `SELECT AVG(rating)::NUMERIC(3,1) AS avg_rating, COUNT(*) AS review_count
         FROM business_reviews WHERE business_id=$1`,
        [businessId]
      ),
      pool.query(
        `SELECT to_char(created_at,'YYYY-MM') AS month,
                AVG(rating)::NUMERIC(3,1) AS avg_rating,
                COUNT(*) AS count
         FROM business_reviews WHERE business_id=$1 AND created_at >= now() - INTERVAL '12 months'
         GROUP BY month ORDER BY month ASC`,
        [businessId]
      ),
      pool.query(
        `SELECT r.*, u.first_name, u.last_name
         FROM business_reviews r
         LEFT JOIN users u ON u.id = r.reviewer_id
         WHERE r.business_id=$1 ORDER BY r.created_at DESC LIMIT 10`,
        [businessId]
      ),
    ]);

    res.json({
      avg_rating: statsRes.rows[0]?.avg_rating || null,
      review_count: parseInt(statsRes.rows[0]?.review_count || 0),
      rating_trend: trendRes.rows,
      recent_reviews: recentRes.rows,
    });
  } catch (err) {
    next(err);
  }
};

exports.sendReviewRequest = async (req, res, next) => {
  try {
    const { businessId } = req.params;
    const userId = req.user.id;
    const { client_email, client_name, appointment_id } = req.body;

    if (!await checkAccess(businessId, userId)) return res.status(403).json({ error: 'Access denied' });
    if (!client_email?.trim()) return res.status(400).json({ error: 'client_email required' });

    const { rows } = await pool.query(
      `INSERT INTO business_review_requests (business_id, client_email, client_name, appointment_id)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [businessId, client_email.trim(), client_name || null, appointment_id || null]
    );

    // Non-blocking email
    try {
      const notificationService = require('../services/notificationService');
      if (notificationService?.sendEmail) {
        notificationService.sendEmail({
          to: client_email.trim(),
          subject: 'We value your feedback',
          text: `Hi ${client_name || 'there'}, please leave us a review! Your feedback helps us improve.`,
        }).catch(() => {});
      }
    } catch {}

    res.status(201).json({ request: rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.listReviewRequests = async (req, res, next) => {
  try {
    const { businessId } = req.params;

    const { rows } = await pool.query(
      `SELECT * FROM business_review_requests WHERE business_id=$1 ORDER BY sent_at DESC LIMIT 100`,
      [businessId]
    );
    res.json({ requests: rows, total: rows.length });
  } catch (err) {
    next(err);
  }
};

exports.replyToReview = async (req, res, next) => {
  try {
    const { businessId, reviewId } = req.params;
    const userId = req.user.id;
    const replyText = req.body.reply_text || req.body.reply;

    if (!await checkAccess(businessId, userId)) return res.status(403).json({ error: 'Access denied' });
    if (!replyText?.trim()) return res.status(400).json({ error: 'reply_text required' });

    if (!await ensureReviewReplyColumns()) {
      return res.status(404).json({ error: 'Review not found' });
    }

    const { rows } = await pool.query(
      `UPDATE business_reviews SET owner_reply=$1, owner_reply_at=now()
       WHERE id=$2 AND business_id=$3 RETURNING *`,
      [replyText.trim(), reviewId, businessId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Review not found' });
    return res.json({ review: rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.deleteReply = async (req, res, next) => {
  try {
    const { businessId, reviewId } = req.params;
    const userId = req.user.id;

    if (!await checkAccess(businessId, userId)) return res.status(403).json({ error: 'Access denied' });
    if (!await ensureReviewReplyColumns()) {
      return res.status(404).json({ error: 'Review not found' });
    }

    const { rows } = await pool.query(
      `UPDATE business_reviews
       SET owner_reply=NULL, owner_reply_at=NULL
       WHERE id=$1 AND business_id=$2 RETURNING *`,
      [reviewId, businessId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Review not found' });
    return res.json({ review: rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.getReviews = async (req, res, next) => {
  try {
    const { businessId } = req.params;
    const { page = 1, rating_filter, replied } = req.query;
    const limit = 20;
    const offset = (parseInt(page) - 1) * limit;

    if (!await ensureReviewReplyColumns()) return res.json({ reviews: [], total: 0 });

    const conditions = ['r.business_id = $1'];
    const params = [businessId];
    let p = 2;

    if (rating_filter) { conditions.push(`r.rating = $${p++}`); params.push(parseInt(rating_filter)); }
    if (replied === 'true') conditions.push(`NULLIF(BTRIM(r.owner_reply), '') IS NOT NULL`);
    if (replied === 'false') conditions.push(`NULLIF(BTRIM(r.owner_reply), '') IS NULL`);

    const where = conditions.join(' AND ');
    const [reviewsRes, totalRes] = await Promise.all([
      pool.query(
        `SELECT r.*, u.first_name, u.last_name
         FROM business_reviews r
         LEFT JOIN users u ON u.id = r.reviewer_id
         WHERE ${where} ORDER BY r.created_at DESC LIMIT $${p} OFFSET $${p+1}`,
        [...params, limit, offset]
      ),
      pool.query(`SELECT COUNT(*) FROM business_reviews r WHERE ${where}`, params),
    ]);

    res.json({ reviews: reviewsRes.rows, total: parseInt(totalRes.rows[0].count) });
  } catch (err) {
    next(err);
  }
};
