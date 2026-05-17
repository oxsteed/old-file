const pool = require('../db');

exports.listReviews = async (req, res, next) => {
  const { businessId } = req.params;
  const { limit = 20, offset = 0, replied } = req.query;
  try {
    let where = 'WHERE r.business_id = $1';
    const params = [businessId];
    if (replied === 'true')  where += ' AND r.owner_reply IS NOT NULL';
    if (replied === 'false') where += ' AND r.owner_reply IS NULL';
    const rows = await pool.query(
      `SELECT r.*,
              COALESCE(u.display_name_preference, u.first_name || ' ' || u.last_name, 'Anonymous') AS reviewer_name,
              u.profile_photo_url AS reviewer_avatar
       FROM business_reviews r
       LEFT JOIN users u ON r.customer_id = u.id
       ${where} ORDER BY r.created_at DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`,
      [...params, parseInt(limit), parseInt(offset)]
    );
    const total = await pool.query(`SELECT COUNT(*), AVG(rating)::numeric(3,2) AS avg_rating FROM business_reviews ${where}`, params);
    res.json({ reviews: rows.rows, total: parseInt(total.rows[0].count), avg_rating: parseFloat(total.rows[0].avg_rating) || 0 });
  } catch (err) { next(err); }
};

exports.replyToReview = async (req, res, next) => {
  const { businessId, reviewId } = req.params;
  const { reply } = req.body;
  if (!reply || !reply.trim()) return res.status(400).json({ error: 'Reply text is required' });
  try {
    const row = await pool.query(
      `UPDATE business_reviews SET owner_reply=$1, owner_reply_at=NOW()
       WHERE id=$2 AND business_id=$3 RETURNING *`,
      [reply.trim(), reviewId, businessId]
    );
    if (!row.rows.length) return res.status(404).json({ error: 'Review not found' });
    res.json(row.rows[0]);
  } catch (err) { next(err); }
};

exports.deleteReply = async (req, res, next) => {
  const { businessId, reviewId } = req.params;
  try {
    await pool.query(
      'UPDATE business_reviews SET owner_reply=NULL, owner_reply_at=NULL WHERE id=$1 AND business_id=$2',
      [reviewId, businessId]
    );
    res.json({ success: true });
  } catch (err) { next(err); }
};

exports.sendReviewRequest = async (req, res, next) => {
  const { businessId } = req.params;
  const { customer_id, appointment_id, channel = 'email' } = req.body;
  if (!customer_id) return res.status(400).json({ error: 'customer_id is required' });
  try {
    const row = await pool.query(
      `INSERT INTO business_review_requests (business_id, customer_id, appointment_id, channel)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (business_id, customer_id, appointment_id) DO NOTHING RETURNING *`,
      [businessId, customer_id, appointment_id, channel]
    );
    res.status(201).json(row.rows[0] || { message: 'Already sent' });
  } catch (err) { next(err); }
};

exports.listReviewRequests = async (req, res, next) => {
  const { businessId } = req.params;
  try {
    const rows = await pool.query(
      `SELECT rr.*,
              COALESCE(u.display_name_preference, u.first_name || ' ' || u.last_name) AS customer_name
       FROM business_review_requests rr
       LEFT JOIN users u ON rr.customer_id = u.id
       WHERE rr.business_id = $1 ORDER BY rr.sent_at DESC LIMIT 100`,
      [businessId]
    );
    res.json(rows.rows);
  } catch (err) { next(err); }
};
