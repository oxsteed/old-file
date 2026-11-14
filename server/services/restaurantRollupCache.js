'use strict';

// Phase 7 (gap 20): cached HQ rollups with documented staleness.
//
// The HQ labor rollup runs one full labor computation per store in
// sequence; at 10+ stores that is slow enough to time out mid-service
// while competing with POS writes on the same tables. This cache keeps
// one computed rollup per (restaurant, location scope, date range,
// kind) for ROLLUP_TTL_SECONDS and every read reports whether it
// served cached data, when it was computed, and when it goes stale —
// a manager never mistakes a 14-minute-old rollup for live numbers.
// The cache is time-based only: there is no invalidation hook, by
// design (labor inputs change constantly during service; chasing
// invalidation would reintroduce the live-computation cost). The
// response always carries `is_cached`, `computed_at`, and
// `stale_after_seconds` so the staleness is visible, not hidden.

const ROLLUP_TTL_SECONDS = 900; // 15 minutes

// A cached row is only served when its payload is a rollup of the
// shape the HQ endpoint returns ({ scope, totals, stores }). Anything
// else (a half-written row, a row from an older schema, or a caller
// whose query layer returned unrelated rows) is treated as a cache
// miss and recomputed: serving a malformed payload would silently
// break the endpoint instead of costing one recomputation.
function isRollupPayload(payload) {
  return payload != null && typeof payload === 'object'
    && Array.isArray(payload.stores)
    && payload.totals != null && typeof payload.totals === 'object';
}

async function getCachedRollup(db, {
  restaurantId, locationId = null, fromDate, toDate, kind, compute,
} = {}) {
  const { rows: [cached] } = await db.query(
    `SELECT * FROM restaurant_daily_rollups
      WHERE restaurant_id = $1
        AND location_id IS NOT DISTINCT FROM $2::bigint
        AND from_date = $3::date AND to_date = $4::date AND kind = $5
        AND expires_at > NOW()`,
    [restaurantId, locationId, fromDate, toDate, kind]
  );
  if (cached && isRollupPayload(cached.payload)) {
    return {
      payload: cached.payload,
      is_cached: true,
      computed_at: cached.computed_at,
      expires_at: cached.expires_at,
      stale_after_seconds: ROLLUP_TTL_SECONDS,
    };
  }
  const payload = await compute();
  const { rows: [row] } = await db.query(
    `INSERT INTO restaurant_daily_rollups
       (restaurant_id, location_id, from_date, to_date, kind,
        currency_code, payload, expires_at)
     VALUES ($1, $2, $3::date, $4::date, $5, $6, $7::jsonb,
             NOW() + ($8::int * INTERVAL '1 second'))
     ON CONFLICT (restaurant_id, location_id, from_date, to_date, kind)
       DO UPDATE SET payload = EXCLUDED.payload,
                     currency_code = EXCLUDED.currency_code,
                     computed_at = NOW(),
                     expires_at = EXCLUDED.expires_at
     RETURNING *`,
    [
      restaurantId, locationId, fromDate, toDate, kind,
      payload?.currency || payload?.totals?.currency || null,
      JSON.stringify(payload), ROLLUP_TTL_SECONDS,
    ]
  );
  // The upsert returns the stored row; if the caller cannot return
  // it (a stubbed query layer), fall back to now so the response
  // still states when the rollup was computed.
  const computedAt = row?.computed_at || new Date().toISOString();
  const expiresAt = row?.expires_at || new Date(Date.now() + ROLLUP_TTL_SECONDS * 1000).toISOString();
  return {
    payload,
    is_cached: false,
    computed_at: computedAt,
    expires_at: expiresAt,
    stale_after_seconds: ROLLUP_TTL_SECONDS,
  };
}

// Domain 8 #29: cached rows carry a 15-minute TTL but nothing ever
// deleted them, so every distinct (restaurant, location, date range,
// kind) queried left a permanent row. The nightly scheduler prunes
// rows expired beyond a 1-hour grace period, so a read that started
// just before expiry still sees its row; each run is bounded by LIMIT.
async function pruneExpiredRollups(db, { limit = 1000 } = {}) {
  const { rowCount } = await db.query(
    `DELETE FROM restaurant_daily_rollups
      WHERE ctid IN (
        SELECT ctid FROM restaurant_daily_rollups
         WHERE expires_at < NOW() - INTERVAL '1 hour'
         ORDER BY expires_at ASC
         LIMIT $1
      )`,
    [limit]
  );
  return { pruned: rowCount || 0 };
}

module.exports = { getCachedRollup, pruneExpiredRollups, ROLLUP_TTL_SECONDS };
