-- Group 12 Slice 3e (622): franchise version acknowledgment (D-323).
-- When a standard's version changes, territory members acknowledge the
-- new version with a drawn e-signature, tracked per person per version
-- (D-297: reuses the SOP read-and-sign pattern). The signature is a PNG
-- stored through the existing upload path; the storage key is never
-- returned in a payload. One row per (standard, user, version), so a
-- re-acknowledgment of the same version is a no-op, not a second row.
-- Additive only; safe to run twice (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS franchise_standard_acknowledgments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  standard_id UUID NOT NULL REFERENCES franchise_standards(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version INT NOT NULL CHECK (version >= 1),
  signature_storage_key TEXT NOT NULL,
  acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (standard_id, user_id, version)
);

CREATE INDEX IF NOT EXISTS idx_franchise_standard_acks_standard
  ON franchise_standard_acknowledgments(standard_id, version);
CREATE INDEX IF NOT EXISTS idx_franchise_standard_acks_user
  ON franchise_standard_acknowledgments(user_id);
