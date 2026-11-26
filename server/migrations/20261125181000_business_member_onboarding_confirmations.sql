-- Groups 5-6 item 254 (G5-24): per-member first-shift confirmations.
-- The S9 onboarding checklist is derived state (phone on file, availability
-- set, documents acknowledged, service assigned, first shift published).
-- The four member confirmations (location, contact, role, first task) are
-- explicit acknowledgments on top of it: one row per confirmation, so a
-- confirmation is never lost when the derived state changes. Additive and
-- idempotent.
CREATE TABLE IF NOT EXISTS business_member_onboarding_confirmations (
  id            BIGSERIAL PRIMARY KEY,
  business_id   INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id       UUID    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item          TEXT    NOT NULL
    CHECK (item IN ('location', 'contact', 'role', 'first_task')),
  confirmed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT business_member_onboarding_confirmations_unique
    UNIQUE (business_id, user_id, item)
);

CREATE INDEX IF NOT EXISTS idx_bmoc_business_user
  ON business_member_onboarding_confirmations (business_id, user_id);
