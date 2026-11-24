-- Group 12 Slice 3h (636-640, D-336/D-337/D-340): plan development.
-- Candidate locations are business/restaurant locations inside a territory
-- (D-298), not new territories: the HQ list tracks territories, this slice
-- tracks the locations a territory is scouting (636). Capacity (637) is a
-- derived per-area view over the structured boundary areas (D-294) plus an
-- HQ-set target per area — no map, no per-area load store. The training
-- planner (638) and launch dependency overview (639) are derived on read
-- from existing training, roster, milestone, and readiness state, so they
-- need no tables here. Expansion readiness notes (640) are operator-authored
-- notes per territory/location, read by HQ alongside its own admin fields.
-- Additive only; safe to run twice (IF NOT EXISTS / UNIQUE index guards).
-- No money moves here: franchise money is record-only (D-291).

-- 636: candidate locations inside a territory. Status flows
-- scouting -> shortlisted -> approved/rejected, with rejected -> scouting
-- as the reopen path (D-336). HQ reviews; the operator proposes and
-- submits a candidate for review.
CREATE TABLE IF NOT EXISTS franchise_candidate_locations (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID        NOT NULL REFERENCES franchise_applications(id) ON DELETE CASCADE,
  proposed_name  TEXT        NOT NULL,
  city           TEXT,
  region         TEXT,
  country        CHAR(2),
  status         VARCHAR(20) NOT NULL DEFAULT 'scouting'
                   CHECK (status IN ('scouting', 'shortlisted', 'approved', 'rejected')),
  notes          TEXT,
  proposed_by    UUID        REFERENCES users(id) ON DELETE SET NULL,
  reviewed_by    UUID        REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_franchise_candidate_locations_application
  ON franchise_candidate_locations(application_id, status, created_at DESC);

-- 637: the HQ-set target location count per structured boundary area.
-- One target per area per territory; the capacity view (derived) compares
-- it against the open, planned, and candidate locations matched to that
-- area (D-337). No target means the area reports its load without a
-- utilization figure, never a zero target.
CREATE TABLE IF NOT EXISTS franchise_capacity_targets (
  id               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id   UUID    NOT NULL REFERENCES franchise_applications(id) ON DELETE CASCADE,
  area_id          UUID    NOT NULL REFERENCES franchise_territory_areas(id) ON DELETE CASCADE,
  target_locations INTEGER NOT NULL CHECK (target_locations > 0 AND target_locations <= 1000),
  set_by           UUID    REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (application_id, area_id)
);

CREATE INDEX IF NOT EXISTS idx_franchise_capacity_targets_application
  ON franchise_capacity_targets(application_id, area_id);

-- 640: operator-authored expansion readiness notes, per territory
-- (location_id NULL) or per location. HQ reads them alongside its own
-- admin readiness fields (risk_notes, hq_recommendation,
-- market_assessment) in one view (D-340); the admin fields are not
-- duplicated here.
CREATE TABLE IF NOT EXISTS franchise_expansion_notes (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID        NOT NULL REFERENCES franchise_applications(id) ON DELETE CASCADE,
  location_id    UUID        REFERENCES franchise_locations(id) ON DELETE CASCADE,
  author_user_id UUID        REFERENCES users(id) ON DELETE SET NULL,
  body           TEXT        NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_franchise_expansion_notes_application
  ON franchise_expansion_notes(application_id, created_at DESC);
