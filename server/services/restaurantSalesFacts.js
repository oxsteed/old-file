"use strict";

function orderFinancialsCte(locationScope) {
  const locationPredicate =
    locationScope?.mode === "assigned"
      ? "\n       AND dated.location_id = ANY($5::bigint[])"
      : "";
  return `
  WITH order_financials AS (
    SELECT dated.*,
           CASE
             WHEN COALESCE(pos.payment_count, 0) > 0
               THEN GREATEST(0, pos.collected_cents - pos.refunded_cents)
             WHEN dated.payment_status = 'paid' THEN dated.total_cents
             ELSE 0
           END::int AS net_collected_cents,
           COALESCE(pos.collected_cents, 0)::int AS collected_cents,
           COALESCE(pos.refunded_cents, 0)::int AS refunded_cents
      FROM (
        SELECT fo.*,
               COALESCE(NULLIF(loc.timezone, ''), $4) AS store_timezone,
               COALESCE(loc.day_start_hour, 0) AS store_day_start_hour,
               (((fo.created_at AT TIME ZONE COALESCE(NULLIF(loc.timezone, ''), $4))
                 - (COALESCE(loc.day_start_hour, 0) * INTERVAL '1 hour'))::date) AS business_date
          FROM food_orders fo
          LEFT JOIN restaurant_locations loc
            ON loc.id = fo.location_id AND loc.restaurant_id = fo.restaurant_id
         WHERE fo.restaurant_id = $1
      ) dated
      LEFT JOIN LATERAL (
        SELECT COUNT(*) FILTER (
                 WHERE payment_type <> 'refund' AND status IN ('recorded','captured')
               )::int AS payment_count,
               COALESCE(SUM(amount_cents) FILTER (
                 WHERE payment_type <> 'refund' AND status IN ('recorded','captured')
               ), 0)::int AS collected_cents,
               COALESCE(SUM(amount_cents) FILTER (
                 WHERE payment_type = 'refund' AND status IN ('recorded','captured','refunded')
               ), 0)::int AS refunded_cents
          FROM restaurant_pos_payments p
         WHERE p.food_order_id = dated.id
      ) pos ON TRUE
     WHERE dated.business_date >= $2::date
       AND dated.business_date < ($3::date + 1)${locationPredicate}
  )`;
}
module.exports = { orderFinancialsCte };
