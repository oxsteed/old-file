'use strict';

/**
 * campaignAnalytics — campaign event tracking + performance aggregates
 * (Analytics platform, Phase 2, Item 10: embedded gaps).
 *
 * Campaigns are business_featured_placement_requests rows (one per
 * business): the thing the business requested and the admin approved, whose
 * live state is mirrored onto food_restaurants.is_featured /
 * featured_until. campaign_id = the placement request id.
 *
 * Funnel (all best-effort, fire-and-forget — see emitCampaignEvent):
 *   impression  — the effectively-featured restaurant appeared in a
 *                 discovery/search response (emitted from listRestaurants).
 *   click       — the visitor clicked the featured card (client beacon to
 *                 POST /api/food/restaurants/:id/campaign-click).
 *   conversion  — an order was placed at the effectively-featured
 *                 restaurant while the placement was live. This is
 *                 CAMPAIGN-WINDOW attribution (order inside the live window),
 *                 not proven click-through causality: we do not have
 *                 cross-session click→order stitching, so the performance
 *                 view reports it as such.
 *
 * Rates (documented, single definition):
 *   click_through_rate = clicks / impressions   (NULL when impressions = 0)
 *   conversion_rate    = conversions / clicks   (NULL when clicks = 0)
 * conversion_rate is intentionally per-click, not per-impression: it
 * answers "of the visitors who engaged, how many ordered".
 *
 * Emission contract: emitCampaignEvent NEVER rejects and NEVER awaits
 * anything on the caller's critical path. Call sites invoke it WITHOUT
 * await (same pattern as emitRestaurantOrder in foodController); if the
 * events table is missing or the insert fails, the error is swallowed so
 * analytics can never break ordering, search, or checkout.
 */

const CAMPAIGN_EVENT_TYPES = Object.freeze(['impression', 'click', 'conversion']);
const CAMPAIGN_TYPE_FEATURED_PLACEMENT = 'featured_placement';
const logger = require('../utils/logger');

function actorKeyFor(req) {
  if (req && req.user && req.user.id) return `user:${req.user.id}`;
  return null; // anonymous visitors: no PII is stored for impressions/clicks
}

/**
 * Best-effort single event insert. Returns a promise that NEVER rejects.
 */
function emitCampaignEvent(db, { campaignId, campaignType = CAMPAIGN_TYPE_FEATURED_PLACEMENT, eventType, actorKey = null, metadata = {} }) {
  if (!campaignId || !CAMPAIGN_EVENT_TYPES.includes(eventType)) return Promise.resolve(false);
  return Promise.resolve()
    .then(() => db.query(
      `INSERT INTO campaign_analytics_events
         (campaign_id, campaign_type, event_type, actor_key, metadata, dedupe_key)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)
       ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
      [campaignId, campaignType, eventType, actorKey, JSON.stringify(metadata || {}),
        eventType === 'conversion' && metadata?.order_id != null ? `${campaignType}:${campaignId}:order:${metadata.order_id}` : null]
    ))
    .then(() => true)
    .catch(error => { logger.warn('Campaign analytics event was not persisted', { eventType, code: error.code }); return false; });
}

/**
 * Best-effort batch impression insert (one row per featured restaurant in
 * a search response). NEVER rejects.
 * @param {Array<{campaignId, actorKey, metadata}>} impressions
 */
function emitCampaignImpressions(db, impressions) {
  if (!Array.isArray(impressions) || impressions.length === 0) return Promise.resolve(0);
  const clean = impressions.filter((i) => i && i.campaignId);
  if (clean.length === 0) return Promise.resolve(0);
  const values = [];
  const params = [];
  clean.forEach((imp, idx) => {
    const base = idx * 5;
    params.push(imp.campaignId, CAMPAIGN_TYPE_FEATURED_PLACEMENT, 'impression',
      imp.actorKey || null, JSON.stringify(imp.metadata || {}));
    values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}::jsonb)`);
  });
  return Promise.resolve()
    .then(() => db.query(
      `INSERT INTO campaign_analytics_events
         (campaign_id, campaign_type, event_type, actor_key, metadata)
       VALUES ${values.join(', ')}`,
      params
    ))
    .then(() => clean.length)
    .catch(error => { logger.warn('Campaign impressions were not persisted', { count: clean.length, code: error.code }); return 0; });
}

