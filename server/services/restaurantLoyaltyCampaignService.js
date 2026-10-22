'use strict';

const crypto = require('crypto');
const AppError = require('../utils/appError');
const notificationService = require('./notificationService');

function deliveryEnabled() { return process.env.RESTAURANT_LOYALTY_DELIVERY_ENABLED === 'true'; }

const CHANNELS = new Set(['in_app', 'email']);

function normalizeText(value, field, max, { required = true } = {}) {
  const text = String(value ?? '').trim();
  if (required && !text) throw new AppError(`${field} is required`, 400, 'validation_failed', { [field]: 'Required' });
  if (text.length > max) throw new AppError(`${field} is too long`, 400, 'validation_failed', { [field]: `Max ${max} characters` });
  return text || null;
}

function normalizeChannel(value) {
  const channel = String(value || '').trim().toLowerCase();
  if (!CHANNELS.has(channel)) throw new AppError('Campaign channel is invalid', 400, 'validation_failed', { channel: 'Use in_app or email' });
  return channel;
}

function normalizeCampaignInput(input = {}) {
  const channel = normalizeChannel(input.channel);
  const body = normalizeText(input.body, 'body', 4000);
  const subject = channel === 'email' ? normalizeText(input.subject, 'subject', 180) : normalizeText(input.subject, 'subject', 180, { required: false });
  const name = normalizeText(input.name, 'name', 120);
  return { name, channel, subject, body };
}

function shape(row, counts = null) {
  return {
    id: Number(row.id),
    restaurantId: Number(row.restaurant_id),
    segmentId: Number(row.segment_id),
    name: row.name,
    channel: row.channel,
    subject: row.subject || null,
    body: row.body,
    status: row.status,
    scheduledAt: row.scheduled_at || null,
    approvedAt: row.approved_at || null,
    queuedAt: row.queued_at || null,
    completedAt: row.completed_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(counts ? { counts } : {}),
  };
}

async function createCampaign(client, { restaurantId, segmentId, actorUserId, input }) {
  const normalized = normalizeCampaignInput(input);
  const { rows: [segment] } = await client.query(
    `SELECT id FROM restaurant_loyalty_segments
      WHERE id = $1 AND restaurant_id = $2 AND is_active = TRUE`,
    [segmentId, restaurantId]
  );
  if (!segment) throw new AppError('Active loyalty segment not found', 404, 'loyalty_segment_not_found');
  const { rows: [row] } = await client.query(
    `INSERT INTO restaurant_loyalty_campaigns
       (restaurant_id, segment_id, name, channel, subject, body, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
     RETURNING *`,
    [restaurantId, segmentId, normalized.name, normalized.channel, normalized.subject, normalized.body, actorUserId]
  );
  return shape(row);
}

async function approveCampaign(client, { restaurantId, campaignId, actorUserId }) {
  // Audit fix (finding 41): separation of duties. The same admin must not
  // create and approve a campaign that queues customer messages. The
  // creator check runs under the same row lock as the approval so a
  // concurrent create/approve race cannot slip through.
  const { rows: [campaign] } = await client.query(
    `SELECT id, status, created_by
       FROM restaurant_loyalty_campaigns
      WHERE id = $1 AND restaurant_id = $2
      FOR UPDATE`,
    [campaignId, restaurantId]
  );
  if (!campaign) throw new AppError('Loyalty campaign not found', 404, 'loyalty_campaign_not_found');
  if (campaign.status !== 'draft') {
    throw new AppError('Only a draft campaign can be approved', 409, 'loyalty_campaign_not_draft');
  }
  // Rows with NULL created_by predate creator tracking and stay approvable.
  if (campaign.created_by && String(campaign.created_by) === String(actorUserId)) {
    throw new AppError(
      'Campaigns must be approved by someone other than the creator',
      403,
      'loyalty_campaign_self_approval'
    );
  }
  const { rows: [row] } = await client.query(
    `UPDATE restaurant_loyalty_campaigns
        SET status = 'approved', approved_by = $3, approved_at = NOW(), updated_by = $3
      WHERE id = $1 AND restaurant_id = $2 AND status = 'draft'
      RETURNING *`,
    [campaignId, restaurantId, actorUserId]
  );
  if (!row) throw new AppError('Only a draft campaign can be approved', 409, 'loyalty_campaign_not_draft');
  return shape(row);
}

