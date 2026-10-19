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
 *
 * Conversions (migrations 909, 910): a booking request, business appointment,
 * food order or marketplace job hire attributed to the visitor's latest
 * tracked visit to the same owner in the previous ATTRIBUTION_DAYS (last
 * touch, visit before conversion). One conversion per booking/appointment/
 * order/job (hashed reference dedupe). Owners and their team converting on
 * their own profile are excluded. A job hire counts for the business whose
 * owner or active member was hired (decision 2).
 * Visitor identity (decision 3): the visit's consent-aware device id
 * (persistent only with analytics consent, otherwise per tab). For a
 * signed-in visitor WITHOUT analytics consent, the visit also stores a
 * per-owner hash of the account id (account_key), so a later conversion by the
 * same signed-in account links within the 7-day window; the account key is
 * cleared after that window by the retention job. No persistent device id is
 * stored without consent.
 * Gross vs net (decision 1): conversions = gross (every attributed
 * conversion); net_conversions = gross minus conversions whose booking,
 * appointment, order or job was later cancelled or refunded (reversed_at, set by
 * migration 910 triggers). conversion_rate = conversions / visits and
 * net_conversion_rate = net_conversions / visits for the same grouping.
 *
 * Emission never rejects: analytics must not break profile pages or copying.
 */

const crypto = require('crypto');
const logger = require('../utils/logger');

const SLUG_RE = /^[a-z0-9_-]{1,60}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WINDOWS = Object.freeze([7, 30, 90, 365]);
const RETENTION_DAYS = 730;
const ATTRIBUTION_DAYS = 7;
const CONVERSION_TYPES = Object.freeze(['booking', 'appointment', 'order', 'job']);

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

// Decision 3: per-owner hash of a signed-in account id (non-consent visits).
function accountHash(owner, userId) {
  return crypto.createHash('sha256')
    .update(`promotion-account:${owner.ownerType}:${owner.ownerUserId || owner.businessId}:${userId}`)
    .digest('hex');
}

