-- Migration 368: Durable two-path business operating model.
--
-- New businesses choose how customers interact with them:
--   restaurant - menu, ordering, restaurant credit, and restaurant devices
--   service    - services, bookings, jobs, and retail discovery in Skills
--
-- Keep industry_category, business_type, and business_mode during the rollout.
-- Existing web and mobile releases still read those fields.

BEGIN;

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS business_kind VARCHAR(20),
  ADD COLUMN IF NOT EXISTS setup_status VARCHAR(30) NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS timezone VARCHAR(80) NOT NULL DEFAULT 'UTC',
  ADD COLUMN IF NOT EXISTS currency_code VARCHAR(3),
  ADD COLUMN IF NOT EXISTS creation_idempotency_key VARCHAR(100),
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS profile_version INTEGER NOT NULL DEFAULT 1;

UPDATE businesses
   SET business_kind = CASE
     WHEN business_mode = 'food' OR industry_category = 'food' THEN 'restaurant'
     ELSE 'service'
   END
 WHERE business_kind IS NULL;

UPDATE businesses
   SET setup_status = CASE
     WHEN is_active = TRUE AND COALESCE(is_listed, TRUE) = TRUE THEN 'active'
     WHEN is_active = FALSE AND COALESCE(is_listed, FALSE) = TRUE THEN 'paused'
     WHEN is_active = FALSE AND COALESCE(is_listed, FALSE) = FALSE THEN 'draft'
     ELSE 'in_progress'
   END
 WHERE setup_status = 'draft'
   AND created_at < NOW() - INTERVAL '1 minute';

UPDATE businesses
   SET published_at = COALESCE(published_at, updated_at, created_at)
 WHERE setup_status IN ('active', 'paused')
   AND published_at IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'businesses'::regclass
       AND conname = 'businesses_business_kind_check'
  ) THEN
    ALTER TABLE businesses
      ADD CONSTRAINT businesses_business_kind_check
      CHECK (business_kind IS NULL OR business_kind IN ('restaurant', 'service'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'businesses'::regclass
       AND conname = 'businesses_setup_status_check'
  ) THEN
    ALTER TABLE businesses
      ADD CONSTRAINT businesses_setup_status_check
      CHECK (setup_status IN ('draft', 'in_progress', 'ready_for_review', 'active', 'paused', 'archived'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'businesses'::regclass
       AND conname = 'businesses_currency_code_check'
  ) THEN
    ALTER TABLE businesses
      ADD CONSTRAINT businesses_currency_code_check
      CHECK (currency_code IS NULL OR currency_code ~ '^[A-Z]{3}$');
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_businesses_owner_creation_key
  ON businesses(user_id, creation_idempotency_key)
  WHERE creation_idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_businesses_kind_visibility
  ON businesses(business_kind, setup_status, is_active, is_listed)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS business_setup_progress (
  business_id       INTEGER PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  current_step      VARCHAR(60) NOT NULL DEFAULT 'identity',
  completed_steps   TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  draft_data        JSONB NOT NULL DEFAULT '{}'::JSONB,
  version           INTEGER NOT NULL DEFAULT 1,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS business_service_profiles (
  business_id              INTEGER PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  service_area_type        VARCHAR(30) NOT NULL DEFAULT 'mobile',
  accepts_direct_bookings  BOOLEAN NOT NULL DEFAULT TRUE,
  accepts_job_requests     BOOLEAN NOT NULL DEFAULT TRUE,
  direct_payment_enabled   BOOLEAN NOT NULL DEFAULT TRUE,
  status                   VARCHAR(30) NOT NULL DEFAULT 'draft',
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT business_service_profiles_area_check
    CHECK (service_area_type IN ('mobile', 'at_location', 'remote', 'hybrid')),
  CONSTRAINT business_service_profiles_status_check
    CHECK (status IN ('draft', 'active', 'paused', 'archived'))
);

INSERT INTO business_setup_progress (business_id, current_step, completed_steps)
SELECT id,
       CASE WHEN setup_status = 'active' THEN 'complete' ELSE 'identity' END,
       CASE
         WHEN setup_status = 'active' THEN ARRAY['kind', 'category', 'identity', 'location']::TEXT[]
         ELSE ARRAY[]::TEXT[]
       END
  FROM businesses
ON CONFLICT (business_id) DO NOTHING;

INSERT INTO business_service_profiles (business_id, status)
SELECT id,
       CASE WHEN setup_status = 'active' THEN 'active' ELSE 'draft' END
  FROM businesses
 WHERE business_kind = 'service'
ON CONFLICT (business_id) DO NOTHING;

COMMIT;