async function queueCampaign(client, { restaurantId, campaignId, actorUserId }) {
  const { rows: [campaign] } = await client.query(
    `SELECT c.*, s.criteria
       FROM restaurant_loyalty_campaigns c
       JOIN restaurant_loyalty_segments s ON s.id = c.segment_id
      WHERE c.id = $1 AND c.restaurant_id = $2
      FOR UPDATE`,
    [campaignId, restaurantId]
  );
  if (!campaign) throw new AppError('Loyalty campaign not found', 404, 'loyalty_campaign_not_found');
  if (campaign.status !== 'approved') throw new AppError('Campaign must be approved before queueing', 409, 'loyalty_campaign_not_approved');
  const criteria = campaign.criteria || {};
  const params = [campaignId, restaurantId];
  const conditions = ['fla.restaurant_id = $2'];
  if (criteria.min_lifetime_points != null) { params.push(Number(criteria.min_lifetime_points)); conditions.push(`fla.lifetime_points >= $${params.length}`); }
  if (criteria.min_orders != null) { params.push(Number(criteria.min_orders)); conditions.push(`(SELECT COUNT(*) FROM food_orders fo WHERE fo.restaurant_id = fla.restaurant_id AND fo.customer_id = fla.customer_id AND fo.payment_status = 'paid' AND fo.status NOT IN ('cancelled','refunded')) >= $${params.length}`); }
  if (criteria.days_since_last_order != null) { params.push(Number(criteria.days_since_last_order)); conditions.push(`(NOT EXISTS (SELECT 1 FROM food_orders fo WHERE fo.restaurant_id = fla.restaurant_id AND fo.customer_id = fla.customer_id AND fo.payment_status = 'paid' AND fo.status NOT IN ('cancelled','refunded') AND fo.created_at > NOW() - ($${params.length}::int * INTERVAL '1 day')))`); }
  if (criteria.location_id != null) { params.push(Number(criteria.location_id)); conditions.push(`EXISTS (SELECT 1 FROM food_orders fo WHERE fo.restaurant_id = fla.restaurant_id AND fo.customer_id = fla.customer_id AND fo.location_id = $${params.length})`); }
  const emailConsent = campaign.channel === 'email'
    ? `AND COALESCE(np.marketing_emails, TRUE) = TRUE AND COALESCE(np.email_notifications, TRUE) = TRUE`
    : '';
  const inserted = await client.query(
    `INSERT INTO restaurant_loyalty_campaign_deliveries (campaign_id, customer_id, channel)
     SELECT $1, fla.customer_id, $${params.length + 1}
       FROM food_loyalty_accounts fla
       JOIN users u ON u.id = fla.customer_id
       LEFT JOIN notification_preferences np ON np.user_id = u.id
      WHERE ${conditions.join(' AND ')} AND u.is_banned = FALSE ${emailConsent}
     ON CONFLICT (campaign_id, customer_id, channel) DO NOTHING`,
    [...params, campaign.channel]
  );
  const { rows: [row] } = await client.query(
    `UPDATE restaurant_loyalty_campaigns
        SET status = CASE WHEN EXISTS (
          SELECT 1 FROM restaurant_loyalty_campaign_deliveries d
           WHERE d.campaign_id = $1 AND d.status = 'pending'
        ) THEN 'queued' ELSE 'completed' END,
            queued_at = NOW(), completed_at = CASE WHEN NOT EXISTS (
              SELECT 1 FROM restaurant_loyalty_campaign_deliveries d
               WHERE d.campaign_id = $1 AND d.status = 'pending'
            ) THEN NOW() ELSE NULL END,
            updated_by = $2
      WHERE id = $1 AND restaurant_id = $3
      RETURNING *`,
    [campaignId, actorUserId, restaurantId]
  );
  return { campaign: shape(row), queuedRecipients: Number(inserted.rowCount || 0) };
}

