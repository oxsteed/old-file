-- Migration 99908: S-11 offboarding records + retention policy +
-- residual staff-history cascade fixes.
--
-- 1. staff_offboarding_records: one row per member removal, capturing
--    what the offboarding transaction did (PINs deactivated, drawers
--    flagged, tasks reassigned and to whom) plus the retention deadline
--    for the staff history. Records are never deleted by application
--    code; retain_until is the policy date before which the row (and the
--    history it describes) must be kept.
-- 2. Retention policy: businesses gain staff_record_retention_years
--    (default 7, range 1-10). The offboarding record's retain_until is
--    computed from it at removal time.
-- 3. Residual CASCADE -> SET NULL: staff-history foreign keys that still
--    hard-delete history with the user account (the 322/238 ones were
--    fixed by migration 946):
--      - restaurant_staff_documents.user_id (S-14 compliance vault),
--      - business_staff_availability.user_id (S-04 availability),
--      - business_shift_swap_requests.requester_user_id (S-04 swaps).
--    Their columns become nullable so the rows survive anonymized.
--
-- Additive only. Idempotent.

-- ── 1. Retention policy on businesses ─────────────────────────────────
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS staff_record_retention_years INTEGER NOT NULL DEFAULT 7;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'businesses_staff_record_retention_years_check'
  ) THEN
    ALTER TABLE businesses
      ADD CONSTRAINT businesses_staff_record_retention_years_check
      CHECK (staff_record_retention_years BETWEEN 1 AND 10);
  END IF;
END $$;

-- ── 2. Offboarding records ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staff_offboarding_records (
  id                      BIGSERIAL PRIMARY KEY,
  business_id             INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  membership_id           BIGINT REFERENCES business_members(id) ON DELETE SET NULL,
  user_id                 UUID REFERENCES users(id) ON DELETE SET NULL,
  removed_by              UUID REFERENCES users(id) ON DELETE SET NULL,
  reason                  TEXT,
  removed_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  pins_deactivated        INTEGER NOT NULL DEFAULT 0,
  sessions_ended          INTEGER NOT NULL DEFAULT 0,
  drawers_flagged         INTEGER NOT NULL DEFAULT 0,
  crew_tasks_reassigned   INTEGER NOT NULL DEFAULT 0,
  corrective_actions_reassigned INTEGER NOT NULL DEFAULT 0,
  -- The manager the open work was reassigned to (S-11: never NULL-out).
  reassigned_to_user_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  -- Retention policy: history described by this record must be kept at
  -- least until this date.
  retain_until            DATE NOT NULL,
  -- Rehire flow: set when the person is rehired; the new membership id
  -- links the two tenures.
  rehired_at              TIMESTAMPTZ,
  rehired_membership_id   BIGINT REFERENCES business_members(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staff_offboarding_business
  ON staff_offboarding_records (business_id, removed_at DESC);
CREATE INDEX IF NOT EXISTS idx_staff_offboarding_user
  ON staff_offboarding_records (user_id)
  WHERE user_id IS NOT NULL;

-- ── 3. Residual CASCADE -> SET NULL ───────────────────────────────────
-- Each rewrite is guarded so a retried migration cannot fail on the
-- constraint name already existing.

DO $$
BEGIN
  -- S-14 document vault: certificates must outlive the account.
  ALTER TABLE restaurant_staff_documents ALTER COLUMN user_id DROP NOT NULL;
  ALTER TABLE restaurant_staff_documents
    DROP CONSTRAINT IF EXISTS restaurant_staff_documents_user_id_fkey;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'restaurant_staff_documents_user_id_fkey'
  ) THEN
    ALTER TABLE restaurant_staff_documents
      ADD CONSTRAINT restaurant_staff_documents_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;

  -- S-04 availability: preference history survives as anonymized rows.
  ALTER TABLE business_staff_availability ALTER COLUMN user_id DROP NOT NULL;
  ALTER TABLE business_staff_availability
    DROP CONSTRAINT IF EXISTS business_staff_availability_user_id_fkey;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'business_staff_availability_user_id_fkey'
  ) THEN
    ALTER TABLE business_staff_availability
      ADD CONSTRAINT business_staff_availability_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;

  -- S-04 shift swaps: the request record survives its requester.
  ALTER TABLE business_shift_swap_requests ALTER COLUMN requester_user_id DROP NOT NULL;
  ALTER TABLE business_shift_swap_requests
    DROP CONSTRAINT IF EXISTS business_shift_swap_requests_requester_user_id_fkey;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'business_shift_swap_requests_requester_user_id_fkey'
  ) THEN
    ALTER TABLE business_shift_swap_requests
      ADD CONSTRAINT business_shift_swap_requests_requester_user_id_fkey
      FOREIGN KEY (requester_user_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;
