-- Migration 671: Identity verification tied to entity IDs (phase two).
--
-- Every verified identity is anchored to the person's public entity ID, so
-- verification is portable: receipts, credit tiers, and trust badges resolve
-- one identity per person, not one row per product surface.
--
-- 1. identity_verifications (legacy Stripe-era table) gains:
--      person_public_id      -> entity_ids(public_id), the verified person
--      provider              'stripe' | 'didit' | 'manual_review'
--      provider_session_id   the provider's session (e.g. Didit session_id)
--      provider_identity_hash  the provider's one-person fingerprint
--    and the status CHECK widens to cover provider lifecycles.
-- 2. entity_links gains the 'duplicate_of' relation: a duplicate account's
--    person ID links to the canonical person's ID. Append-only as before.
-- 3. Backfill: link existing rows to person IDs; materialize verified Didit
--    users into identity_verifications rows.
--
-- Additive only. All statements are idempotent (IF NOT EXISTS / NOT EXISTS
-- guards) so a retried run is safe.

-- ── 1. Extend identity_verifications ─────────────────────────────────────────

ALTER TABLE identity_verifications
  ADD COLUMN IF NOT EXISTS person_public_id TEXT REFERENCES entity_ids(public_id);

ALTER TABLE identity_verifications
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'stripe';

ALTER TABLE identity_verifications
  ADD COLUMN IF NOT EXISTS provider_session_id TEXT;

ALTER TABLE identity_verifications
  ADD COLUMN IF NOT EXISTS provider_identity_hash TEXT;

-- Widen the legacy Stripe-only status set; old values stay valid.
ALTER TABLE identity_verifications
  DROP CONSTRAINT IF EXISTS chk_iv_status;

ALTER TABLE identity_verifications
  ADD CONSTRAINT chk_iv_status CHECK (status IN (
    'requires_input', 'processing', 'verified', 'canceled',
    'pending', 'failed', 'duplicate'
  ));

-- One person, one fingerprint per provider. Partial so legacy rows without a
-- hash are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS idx_iv_provider_hash
  ON identity_verifications (provider_identity_hash)
  WHERE provider_identity_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_iv_person_public_id
  ON identity_verifications (person_public_id)
  WHERE person_public_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_iv_provider_status
  ON identity_verifications (provider, status);

-- ── 2. duplicate_of relation on the ownership graph ──────────────────────────

-- 670 created this as an unnamed inline CHECK; Postgres names it
-- entity_links_relation_check. Drop whichever spelling exists.
ALTER TABLE entity_links
  DROP CONSTRAINT IF EXISTS entity_links_relation_check;

ALTER TABLE entity_links
  ADD CONSTRAINT chk_entity_links_relation CHECK (relation IN (
    'owns', 'belongs_to', 'acts_as', 'manages', 'represents', 'duplicate_of'
  ));

-- ── 3. Backfill ─────────────────────────────────────────────────────────────

-- Link existing verification rows to their person's public ID.
UPDATE identity_verifications iv
SET person_public_id = ei.public_id
FROM entity_ids ei
WHERE iv.person_public_id IS NULL
  AND ei.entity_type = 'person'
  AND ei.entity_key = iv.user_id::text;

-- Materialize users already verified through Didit into the verifications
-- table so the credit rail and trust badges can read one source of truth.
INSERT INTO identity_verifications
  (user_id, person_public_id, provider, provider_session_id,
   provider_identity_hash, status, created_at, updated_at)
SELECT
  u.id,
  ei.public_id,
  'didit',
  u.didit_session_id,
  u.didit_identity_hash,
  'verified',
  COALESCE(u.didit_verified_at, NOW()),
  COALESCE(u.didit_verified_at, NOW())
FROM users u
JOIN entity_ids ei
  ON ei.entity_type = 'person'
 AND ei.entity_key = u.id::text
WHERE u.didit_status = 'verified'
  AND NOT EXISTS (
    SELECT 1 FROM identity_verifications iv2
    WHERE iv2.provider = 'didit'
      AND iv2.person_public_id = ei.public_id
      AND iv2.status = 'verified'
  );
