'use strict';

/**
 * Growth Center link analytics (analytics platform, Area 5: campaign breadth).
 *
 * Replaces the Promote page's browser-local counter with durable,
 * owner-scoped events:
 *   share — the owner copied/shared a tracked post, link, card or signature
 *           from the Promote page (authenticated, recorded for that owner).
 *   visit — a visitor landed on the owner's public profile through a tracked
 *           link (ref=growth_center plus utm_* parameters).
 *
 * Definitions (single source, used by the Performance tab):
 *   visits_per_share = visits / shares for the same source (NULL when no shares).
 * A visit is counted at most once per visitor, owner, source, campaign and UTC
 * day. Owners' own visits and visits without a device key are not counted.
 * This measures link reach, not bookings: booking attribution needs a
 * checkout-side join that does not exist for helper/business profiles.
 *
 * Emission never rejects: analytics must not break profile pages or copying.
 */

const crypto = require('crypto');
const logger = require('../utils/logger');

const SLUG_RE = /^[a-z0-9_-]{1,60}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WINDOWS = Object.freeze([7, 30, 90, 365]);
const RETENTION_DAYS = 730;

function slug(value, fallback = null) {
  if (value == null || value === '') return fallback;
  const clean = String(value).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
  return SLUG_RE.test(clean) ? clean : fallback;
}

function campaignName(value) {
  if (value == null) return null;
  // Control characters are stripped; the value is displayed as text only.
  const clean = String(value).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 80);
  return clean || null;
}

function normalizeEvent(input = {}) {
  return {
    source: slug(input.source, 'other'),
    medium: slug(input.medium),
    campaign: campaignName(input.campaign),
    content: slug(input.content),
  };
}

function ownerColumns(owner) {
  if (owner?.type === 'business' && Number.isSafeInteger(owner.businessId) && owner.businessId > 0) {
    return { ownerType: 'business', ownerUserId: null, businessId: owner.businessId };
  }
  if (owner?.type === 'helper' && UUID_RE.test(String(owner.userId || ''))) {
    return { ownerType: 'helper', ownerUserId: String(owner.userId), businessId: null };
  }
  throw new Error('Invalid promotion owner');
}

function visitorHash(owner, visitorId) {
  return crypto.createHash('sha256')
    .update(`promotion-visit:${owner.ownerType}:${owner.ownerUserId || owner.businessId}:${visitorId}`)
    .digest('hex');
}