async function insertEvent(db, owner, eventType, event, { actorKey = null, dedupeKey = null, accountKey = null } = {}) {
  const { rowCount } = await db.query(
    `INSERT INTO promotion_link_events
       (owner_type, owner_user_id, business_id, event_type, source, medium, campaign, content, actor_key, dedupe_key, account_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
    [owner.ownerType, owner.ownerUserId, owner.businessId, eventType,
      event.source, event.medium, event.campaign, event.content, actorKey, dedupeKey, accountKey]
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
  // Decision 3: only a signed-in visitor without analytics consent gets an
  // account link; with consent the persistent device id is used instead.
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
    const accountKey = viewerUserId && UUID_RE.test(String(viewerUserId)) && input.analyticsConsent !== true
      ? accountHash(owner, String(viewerUserId)) : null;
    return await insertEvent(db, owner, 'visit', event, { actorKey, dedupeKey, accountKey });
  } catch (error) {
    logger.warn('Promotion visit was not persisted', { code: error.code || error.message });
    return false;
  }
}

// Source rows already cancelled/refunded when the conversion is written (the
// hook runs after the response, so a fast cancellation can come first).
const REVERSED_STATE_SQL = Object.freeze({
  booking: `SELECT CASE WHEN status IN ('cancelled','accepted_cancelled') THEN 'cancelled'
                 WHEN payment_status = 'refunded' OR refunded_at IS NOT NULL THEN 'refunded' END AS reason
              FROM booking_requests WHERE id = $1::uuid`,
  appointment: `SELECT CASE WHEN status = 'cancelled' THEN 'cancelled' WHEN payment_status = 'refunded' THEN 'refunded' END AS reason
                  FROM business_appointments WHERE id = $1::uuid`,
  order: `SELECT CASE WHEN status = 'cancelled' THEN 'cancelled'
               WHEN status = 'refunded' OR payment_status = 'refunded' OR refunded_at IS NOT NULL THEN 'refunded' END AS reason
            FROM food_orders WHERE id = $1::bigint`,
  job: `SELECT CASE WHEN status::text = 'cancelled' THEN 'cancelled' END AS reason FROM jobs WHERE id = $1::uuid`,
});

/**
 * Attribute a conversion to the visitor's latest tracked visit. `ownerInput`
 * is one owner or a list of candidate owners (job hires: every business the
 * hired helper belongs to); the latest matching visit across them wins and
 * the conversion is counted once. A visit matches by the device id or, for
 * non-consent visits, by the signed-in account (decision 3).
 * Never rejects; returns true when a new conversion was stored.
 */
async function recordConversion(db, ownerInput, { visitorId, accountUserId = null, conversionType, referenceId, converterUserId = null } = {},
  { isOwnerViewer = async () => false } = {}) {
  try {
    if (!CONVERSION_TYPES.includes(conversionType) || referenceId == null || referenceId === '') return false;
    const deviceId = UUID_RE.test(String(visitorId || '')) ? String(visitorId) : null;
    const accountId = accountUserId && UUID_RE.test(String(accountUserId)) ? String(accountUserId) : null;
    if (!deviceId && !accountId) return false;
    const owners = [];
    for (const input of [].concat(ownerInput || [])) {
      let owner;
      try { owner = ownerColumns(input); } catch { continue; }
      if (owners.some(o => o.ownerType === owner.ownerType && String(o.ownerUserId || o.businessId) === String(owner.ownerUserId || owner.businessId))) continue;
      if (converterUserId && await isOwnerViewer(owner, converterUserId)) continue;
      owners.push(owner);
    }
    if (!owners.length) return false;
    const params = [ATTRIBUTION_DAYS];
    const clauses = owners.map((owner) => {
      params.push(owner.ownerType === 'business' ? owner.businessId : owner.ownerUserId);
      const ownerSql = owner.ownerType === 'business'
        ? `owner_type='business' AND business_id=$${params.length}` : `owner_type='helper' AND owner_user_id=$${params.length}::uuid`;
      const keys = [];
      if (deviceId) { params.push(visitorHash(owner, deviceId)); keys.push(`actor_key=$${params.length}`); }
      if (accountId) { params.push(accountHash(owner, accountId)); keys.push(`account_key=$${params.length}`); }
      return `(${ownerSql} AND (${keys.join(' OR ')}))`;
    });
    const { rows: [visit] } = await db.query(
      `SELECT id, owner_type, owner_user_id, business_id, actor_key, source, medium, campaign, content FROM promotion_link_events
        WHERE event_type='visit' AND (${clauses.join(' OR ')})
          AND occurred_at >= NOW() - make_interval(days => $1) AND occurred_at <= NOW()
        ORDER BY occurred_at DESC, id DESC LIMIT 1`,
      params
    );
    if (!visit) return false;
    const refHash = crypto.createHash('sha256').update(`${conversionType}:${referenceId}`).digest('hex');
    const reversed = await db.query(REVERSED_STATE_SQL[conversionType], [String(referenceId)])
      .then(r => r.rows[0]?.reason || null).catch(() => null);
    const { rowCount } = await db.query(
      `INSERT INTO promotion_link_events
         (owner_type, owner_user_id, business_id, event_type, source, medium, campaign, content, actor_key, dedupe_key,
          conversion_type, attributed_visit_id, reversed_at, reversal_reason)
       VALUES ($1,$2,$3,'conversion',$4,$5,$6,$7,$8,$9,$10,$11,CASE WHEN $12::text IS NULL THEN NULL ELSE NOW() END,$12)
       ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
      [visit.owner_type, visit.owner_user_id, visit.business_id, visit.source, visit.medium, visit.campaign, visit.content,
        visit.actor_key, `conversion:${refHash}`, conversionType, visit.id, reversed]
    );
    return rowCount > 0;
  } catch (error) {
    logger.warn('Promotion conversion was not persisted', { code: error.code || error.message });
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
        COUNT(*) FILTER (WHERE event_type='visit')::int AS visits,
        COUNT(*) FILTER (WHERE event_type='conversion')::int AS conversions,
        COUNT(*) FILTER (WHERE event_type='conversion' AND reversed_at IS NULL)::int AS net_conversions
      ${scoped} GROUP BY source ORDER BY visits DESC, shares DESC, source`, params),
    db.query(`SELECT source, COALESCE(medium,'') AS medium, COUNT(*) FILTER (WHERE event_type='share')::int AS shares,
        COUNT(*) FILTER (WHERE event_type='visit')::int AS visits,
        COUNT(*) FILTER (WHERE event_type='conversion')::int AS conversions,
        COUNT(*) FILTER (WHERE event_type='conversion' AND reversed_at IS NULL)::int AS net_conversions
      ${scoped} GROUP BY 1,2 ORDER BY 1,2`, params),
    db.query(`SELECT campaign, COUNT(*) FILTER (WHERE event_type='visit')::int AS visits,
        COUNT(*) FILTER (WHERE event_type='share')::int AS shares,
        COUNT(*) FILTER (WHERE event_type='conversion')::int AS conversions,
        COUNT(*) FILTER (WHERE event_type='conversion' AND reversed_at IS NULL)::int AS net_conversions
      ${scoped} AND campaign IS NOT NULL GROUP BY campaign ORDER BY visits DESC, shares DESC, campaign LIMIT 50`, params),
    db.query(`SELECT COUNT(*) FILTER (WHERE event_type='share')::int AS shares,
        COUNT(*) FILTER (WHERE event_type='visit')::int AS visits,
        COUNT(*) FILTER (WHERE event_type='conversion')::int AS conversions,
        COUNT(*) FILTER (WHERE event_type='conversion' AND conversion_type='booking')::int AS bookings,
        COUNT(*) FILTER (WHERE event_type='conversion' AND conversion_type='appointment')::int AS appointments,
        COUNT(*) FILTER (WHERE event_type='conversion' AND conversion_type='order')::int AS orders,
        COUNT(*) FILTER (WHERE event_type='conversion' AND conversion_type='job')::int AS jobs,
        COUNT(*) FILTER (WHERE event_type='conversion' AND reversed_at IS NULL)::int AS net_conversions,
        COUNT(*) FILTER (WHERE event_type='conversion' AND reversed_at IS NOT NULL AND reversal_reason='cancelled')::int AS cancelled,
        COUNT(*) FILTER (WHERE event_type='conversion' AND reversed_at IS NOT NULL AND reversal_reason='refunded')::int AS refunded,
        MIN(occurred_at) AS first_event_at ${scoped}`, params),
  ]);
  const ratio = (visits, shares) => (shares > 0 ? Math.round((visits / shares) * 100) / 100 : null);
  const rate = (conversions, visits) => (visits > 0 ? Math.round((1000 * (conversions || 0)) / visits) / 10 : null);
  const byMedium = new Map();
  for (const row of mediums.rows) {
    if (!byMedium.has(row.source)) byMedium.set(row.source, []);
    byMedium.get(row.source).push({ medium: row.medium || null, shares: row.shares, visits: row.visits,
      conversions: row.conversions || 0, net_conversions: row.net_conversions || 0 });
  }
  const total = totals.rows[0] || { shares: 0, visits: 0, conversions: 0, first_event_at: null };
  return {
    window_days: window,
    attribution_days: ATTRIBUTION_DAYS,
    totals: {
      shares: total.shares || 0, visits: total.visits || 0, visits_per_share: ratio(total.visits || 0, total.shares || 0),
      conversions: total.conversions || 0, conversion_rate_pct: rate(total.conversions, total.visits || 0),
      net_conversions: total.net_conversions || 0, net_conversion_rate_pct: rate(total.net_conversions, total.visits || 0),
      reversed: { cancelled: total.cancelled || 0, refunded: total.refunded || 0 },
      by_type: { booking: total.bookings || 0, appointment: total.appointments || 0, order: total.orders || 0, job: total.jobs || 0 },
    },
    first_event_at: total.first_event_at || null,
    sources: sources.rows.map(row => ({ ...row, conversions: row.conversions || 0, net_conversions: row.net_conversions || 0,
      visits_per_share: ratio(row.visits, row.shares),
      conversion_rate_pct: rate(row.conversions, row.visits), net_conversion_rate_pct: rate(row.net_conversions, row.visits),
      mediums: byMedium.get(row.source) || [] })),
    campaigns: campaigns.rows.map(row => ({ ...row, conversions: row.conversions || 0, net_conversions: row.net_conversions || 0,
      conversion_rate_pct: rate(row.conversions, row.visits), net_conversion_rate_pct: rate(row.net_conversions, row.visits) })),
  };
}

// Decision 3: account links live only for the attribution window. Runs
// hourly, and again with the daily retention prune.
async function clearExpiredAccountLinks(db) {
  const { rowCount } = await db.query(
    `UPDATE promotion_link_events SET account_key = NULL
      WHERE account_key IS NOT NULL AND occurred_at < NOW() - make_interval(days => $1)`, [ATTRIBUTION_DAYS]);
  return rowCount;
}

async function prunePromotionLinkEvents(db, days = RETENTION_DAYS) {
  await clearExpiredAccountLinks(db);
  const { rowCount } = await db.query(
    'DELETE FROM promotion_link_events WHERE occurred_at < NOW() - make_interval(days => $1)', [days]);
  return rowCount;
}

module.exports = {
  WINDOWS, RETENTION_DAYS, ATTRIBUTION_DAYS, CONVERSION_TYPES, normalizeEvent, recordShare, recordVisit, recordConversion,
  promotionPerformance, prunePromotionLinkEvents, clearExpiredAccountLinks, accountHash, visitorHash,
};
