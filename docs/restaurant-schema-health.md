# Restaurant schema health / migration checklist

## Purpose

Keep `food_restaurants` (and tightly related columns) aligned with what
production code expects for:

- Business list enrichment (`server/utils/businessListRestaurantEnrichment.js`)
- Business↔restaurant linking / publish (`businessController`)
- Merchant restaurant reads/writes (`foodController`, restaurant* controllers)
- Public discovery / kiosk visibility filters

**Do not** re-join `food_restaurants` into core `listBusinesses` /
`listManagedBusinesses` SQL. Enrichment stays best-effort and post-query.

## Canonical column names

| Expected by code | Source migration(s) | Notes |
| --- | --- | --- |
| `status` | 305 | `draft` / `active` / `paused` / `suspended` |
| `accepts_online_orders` | 305 | Always selected by enrichment |
| `discovery_status` | 351 | **Canonical spelling.** Not `discovery_staus` / `discover_status` |
| `is_accepting_orders_now` | 351 | Enrichment + discovery orderability |
| `dietary_tags` | 345, also 350 | TEXT[] |
| `avg_rating`, `rating_count`, `price_level`, `estimated_delivery_minutes` | 350 | Discovery cards |
| `is_featured`, `featured_rank`, `temporarily_closed_until`, fee/radius/order stats | 351 | Ranking / ops |
| `brand_accent_hex`, `operating_hours`, `is_verified` | 318 | Merchant / list display |
| `delivery_radius_meters`, `tax_rate_bps`, `service_fee_bps`, `online_order_pause_reason` | 321 | Ops (distinct from 351 `service_area_radius_meters`) |

## Migration checklist (apply in order)

1. `305_oxsteed_food.sql` — create `food_restaurants`
2. `318_food_growth_ops.sql` — brand / hours / verified
3. `321_restaurant_app_flow_backend.sql` — tax / delivery radius / pause reason
4. `345_food_restaurant_dietary_tags.sql` — dietary tags
5. `350_food_restaurant_discovery_fields.sql` — ratings / price / dietary (idempotent overlap with 345)
6. `351_food_restaurant_discovery_operations.sql` — discovery ops columns + indexes
7. **`539_food_restaurants_schema_health.sql`** — idempotent re-assert of the above columns, constraints, indexes, and unique `business_id` when safe

539 is safe to run even when 318–351 already applied (`ADD COLUMN IF NOT EXISTS`).

## Runtime hardening (no live DB required)

| Path | Behavior if columns lag |
| --- | --- |
| `GET /api/businesses`, `/managed` | Core query never joins `food_restaurants`. Enrichment tries full summary → baseline (`id`/`status`/`accepts_online_orders`) → null restaurant_* fields. Always 200 when businesses exist. |
| `POST .../onboarding/complete` (restaurant) | Tries `status` + `discovery_status`; retries `status` only on undefined column. |
| `PATCH` restaurant status | Retries without `discovery_status` assignment if that column is missing. |
| Public kiosk config | Retries visibility query without `discovery_status` filter. |
| Food discovery list | Existing `isMissingRelationError` fallback in `foodController`. |

## Linking invariant

Code treats one restaurant per `business_id` (`LIMIT 1`, draft ensure, create-if-missing).
539 adds `idx_food_restaurants_business_unique` **only when no duplicate `business_id` rows exist**.

## QA

- `server/__tests__/businessListRestaurantEnrichment.test.js` — success, missing table, missing newer column → baseline
- `server/__tests__/foodRestaurantsSchemaHealth.test.js` — migration 539 SQL sanity

## Residuals

- Customer mobile discovery still filters on `discovery_status` without a baseline retry in every path; run migration 539 before relying on those endpoints on lagged DBs.
- Duplicate `business_id` rows block the unique index until cleaned manually.
- Full restaurant product rewrite is out of scope.
