-- Group 12 Slice 3b (607): assignment boundary summary (D-294/D-308).
-- A territory boundary is an explicit structured area list
-- (country/region/city), not a map and not free text. Each area is
-- included in or excluded from the assignment; exclusivity itself lives
-- on the agreement (franchise_agreements.territory_exclusive) and is
-- surfaced to the operator, not stored here. Admin-editable, operator
-- read-only. Additive only; safe to run twice (IF NOT EXISTS / NOT EXISTS
-- guard on the backfill).

CREATE TABLE IF NOT EXISTS franchise_territory_areas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES franchise_applications(id) ON DELETE CASCADE,
  country VARCHAR(2) NOT NULL,
  region VARCHAR(120),
  city VARCHAR(120),
  area_type VARCHAR(20) NOT NULL DEFAULT 'included'
    CHECK (area_type IN ('included', 'excluded')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_franchise_territory_areas_application
  ON franchise_territory_areas(application_id, sort_order, id);

-- Backfill: one included area per existing application, from the territory
-- fields the applicant supplied. Applications that already have areas
-- (e.g. a re-run after the slice) are left alone.
INSERT INTO franchise_territory_areas (application_id, country, region, city, area_type, sort_order)
SELECT fa.id, fa.desired_country, fa.desired_region, fa.desired_city, 'included', 10
  FROM franchise_applications fa
 WHERE NOT EXISTS (
   SELECT 1 FROM franchise_territory_areas existing
    WHERE existing.application_id = fa.id
 );
