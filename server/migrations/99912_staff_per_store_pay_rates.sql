-- Migration 99912: S-18 per-store pay rates + S-11 residual cascade fix.
--
-- 1. S-18: restaurant_location_memberships gains pay_rate_cents /
--    pay_rate_period. A store-level rate overrides the business-level
--    wage (hourly_wage_cents / pay_rate_cents on business_members) for
--    labor-cost math when it is set; NULL keeps the business-level rate.
--    Additive only.
-- 2. S-11: business_time_off_requests.user_id (migration 1200) still
--    cascades on user delete. Time-off history is a wage-and-hour
--    record and must survive an account hard-delete, so the FK becomes
--    ON DELETE SET NULL and the column becomes nullable (same treatment
--    migration 946 gave the 322/238 staff-history tables).
--
-- Idempotent. Safe to re-run.

-- ── 1. Per-store pay rates ────────────────────────────────────────────
ALTER TABLE restaurant_location_memberships
  ADD COLUMN IF NOT EXISTS pay_rate_cents INTEGER;

ALTER TABLE restaurant_location_memberships
  ADD COLUMN IF NOT EXISTS pay_rate_period VARCHAR(10);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'restaurant_location_memberships'::regclass
       AND conname = 'restaurant_location_memberships_pay_rate_cents_check'
  ) THEN
    ALTER TABLE restaurant_location_memberships
      ADD CONSTRAINT restaurant_location_memberships_pay_rate_cents_check
      CHECK (pay_rate_cents IS NULL OR pay_rate_cents >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'restaurant_location_memberships'::regclass
       AND conname = 'restaurant_location_memberships_pay_rate_period_check'
  ) THEN
    ALTER TABLE restaurant_location_memberships
      ADD CONSTRAINT restaurant_location_memberships_pay_rate_period_check
      CHECK (pay_rate_period IS NULL OR pay_rate_period IN ('hour', 'week', 'month', 'year'));
  END IF;
END $$;

-- ── 2. S-11 residual CASCADE -> SET NULL ──────────────────────────────
DO $$
BEGIN
  ALTER TABLE business_time_off_requests ALTER COLUMN user_id DROP NOT NULL;
  ALTER TABLE business_time_off_requests
    DROP CONSTRAINT IF EXISTS business_time_off_requests_user_id_fkey;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'business_time_off_requests'::regclass
       AND conname = 'business_time_off_requests_user_id_fkey'
  ) THEN
    ALTER TABLE business_time_off_requests
      ADD CONSTRAINT business_time_off_requests_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;
