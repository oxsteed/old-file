const pool = require('../db');
const crypto = require('crypto');
// Campaign funnel aggregates (analytics platform, Phase 2, Item 10).
const campaignAnalytics = require('../analytics/campaignAnalytics');

// Broadcasts (analytics decision 1: real delivery + tracking).
const broadcastDelivery = require('../services/broadcastDeliveryService');
const { logBusinessAction } = require('../services/businessAuditLog');
const BROADCAST_CHANNEL_INPUTS = Object.keys(broadcastDelivery.CHANNEL_SETS);

function broadcastSummary(stats) {
  const channels = stats?.channels || {};
  const sum = (k) => Object.values(channels).reduce((n, c) => n + Number(c[k] || 0), 0);
  return { ...stats, sent: sum('sent'), failed: sum('failed'), skipped: sum('skipped'), pending: sum('pending'),
    opened: sum('opened'), clicked: sum('clicked') };
}

exports.listBroadcasts = async (req, res, next) => {
  const { businessId } = req.params;
  try {
    const rows = await pool.query(
      'SELECT * FROM business_broadcasts WHERE business_id=$1 ORDER BY created_at DESC LIMIT 50',
      [businessId]
    );
    const tracked = rows.rows.filter(b => b.delivery_tracked).map(b => b.id);
    const stats = await broadcastDelivery.getBroadcastStats(pool, tracked);
    res.json(rows.rows.map(b => ({ ...b, delivery: b.delivery_tracked ? broadcastSummary(stats[String(b.id)]) : null })));
  } catch (err) { next(err); }
};

exports.createBroadcast = async (req, res, next) => {
  const { businessId } = req.params;
  const { subject, message, channel = 'email', audience = 'all', scheduled_at } = req.body;
  if (!subject || !message) return res.status(400).json({ error: 'subject and message are required' });
  if (!BROADCAST_CHANNEL_INPUTS.includes(channel)) {
    return res.status(400).json({ error: 'Unsupported channel', code: 'broadcast_channel_unsupported', allowed: BROADCAST_CHANNEL_INPUTS });
  }
  if (String(subject).length > 300 || String(message).length > 10000) {
    return res.status(400).json({ error: 'Subject or message is too long', code: 'validation_failed' });
  }
  let scheduledAt = null;
  if (scheduled_at) {
    scheduledAt = new Date(scheduled_at);
    if (Number.isNaN(scheduledAt.getTime())) return res.status(400).json({ error: 'Invalid schedule', code: 'validation_failed' });
  }
  try {
    const audienceCount = await pool.query(
      `SELECT COUNT(*)::INT AS count FROM business_clients
        WHERE business_id=$1 AND deleted_at IS NULL AND status='active' AND ($2 = 'all' OR $2 = ANY(tags))`,
      [businessId, audience]
    );
    const row = await pool.query(
      `INSERT INTO business_broadcasts
         (business_id, subject, body, message, channel, channels, audience, audience_tag, recipient_count, scheduled_at, status, created_by)
       VALUES ($1,$2,$3,$3,$4,$5,$6,$6,$7,$8,$9,$10) RETURNING *`,
      [businessId, subject, message, channel, broadcastDelivery.CHANNEL_SETS[channel], audience,
        audienceCount.rows[0].count, scheduledAt, scheduledAt ? 'scheduled' : 'draft', req.user?.id || null]
    );
    res.status(201).json(row.rows[0]);
  } catch (err) { next(err); }
};

exports.sendBroadcast = async (req, res, next) => {
  const { businessId, id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await broadcastDelivery.queueBroadcast(client, { businessId, broadcastId: id, userId: req.user?.id || null });
    if (out.notFound || out.conflict) {
      await client.query('ROLLBACK');
      return res.status(out.notFound ? 404 : 409).json({ error: 'Not found or already sent', code: out.notFound ? 'not_found' : 'broadcast_already_queued' });
    }
    // Fail closed: no audit row, no delivery.
    await logBusinessAction(req, {
      client, throwOnError: true, business_id: Number(businessId), action: out.scheduled ? 'broadcast.scheduled' : 'broadcast.queued',
      target_type: 'business_broadcast', target_id: id,
      metadata: { channels: out.broadcast.channels, recipients: out.broadcast.recipient_count, scheduled_at: out.broadcast.scheduled_at },
    });
    await client.query('COMMIT');
    res.status(202).json(out.broadcast);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === 'broadcast_channel_unsupported') return res.status(400).json({ error: err.message, code: err.code });
    next(err);
  } finally { client.release(); }
};

exports.getBroadcastStats = async (req, res, next) => {
  const { businessId, id } = req.params;
  try {
    const { rows: [b] } = await pool.query('SELECT id, delivery_tracked FROM business_broadcasts WHERE id=$1 AND business_id=$2', [id, businessId]);
    if (!b) return res.status(404).json({ error: 'Not found' });
    if (!b.delivery_tracked) return res.json({ broadcastId: b.id, tracked: false });
    const stats = await broadcastDelivery.getBroadcastStats(pool, [b.id]);
    res.json({ broadcastId: b.id, tracked: true, ...broadcastSummary(stats[String(b.id)]) });
  } catch (err) { next(err); }
};