/**
 * Map effectively-featured restaurant ids to their approved placement
 * request (campaign) ids.
 * @returns {Promise<Map<number, number>>} restaurantId -> campaignId
 */
async function resolveFeaturedCampaignIds(db, restaurantIds) {
  const ids = (Array.isArray(restaurantIds) ? restaurantIds : [])
    .map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (ids.length === 0) return new Map();
  const { rows } = await db.query(
    `SELECT id, featured_restaurant_id
       FROM business_featured_placement_requests
      WHERE status = 'approved'
        AND featured_restaurant_id = ANY($1::bigint[])`,
    [ids]
  );
  const map = new Map();
  for (const r of rows) map.set(Number(r.featured_restaurant_id), Number(r.id));
  return map;
}

/**
 * Per-campaign funnel aggregates.
 * @param {object} db
 * @param {number[]} campaignIds
 * @returns {Promise<Array<{campaign_id, impressions, clicks, conversions,
 *                          click_through_rate, conversion_rate}>>}
 */
async function getCampaignPerformance(db, campaignIds) {
  const ids = (Array.isArray(campaignIds) ? campaignIds : [])
    .map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (ids.length === 0) return [];
  const { rows } = await db.query(
    `SELECT e.campaign_id,
            COUNT(*) FILTER (WHERE event_type = 'impression')::int  AS impressions,
            COUNT(*) FILTER (WHERE event_type = 'click')::int       AS clicks,
            COUNT(DISTINCT fo.id) FILTER (WHERE e.event_type='conversion'
              AND fo.payment_status='paid' AND fo.status NOT IN ('cancelled','refunded'))::int AS window_orders,
            COUNT(DISTINCT fo.id) FILTER (WHERE e.event_type='conversion'
              AND fo.payment_status='paid' AND fo.status NOT IN ('cancelled','refunded')
              AND e.actor_key='user:'||fo.customer_id::text AND EXISTS (
                SELECT 1 FROM campaign_analytics_events click
                WHERE click.campaign_id=e.campaign_id AND click.event_type='click'
                  AND click.actor_key=e.actor_key AND click.occurred_at<=fo.created_at
                  AND click.occurred_at>=fo.created_at-INTERVAL '7 days'
              ))::int AS conversions
       FROM campaign_analytics_events e
       LEFT JOIN business_featured_placement_requests p ON p.id=e.campaign_id
       LEFT JOIN food_orders fo ON e.event_type='conversion'
         AND fo.id=CASE WHEN e.metadata->>'order_id' ~ '^[0-9]{1,18}$' THEN (e.metadata->>'order_id')::bigint END
         AND fo.restaurant_id=p.featured_restaurant_id
      WHERE e.campaign_id = ANY($1::bigint[])
      GROUP BY e.campaign_id`,
    [ids]
  );
  const byId = new Map(rows.map((r) => [Number(r.campaign_id), r]));
  return ids.map((id) => {
    const r = byId.get(id);
    const impressions = r ? Number(r.impressions) : 0;
    const clicks = r ? Number(r.clicks) : 0;
    const conversions = r ? Number(r.conversions) : 0;
    return {
      campaign_id: id,
      impressions,
      clicks,
      conversions,
      window_orders: r ? Number(r.window_orders) : 0,
      attribution_days: 7,
      click_through_rate: impressions > 0 ? clicks / impressions : null,
      conversion_rate: clicks > 0 ? conversions / clicks : null,
    };
  });
}

module.exports = {
  CAMPAIGN_EVENT_TYPES,
  CAMPAIGN_TYPE_FEATURED_PLACEMENT,
  actorKeyFor,
  emitCampaignEvent,
  emitCampaignImpressions,
  resolveFeaturedCampaignIds,
  getCampaignPerformance,
};
