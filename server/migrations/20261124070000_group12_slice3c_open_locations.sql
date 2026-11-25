-- Group 12 Slice 3c (611-615): open locations (D-311..D-315).
-- Locations are business/restaurant locations inside a territory, not new
-- territories (D-298). One location is seeded per application from the
-- territory the applicant asked for, so milestones (611), the opening
-- team (612), the service checklist (614), and the opening confirmation
-- (615) always have a location to attach to. The readiness review (613)
-- lives on the application, not on a location.
-- Additive only; safe to run twice (IF NOT EXISTS / NOT EXISTS guard on
-- the backfill).

-- 611/614/615: the location itself. `planned` until the operator or HQ
-- launches it (614 gates that launch on at least one available service);
-- the opening confirmation (615) is a separate record, so a launched
-- location is only complete once confirmed.
CREATE TABLE IF NOT EXISTS franchise_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES franchise_applications(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  city TEXT,
  region TEXT,
  country CHAR(2),
  status VARCHAR(20) NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'launched')),
  launched_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_franchise_locations_application
  ON franchise_locations(application_id, id);

-- 611: location launch milestones. HQ creates them; the operator updates
-- status only (mirrors the 609 launch plan). A milestone may be linked to
-- one launch plan step: the link is written onto the step's reserved
-- `milestone_id` column (D-309), never as an FK on this table, so the
-- plan surface keeps working standalone.
CREATE TABLE IF NOT EXISTS franchise_location_milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES franchise_applications(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES franchise_locations(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  due_date DATE,
  owner_role VARCHAR(80) NOT NULL DEFAULT 'operator'
    CHECK (owner_role IN ('operator', 'hq', 'shared')),
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'completed', 'blocked')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  completed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_franchise_location_milestones_location
  ON franchise_location_milestones(location_id, sort_order, id);
CREATE INDEX IF NOT EXISTS idx_franchise_location_milestones_application
  ON franchise_location_milestones(application_id, id);

-- 612: opening-team designation. One row per helper per location (or per
-- territory when location_id is NULL); the role is lead or member. The
-- helper must hold a helper profile — enforced in the controller, not by
-- FK, because the territory roster itself is best-effort city/region
-- matching (D-312). NULL location rows need their own partial unique
-- index: a plain UNIQUE treats NULLs as distinct.
CREATE TABLE IF NOT EXISTS franchise_opening_team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES franchise_applications(id) ON DELETE CASCADE,
  location_id UUID REFERENCES franchise_locations(id) ON DELETE CASCADE,
  helper_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL DEFAULT 'member'
    CHECK (role IN ('lead', 'member')),
  assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_franchise_opening_team_territory_unique
  ON franchise_opening_team_members(application_id, helper_user_id)
  WHERE location_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_franchise_opening_team_location_unique
  ON franchise_opening_team_members(application_id, location_id, helper_user_id)
  WHERE location_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_franchise_opening_team_application
  ON franchise_opening_team_members(application_id, id);

-- 613: readiness reviews. One row per review; the latest review decides
-- the readiness status (passed -> ready, changes requested -> planning).
-- The reviewer is HQ only; the operator sees outcome, notes, and date,
-- never the reviewer's identity (D-313).
CREATE TABLE IF NOT EXISTS franchise_readiness_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES franchise_applications(id) ON DELETE CASCADE,
  reviewer_id UUID REFERENCES users(id) ON DELETE SET NULL,
  outcome VARCHAR(20) NOT NULL
    CHECK (outcome IN ('passed', 'changes_requested')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_franchise_readiness_reviews_application
  ON franchise_readiness_reviews(application_id, created_at DESC, id DESC);

-- 614: per-location service availability. A row names a service the
-- location offers (or not): either a service from the linked business
-- (`business_services.id`, nullable) or a free-text service name when the
-- business has no service catalogue entry for it. `available` with a
-- reason; a location cannot launch with zero available services (D-314).
CREATE TABLE IF NOT EXISTS franchise_location_services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID NOT NULL REFERENCES franchise_locations(id) ON DELETE CASCADE,
  application_id UUID NOT NULL REFERENCES franchise_applications(id) ON DELETE CASCADE,
  service_id INTEGER REFERENCES business_services(id) ON DELETE SET NULL,
  service_name TEXT NOT NULL,
  available BOOLEAN NOT NULL DEFAULT TRUE,
  reason TEXT,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_franchise_location_services_catalogue_unique
  ON franchise_location_services(location_id, service_id)
  WHERE service_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_franchise_location_services_named_unique
  ON franchise_location_services(location_id, service_name)
  WHERE service_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_franchise_location_services_location
  ON franchise_location_services(location_id, id);

-- 615: opening confirmations. One per location: the operator confirms the
-- location opened, with the date it opened and notes. The launch is only
-- complete once a confirmation exists on a launched location (D-315).
CREATE TABLE IF NOT EXISTS franchise_opening_confirmations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES franchise_applications(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES franchise_locations(id) ON DELETE CASCADE,
  confirmed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  opened_date DATE NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (location_id)
);

CREATE INDEX IF NOT EXISTS idx_franchise_opening_confirmations_application
  ON franchise_opening_confirmations(application_id, id);

-- Backfill one location per application created before this slice, from
-- the territory the applicant asked for. Applications that already have
-- a location are left alone.
INSERT INTO franchise_locations (application_id, name, city, region, country)
SELECT fa.id,
       COALESCE(NULLIF(fa.desired_city, '') || ' location', 'First location'),
       fa.desired_city, fa.desired_region, fa.desired_country
  FROM franchise_applications fa
 WHERE NOT EXISTS (
   SELECT 1 FROM franchise_locations existing
    WHERE existing.application_id = fa.id
 );