exports.getBroadcastReport = async (req, res, next) => {
  const { businessId } = req.params;
  const days = [7, 30, 90, 365].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
  try {
    res.json(await broadcastDelivery.getBroadcastReport(pool, businessId, days));
  } catch (err) { next(err); }
};

exports.deleteBroadcast = async (req, res, next) => {
  const { businessId, id } = req.params;
  try {
    // Only drafts and not-yet-due schedules; a sending broadcast keeps its ledger.
    await pool.query(
      `DELETE FROM business_broadcasts WHERE id=$1 AND business_id=$2 AND status IN ('draft','scheduled')`,
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

// GET /:businessId/featured-placement-requests: the business's own request
// status so the promote page can show where it stands (P1-312).
exports.getFeaturedPlacementRequest = async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.id, r.status, r.created_at, r.updated_at, r.decided_at,
              r.featured_restaurant_id,
              fr.display_name AS featured_restaurant_name,
              fr.featured_until,
              (fr.is_featured AND (fr.featured_until IS NULL OR fr.featured_until > NOW())) AS is_live
         FROM business_featured_placement_requests r
         LEFT JOIN food_restaurants fr ON fr.id = r.featured_restaurant_id
        WHERE r.business_id = $1`,
      [req.params.businessId]
    );
    const row = rows[0];
    if (!row) return res.json({ request: null });
    const expired = row.status === 'approved' && !row.is_live;
    res.json({
      request: {
        id: Number(row.id),
        status: expired ? 'expired' : row.status,
        featured_restaurant_name: row.featured_restaurant_name || null,
        featured_until: row.status === 'approved' ? row.featured_until : null,
        updated_at: row.updated_at,
      },
    });
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
         -- P1-312: a declined or closed request re-enters the review queue,
         -- and so does an approved one whose placement has lapsed.
         status = CASE
           WHEN business_featured_placement_requests.status IN ('closed', 'declined') THEN 'requested'
           WHEN business_featured_placement_requests.status = 'approved'
            AND NOT EXISTS (
              SELECT 1 FROM food_restaurants fr
               WHERE fr.id = business_featured_placement_requests.featured_restaurant_id
                 AND fr.is_featured
                 AND (fr.featured_until IS NULL OR fr.featured_until > NOW())
            ) THEN 'requested'
           ELSE business_featured_placement_requests.status
         END,
         updated_at = NOW()
       RETURNING *`,
      [businessId, req.user.id, category || null, zip || null, note || null, source]
    );
    res.status(201).json(row.rows[0]);
  } catch (err) { next(err); }
};

// GET /:businessId/campaign-performance (analytics platform, Phase 2, Item 10).
// Per-campaign funnel for this business's featured-placement requests:
// impressions, clicks, conversions, click-through rate, conversion rate.
// Read-only. Scoped to the route's business (requireBusinessAccess at the
// route layer); aggregates come from server/analytics/campaignAnalytics.js
// so the funnel definition is owned in one place.
//
// Rate semantics (documented, same as the module):
//   click_through_rate = clicks / impressions (null when impressions = 0)
//   conversion_rate    = conversions / clicks  (null when clicks = 0)
// Conversions are campaign-window attributed: orders placed while the
// placement was live, not proven click-through causality.
exports.getCampaignPerformance = async (req, res, next) => {
  const { businessId } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT r.id, r.status, r.created_at, r.updated_at,
              r.featured_restaurant_id,
              fr.display_name AS featured_restaurant_name,
              fr.featured_until,
              (fr.is_featured AND (fr.featured_until IS NULL OR fr.featured_until > NOW())) AS is_live
         FROM business_featured_placement_requests r
         LEFT JOIN food_restaurants fr ON fr.id = r.featured_restaurant_id
        WHERE r.business_id = $1
        ORDER BY r.updated_at DESC`,
      [businessId]
    );
    const campaignIds = rows.map((r) => Number(r.id));
    const perf = await campaignAnalytics.getCampaignPerformance(pool, campaignIds);
    const byId = new Map(perf.map((p) => [p.campaign_id, p]));
    res.json({
      campaigns: rows.map((r) => {
        const p = byId.get(Number(r.id)) || {
          impressions: 0, clicks: 0, conversions: 0,
          click_through_rate: null, conversion_rate: null,
        };
        // Same 'expired' mapping as getFeaturedPlacementRequest so the
        // status label matches the promote page's request-status display.
        const isLive = Boolean(r.is_live);
        const status = r.status === 'approved' && !isLive ? 'expired' : r.status;
        return {
          campaign_id: Number(r.id),
          campaign_type: 'featured_placement',
          status,
          is_live: isLive,
          featured_restaurant_id: r.featured_restaurant_id == null ? null : Number(r.featured_restaurant_id),
          featured_restaurant_name: r.featured_restaurant_name || null,
          featured_until: r.featured_until || null,
          impressions: p.impressions,
          clicks: p.clicks,
          conversions: p.conversions,
          click_through_rate: p.click_through_rate,
          conversion_rate: p.conversion_rate,
        };
      }),
    });
  } catch (err) { next(err); }
};