async function deliverBatch({ limit = 25 } = {}) {
  if (!deliveryEnabled()) return { claimed: 0, sent: 0, disabled: true };
  const db = require('../db');
  await db.query(`UPDATE restaurant_loyalty_campaign_deliveries
    SET status='failed', lease_token=NULL, lease_expires_at=NULL, last_error='attempts_exhausted', updated_at=NOW()
    WHERE status='sending' AND lease_expires_at<NOW() AND attempts>=5`);
  const leaseToken = crypto.randomUUID();
  const { rows } = await db.query(
    `WITH claim AS (
       SELECT d.id
         FROM restaurant_loyalty_campaign_deliveries d
         JOIN restaurant_loyalty_campaigns c ON c.id = d.campaign_id
        WHERE ((d.status = 'pending' AND d.next_attempt_at <= NOW())
          OR (d.status = 'sending' AND d.lease_expires_at < NOW())) AND d.attempts < 5
          AND c.status IN ('queued', 'sending')
        ORDER BY d.id
        LIMIT $1
        FOR UPDATE OF d SKIP LOCKED
     )
     UPDATE restaurant_loyalty_campaign_deliveries d
        SET status = 'sending', lease_token = $2::uuid,
            lease_expires_at = NOW() + INTERVAL '5 minutes',
            attempts = d.attempts + 1, updated_at = NOW()
       FROM claim WHERE d.id = claim.id
       RETURNING d.*`,
    [Math.max(1, Math.min(Number(limit) || 25, 100)), leaseToken]
  );
  let sent = 0;
  for (const delivery of rows) {
    try {
      const { rows: [campaign] } = await db.query('SELECT * FROM restaurant_loyalty_campaigns WHERE id = $1', [delivery.campaign_id]);
      const result = await notificationService.sendNotification({
        userId: delivery.customer_id,
        type: 'restaurant_loyalty_campaign',
        title: campaign.subject || campaign.name,
        body: campaign.body,
        promotional: true,
        emailChannel: delivery.channel === 'email',
        pushChannel: false,
        idempotencyKey: `restaurant-loyalty:${delivery.id}`,
      });
      const saved = await db.query(
        `UPDATE restaurant_loyalty_campaign_deliveries
            SET status = $2, notification_id = $3, sent_at = CASE WHEN $2 = 'sent' THEN NOW() ELSE NULL END,
                lease_token = NULL, lease_expires_at = NULL, last_error = $4,
                next_attempt_at = CASE WHEN $2='pending' THEN NOW() + INTERVAL '15 minutes' ELSE next_attempt_at END, updated_at = NOW()
          WHERE id = $1 AND lease_token = $5::uuid`,
        [delivery.id, result?.success === false ? (Number(delivery.attempts) >= 5 || ['promo_cap', 'user_not_found'].includes(result?.reason) ? 'failed' : 'pending') : 'sent', result?.notificationId || null, String(result?.reason || result?.error || '').slice(0, 500) || null, leaseToken]
      );
      if (result?.success !== false && saved.rowCount > 0) sent += 1;
    } catch (error) {
      await db.query(
        `UPDATE restaurant_loyalty_campaign_deliveries
            SET status = CASE WHEN attempts>=5 THEN 'failed' ELSE 'pending' END, lease_token = NULL, lease_expires_at = NULL,
                last_error = $2, next_attempt_at = NOW() + INTERVAL '15 minutes', updated_at = NOW()
          WHERE id = $1 AND lease_token = $3::uuid`,
        [delivery.id, String(error.message || 'delivery_failed').slice(0, 500), leaseToken]
      );
    }
  }
  await db.query(`UPDATE restaurant_loyalty_campaigns c SET status='completed', completed_at=NOW()
    WHERE c.status IN ('queued','sending') AND NOT EXISTS (
      SELECT 1 FROM restaurant_loyalty_campaign_deliveries d
      WHERE d.campaign_id=c.id AND d.status IN ('pending','sending'))`);
  return { claimed: rows.length, sent };
}

module.exports = { deliveryEnabled, normalizeCampaignInput, shape, createCampaign, approveCampaign, queueCampaign, deliverBatch };