async function insertEvent(db, owner, eventType, event, { actorKey = null, dedupeKey = null } = {}) {
  const { rowCount } = await db.query(
    `INSERT INTO promotion_link_events
       (owner_type, owner_user_id, business_id, event_type, source, medium, campaign, content, actor_key, dedupe_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
    [owner.ownerType, owner.ownerUserId, owner.businessId, eventType,
      event.source, event.medium, event.campaign, event.content, actorKey, dedupeKey]
  );
  return rowCount > 0;
}

/** Record an owner's share action. Caller has already authorized the owner. */
async function recordShare(db, ownerInput, input) {
  return insertEvent(db, ownerColumns(ownerInput), 'share', normalizeEvent(input));
}

/**
 * Record a public landing visit. Never rejects; returns true when a new
 * visit was stored. `viewerUserId`/`viewerIsMember` exclude the owner's own
 * visits.
 */
async function recordVisit(db, ownerInput, input = {}, { viewerUserId = null, isOwnerViewer = async () => false } = {}) {
  try {
    const owner = ownerColumns(ownerInput);
    const visitorId = String(input.visitorId || '');
    if (!UUID_RE.test(visitorId)) return false;
    if (viewerUserId && await isOwnerViewer(owner, viewerUserId)) return false;
    const exists = owner.ownerType === 'business'
      ? await db.query('SELECT 1 FROM businesses WHERE id=$1 AND deleted_at IS NULL', [owner.businessId])
      : await db.query('SELECT 1 FROM users WHERE id=$1 AND COALESCE(is_banned,false)=false', [owner.ownerUserId]);
    if (!exists.rows.length) return false;
    const event = normalizeEvent(input);
    const actorKey = visitorHash(owner, visitorId);
    const day = new Date().toISOString().slice(0, 10);
    const dedupeKey = `visit:${actorKey}:${event.source}:${event.campaign || ''}:${day}`.slice(0, 400);
    return await insertEvent(db, owner, 'visit', event, { actorKey, dedupeKey });
  } catch (error) {
    logger.warn('Promotion visit was not persisted', { code: error.code || error.message });
    return false;
  }
}

function windowDays(value) {
  const days = Number.parseInt(value, 10);
  return WINDOWS.includes(days) ? days : 30;
}

/** Owner-scoped performance summary for the Promote page. */
async function promotionPerformance(db, ownerInput, { days } = {}) {
  const owner = ownerColumns(ownerInput);
  const window = windowDays(days);
  const ownerSql = owner.ownerType === 'business'
    ? "owner_type='business' AND business_id=$1" : "owner_type='helper' AND owner_user_id=$1::uuid";
  const params = [owner.ownerType === 'business' ? owner.businessId : owner.ownerUserId, window];
  const scoped = `FROM promotion_link_events WHERE ${ownerSql} AND occurred_at >= NOW() - make_interval(days => $2)`;
  const [sources, mediums, campaigns, totals] = await Promise.all([
    db.query(`SELECT source, COUNT(*) FILTER (WHERE event_type='share')::int AS shares,
        COUNT(*) FILTER (WHERE event_type='visit')::int AS visits
      ${scoped} GROUP BY source ORDER BY visits DESC, shares DESC, source`, params),
    db.query(`SELECT source, COALESCE(medium,'') AS medium, COUNT(*) FILTER (WHERE event_type='share')::int AS shares,
        COUNT(*) FILTER (WHERE event_type='visit')::int AS visits
      ${scoped} GROUP BY 1,2 ORDER BY 1,2`, params),
    db.query(`SELECT campaign, COUNT(*) FILTER (WHERE event_type='visit')::int AS visits,
        COUNT(*) FILTER (WHERE event_type='share')::int AS shares
      ${scoped} AND campaign IS NOT NULL GROUP BY campaign ORDER BY visits DESC, shares DESC, campaign LIMIT 50`, params),
    db.query(`SELECT COUNT(*) FILTER (WHERE event_type='share')::int AS shares,
        COUNT(*) FILTER (WHERE event_type='visit')::int AS visits,
        MIN(occurred_at) AS first_event_at ${scoped}`, params),
  ]);
  const ratio = (visits, shares) => (shares > 0 ? Math.round((visits / shares) * 100) / 100 : null);
  const byMedium = new Map();
  for (const row of mediums.rows) {
    if (!byMedium.has(row.source)) byMedium.set(row.source, []);
    byMedium.get(row.source).push({ medium: row.medium || null, shares: row.shares, visits: row.visits });
  }
  const total = totals.rows[0] || { shares: 0, visits: 0, first_event_at: null };
  return {
    window_days: window,
    totals: { shares: total.shares || 0, visits: total.visits || 0, visits_per_share: ratio(total.visits || 0, total.shares || 0) },
    first_event_at: total.first_event_at || null,
    sources: sources.rows.map(row => ({ ...row, visits_per_share: ratio(row.visits, row.shares), mediums: byMedium.get(row.source) || [] })),
    campaigns: campaigns.rows,
  };
}

async function prunePromotionLinkEvents(db, days = RETENTION_DAYS) {
  const { rowCount } = await db.query(
    'DELETE FROM promotion_link_events WHERE occurred_at < NOW() - make_interval(days => $1)', [days]);
  return rowCount;
}

module.exports = {
  WINDOWS, RETENTION_DAYS, normalizeEvent, recordShare, recordVisit, promotionPerformance, prunePromotionLinkEvents,
};
