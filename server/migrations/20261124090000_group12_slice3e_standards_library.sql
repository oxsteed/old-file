-- Group 12 Slice 3e (621): franchise standards library (D-321/D-322).
-- Franchise standards are franchise-scoped views over the Learn guides
-- catalog — HQ curates which guides are franchise standards, either
-- franchise-wide (application_id NULL, applies to every territory) or
-- for one territory (application_id set). No separate library system is
-- built in this wave (D-297). The version is an HQ-published integer
-- (starts at 1), independent of the Learn guide's content; bumping it
-- is the policy-change event that 622 acknowledges and 625 reminds
-- about. Deleting a Learn guide removes its standards with it.
-- Additive only; safe to run twice (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS franchise_standards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID REFERENCES franchise_applications(id) ON DELETE CASCADE,
  guide_id TEXT NOT NULL REFERENCES learn_guides(id) ON DELETE CASCADE,
  version INT NOT NULL DEFAULT 1 CHECK (version >= 1),
  curated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One standard per guide per scope: a guide is a franchise-wide
-- standard at most once, and a territory standard at most once per
-- territory. application_id NULL defeats a plain unique index, so the
-- scope is coalesced into the key.
CREATE UNIQUE INDEX IF NOT EXISTS uq_franchise_standard_scope_guide
  ON franchise_standards (COALESCE(application_id::text, ''), guide_id);

CREATE INDEX IF NOT EXISTS idx_franchise_standards_application
  ON franchise_standards(application_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_franchise_standards_guide
  ON franchise_standards(guide_id);
