-- Migration 20261107140001: explicit franchise store-to-agreement mapping
-- (design-review item 44).
--
-- Until now a store was attributed to a franchise agreement by matching
-- city/region text (LOWER(TRIM(desired_city)) = city OR region), with the
-- most recently updated agreement winning. When two launched agreements
-- covered the same city, the most recent won and the store's royalty and
-- marketing fee were attributed to the wrong franchisee. That string
-- match is gone from reporting: a store now maps to its agreement
-- explicitly, one agreement per location.
--
-- Grain: location-level. The report attributes per location, a location
-- belongs to exactly one restaurant, and nothing in the model lets one
-- location belong to more than one agreement, so UNIQUE (location_id)
-- is the constraint. Restaurant-level would be wrong: two stores of one
-- restaurant in different cities can belong to different franchisees.
--
-- Backfill: every non-archived location that the old deterministic rule
-- matched keeps that winner as its starting explicit mapping (exact city
-- outranks region, then most recently updated agreement, then lowest
-- application id). Where the old rule was ambiguous (more than one
-- launched agreement matched the same location) the same winner is kept
-- AND the row is flagged ambiguous with the candidate count, so the
-- ambiguity is visible in the report instead of silently picked.
-- Locations the old rule matched nothing for stay unmapped; the report
-- lists them as unmapped instead of dropping them. The insert is
-- ON CONFLICT DO NOTHING so re-running this file never overwrites a
-- mapping an operator has since assigned by hand.

CREATE TABLE IF NOT EXISTS franchise_location_agreements (
  id BIGSERIAL PRIMARY KEY,
  location_id BIGINT NOT NULL UNIQUE REFERENCES restaurant_locations(id) ON DELETE CASCADE,
  agreement_id UUID NOT NULL REFERENCES franchise_agreements(id) ON DELETE CASCADE,
  source VARCHAR(16) NOT NULL DEFAULT 'manual'
    CHECK (source IN ('backfill', 'manual')),
  ambiguous BOOLEAN NOT NULL DEFAULT FALSE,
  ambiguous_candidate_count INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_franchise_location_agreements_agreement
  ON franchise_location_agreements (agreement_id);

WITH matched AS (
  SELECT
    loc.id AS location_id,
    fagr.id AS agreement_id,
    CASE WHEN btrim(loc.address_city) <> ''
              AND LOWER(TRIM(COALESCE(fa.desired_city, ''))) = LOWER(TRIM(loc.address_city))
         THEN 0 ELSE 1 END AS city_rank,
    fagr.updated_at AS agreement_updated_at,
    fa.id AS application_id,
    COUNT(*) OVER (PARTITION BY loc.id) AS candidate_count
  FROM restaurant_locations loc
  JOIN franchise_applications fa
    ON fa.status = 'launched'
   AND (
     (btrim(loc.address_city) <> ''
        AND LOWER(TRIM(COALESCE(fa.desired_city, ''))) = LOWER(TRIM(loc.address_city)))
     OR
     (btrim(loc.address_state) <> ''
        AND LOWER(TRIM(COALESCE(fa.desired_region, ''))) = LOWER(TRIM(loc.address_state)))
   )
  JOIN franchise_agreements fagr ON fagr.application_id = fa.id
  WHERE loc.status <> 'archived'
),
ranked AS (
  SELECT
    location_id,
    agreement_id,
    candidate_count,
    ROW_NUMBER() OVER (
      PARTITION BY location_id
      ORDER BY city_rank ASC, agreement_updated_at DESC, application_id ASC
    ) AS rn
  FROM matched
)
INSERT INTO franchise_location_agreements
  (location_id, agreement_id, source, ambiguous, ambiguous_candidate_count)
SELECT location_id, agreement_id, 'backfill',
       candidate_count > 1, candidate_count
  FROM ranked
 WHERE rn = 1
    ON CONFLICT (location_id) DO NOTHING;
