'use strict';

/**
 * server/services/pricingSignals.js
 *
 * Phase 4b — input signals consumed by the pricingEngine.
 *
 * Two functions:
 *   getCustomerSegment({ userId, businessId })     -> 'new' | 'returning' | 'vip' | 'loyalty_tier_X'
 *   computeDemandSignal({ kind, businessId, targetId, atTimeIso }) -> 0..1
 *
 * Both are cached for 10 minutes per (key) in a process-local Map.
 * The cache is intentionally simple: pricing decisions don't need to
 * be globally consistent across replicas at sub-minute resolution.
 */

const pool = require('../db');
const logger = require('../utils/logger');

const TTL_MS = 10 * 60 * 1000;
const MAX_CACHE_ENTRIES = 5000;
const segmentCache = new Map(); // key: `${userId}|${businessId}` -> { value, exp }
const demandCache  = new Map(); // key: `${kind}|${businessId}|${targetId}|${dayBucket}` -> { value, exp }

function _cacheGet(map, key) {
  const e = map.get(key);
  if (!e) return null;
  if (e.exp < Date.now()) { map.delete(key); return null; }
  return e.value;
}
function _cachePut(map, key, value) {
  // V2-P1-06: size bound — evict oldest-inserted when full.
  if (!map.has(key) && map.size >= MAX_CACHE_ENTRIES) {
    map.delete(map.keys().next().value);
  }
  map.set(key, { value, exp: Date.now() + TTL_MS });
  return value;
}

/**
 * Classify a customer's relationship to a specific business.
 *
 *   new            -> never booked / purchased
 *   returning      -> 1-4 prior orders/appointments (any status)
 *   vip            -> 5+ prior orders/appointments OR row in customer_loyalty_segments at tier 'vip'
 *   loyalty_tier_* -> custom tier from customer_loyalty_segments (when migration 224 applied)
 */
async function getCustomerSegment({ userId, businessId }) {
  if (!userId || !businessId) return 'new';
  const key = `${userId}|${businessId}`;
  const hit = _cacheGet(segmentCache, key);
  if (hit) return hit;

  try {
    // 1) Check customer_loyalty_segments first (richer schema if present)
    const loyalty = await pool.query(
      `SELECT tier FROM customer_loyalty_segments
        WHERE business_id = $1 AND user_id = $2
        LIMIT 1`,
      [businessId, userId]
    ).catch(() => ({ rows: [] }));
    if (loyalty.rows[0] && loyalty.rows[0].tier) {
      return _cachePut(segmentCache, key, `loyalty_tier_${loyalty.rows[0].tier}`);
    }

    // 2) Count prior interactions across appointments + orders
    const counts = await pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM business_appointments
            WHERE business_id = $1 AND customer_id = $2) AS appt_count,
         (SELECT COUNT(*)::int FROM marketplace_orders mo
           WHERE mo.customer_id = $2
             AND EXISTS (
               SELECT 1 FROM marketplace_order_items oi
                JOIN marketplace_products mp ON mp.id = oi.product_id
               WHERE oi.order_id = mo.id AND mp.source_business_id = $1
             )) AS order_count`,
      [businessId, userId]
    ).catch(() => ({ rows: [{ appt_count: 0, order_count: 0 }] }));

    const total = (counts.rows[0].appt_count || 0) + (counts.rows[0].order_count || 0);
    let segment;
    if (total === 0) segment = 'new';
    else if (total >= 5) segment = 'vip';
    else segment = 'returning';
    return _cachePut(segmentCache, key, segment);
  } catch (err) {
    logger.warn('getCustomerSegment failed', { userId, businessId, err: err.message });
    return 'new';
  }
}

/**
 * Demand signal in [0..1].
 *
 * For services: today's booked-slot ratio for the service.
 *   booked_slots / (booked + estimated_remaining_slots_today)
 * Approximated as: count(appointments today) / max(1, max_capacity * 8)
 * (8 hours of slots/day is the assumed cap when we don't know availability).
 *
 * For products: 1 - (available_stock / max(1, total_stock_seen_recently))
 * Approximated as: 1 - (quantity_available / GREATEST(1, original_stock_estimate)).
 *
 * Returns 0 on any error (no surge).
 */
async function computeDemandSignal({ kind, businessId, targetId, atTimeIso }) {
  if (!kind || !businessId || !targetId) return 0;
  const at = atTimeIso ? new Date(atTimeIso) : new Date();
  const dayBucket = `${at.getUTCFullYear()}-${at.getUTCMonth()}-${at.getUTCDate()}`;
  const key = `${kind}|${businessId}|${targetId}|${dayBucket}`;
  const hit = _cacheGet(demandCache, key);
  if (hit != null) return hit;

  try {
    if (kind === 'service') {
      const dayStart = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
      const dayEnd   = new Date(dayStart.getTime() + 24 * 3600 * 1000);
      const r = await pool.query(
        `SELECT
            (SELECT max_capacity FROM business_services WHERE id = $1)::int AS capacity,
            (SELECT COUNT(*)::int FROM business_appointments
               WHERE service_id = $1
                 AND status = ANY(ARRAY['pending','confirmed','in_progress','completed'])
                 AND start_time >= $2 AND start_time < $3) AS booked`,
        [targetId, dayStart.toISOString(), dayEnd.toISOString()]
      );
      const cap = Math.max(1, Number(r.rows[0].capacity) || 1);
      const booked = Number(r.rows[0].booked) || 0;
      // Assume ~8 slots per staff per day worst case.
      const estimatedDailySlots = Math.max(1, cap * 8);
      const fraction = Math.min(1, booked / estimatedDailySlots);
      return _cachePut(demandCache, key, fraction);
    }

    if (kind === 'product') {
      const r = await pool.query(
        `SELECT mp.quantity_available, mp.reserved_quantity
           FROM marketplace_products mp
          WHERE mp.business_product_id = $1
          LIMIT 1`,
        [targetId]
      );
      if (!r.rows[0]) return _cachePut(demandCache, key, 0);
      const avail = Math.max(0, Number(r.rows[0].quantity_available) || 0);
      const reserved = Math.max(0, Number(r.rows[0].reserved_quantity) || 0);
      const totalSeen = Math.max(1, avail + reserved + 1);
      const free = Math.max(0, avail - reserved);
      const demand = 1 - (free / totalSeen);
      return _cachePut(demandCache, key, Math.max(0, Math.min(1, demand)));
    }

    return 0;
  } catch (err) {
    logger.warn('computeDemandSignal failed', { kind, businessId, targetId, err: err.message });
    return 0;
  }
}

function _clearCaches() {
  segmentCache.clear();
  demandCache.clear();
}

module.exports = { getCustomerSegment, computeDemandSignal, _clearCaches };
