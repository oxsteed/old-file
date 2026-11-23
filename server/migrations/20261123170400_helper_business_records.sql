-- Group 4 rest, items 196-200 (grow into ownership). Emile's rule
-- (2026-11-23): the helper's portfolio and history carry into the new
-- business as a read-only record; ratings and client relationships stay
-- with the helper. This table is that reference: one active row per
-- (helper, business they own). `snapshot` is a frozen summary taken at link
-- time (counts, skills, service area); portfolio media is never copied, it
-- is read live from the helper's consented gallery so a customer's
-- revocation still applies. Nothing on the helper side is moved or changed.
-- Additive and idempotent.
CREATE TABLE IF NOT EXISTS helper_business_records (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  helper_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_id        INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  snapshot           JSONB NOT NULL DEFAULT '{}'::jsonb,
  intro_dismissed_at TIMESTAMPTZ,
  revoked_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_helper_business_records_active
  ON helper_business_records (helper_id, business_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_helper_business_records_business
  ON helper_business_records (business_id) WHERE revoked_at IS NULL;
