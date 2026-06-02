const pool = require('../db');
const crypto = require('crypto');

// Broadcasts
exports.listBroadcasts = async (req, res, next) => {
  const { businessId } = req.params;
  try {
    const rows = await pool.query(
      'SELECT * FROM business_broadcasts WHERE business_id=$1 ORDER BY created_at DESC LIMIT 50',
      [businessId]
    );
    res.json(rows.rows);
  } catch (err) { next(err); }
};

exports.createBroadcast = async (req, res, next) => {
  const { businessId } = req.params;
  const { subject, message, channel = 'email', audience = 'all', scheduled_at } = req.body;
  if (!subject || !message) return res.status(400).json({ error: 'subject and message are required' });
  try {
    const audienceCount = await pool.query(
      `SELECT COUNT(*) FROM business_customers WHERE business_id=$1 AND is_active=TRUE`,
      [businessId]
    );
    const row = await pool.query(
      `INSERT INTO business_broadcasts
         (business_id, subject, body, message, channel, audience, audience_tag, recipient_count, scheduled_at, status)
       VALUES ($1,$2,$3,$3,$4,$5,$5,$6,$7,$8) RETURNING *`,
      [businessId, subject, message, channel, audience, parseInt(audienceCount.rows[0].count), scheduled_at, scheduled_at ? 'scheduled' : 'draft']
    );
    res.status(201).json(row.rows[0]);
  } catch (err) { next(err); }
};

exports.sendBroadcast = async (req, res, next) => {
  const { businessId, id } = req.params;
  try {
    const row = await pool.query(
      `UPDATE business_broadcasts SET status='sent', sent_at=NOW(), updated_at=NOW()
       WHERE id=$1 AND business_id=$2 AND status IN ('draft','scheduled') RETURNING *`,
      [id, businessId]
    );
    if (!row.rows.length) return res.status(404).json({ error: 'Not found or already sent' });
    res.json(row.rows[0]);
  } catch (err) { next(err); }
};

exports.deleteBroadcast = async (req, res, next) => {
  const { businessId, id } = req.params;
  try {
    await pool.query(
      'DELETE FROM business_broadcasts WHERE id=$1 AND business_id=$2 AND status!=\'sent\'',
      [id, businessId]
    );
    res.json({ success: true });
  } catch (err) { next(err); }
};

// Promo codes
exports.listPromoCodes = async (req, res, next) => {
  const { businessId } = req.params;
  try {
    const rows = await pool.query(
      'SELECT * FROM business_promo_codes WHERE business_id=$1 ORDER BY created_at DESC',
      [businessId]
    );
    res.json(rows.rows);
  } catch (err) { next(err); }
};

exports.createPromoCode = async (req, res, next) => {
  const { businessId } = req.params;
  const { code, discount_type, discount_value, min_order_cents, max_uses, expires_at, description } = req.body;
  if (!discount_type || discount_value === undefined) {
    return res.status(400).json({ error: 'discount_type and discount_value are required' });
  }
  const finalCode = (code || crypto.randomBytes(4).toString('hex')).toUpperCase();
  try {
    const row = await pool.query(
      `INSERT INTO business_promo_codes
         (business_id, code, discount_type, discount_value, min_order_cents, max_uses, expires_at, valid_until, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        businessId,
        finalCode,
        discount_type,
        discount_value,
        min_order_cents ?? 0,
        max_uses,
        expires_at || null,
        expires_at ? new Date(expires_at).toISOString().slice(0, 10) : null,
        description || null,
      ]
    );
    res.status(201).json(row.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Code already exists' });
    next(err);
  }
};

exports.togglePromoCode = async (req, res, next) => {
  const { businessId, codeId } = req.params;
  try {
    const row = await pool.query(
      `UPDATE business_promo_codes SET is_active = NOT is_active, updated_at=NOW()
       WHERE id=$1 AND business_id=$2 RETURNING *`,
      [codeId, businessId]
    );
    if (!row.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(row.rows[0]);
  } catch (err) { next(err); }
};

exports.deletePromoCode = async (req, res, next) => {
  const { businessId, codeId } = req.params;
  try {
    await pool.query('DELETE FROM business_promo_codes WHERE id=$1 AND business_id=$2', [codeId, businessId]);
    res.json({ success: true });
  } catch (err) { next(err); }
};

exports.requestFeaturedPlacement = async (req, res, next) => {
  const { businessId } = req.params;
  const {
    category,
    zip,
    note,
    source = 'promote_page',
  } = req.body || {};

  try {
    const row = await pool.query(
      `INSERT INTO business_featured_placement_requests
         (business_id, requested_by_id, category, zip, note, source)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (business_id)
       DO UPDATE SET
         requested_by_id = EXCLUDED.requested_by_id,
         category = COALESCE(EXCLUDED.category, business_featured_placement_requests.category),
         zip = COALESCE(EXCLUDED.zip, business_featured_placement_requests.zip),
         note = COALESCE(EXCLUDED.note, business_featured_placement_requests.note),
         source = EXCLUDED.source,
         status = CASE
           WHEN business_featured_placement_requests.status = 'closed' THEN 'requested'
           ELSE business_featured_placement_requests.status
         END,
         updated_at = NOW()
       RETURNING *`,
      [businessId, req.user.id, category || null, zip || null, note || null, source]
    );
    res.status(201).json(row.rows[0]);
  } catch (err) { next(err); }
};
