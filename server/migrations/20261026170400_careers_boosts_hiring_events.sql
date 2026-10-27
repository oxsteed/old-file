-- OxSteed Careers, Phase 3: paid boosts and bulk-hiring events (Q20, §6.15, §18.1).
--
-- A boost only changes how an opening shows to job seekers ("Promoted").
-- It is never read by applicant ranking, talent search, invitation caps or
-- "Jobs for you" (R10). Payment goes through the careers billing provider
-- (services/careers/billing.js); nothing is live until it is configured.
--
-- Idempotent: safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS career_hiring_events (
  id            BIGSERIAL PRIMARY KEY,
  business_id   INTEGER REFERENCES businesses(id) ON DELETE CASCADE,
  brand_id      BIGINT REFERENCES restaurant_brands(id) ON DELETE CASCADE,
  name          VARCHAR(160) NOT NULL,
  location_ids  BIGINT[] NOT NULL DEFAULT ARRAY[]::BIGINT[],
  opening_ids   BIGINT[] NOT NULL DEFAULT ARRAY[]::BIGINT[],
  starts_at     TIMESTAMPTZ NOT NULL,
  ends_at       TIMESTAMPTZ NOT NULL,
  plan          TEXT NOT NULL,
  price_cents   BIGINT NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  currency      CHAR(3) NOT NULL DEFAULT 'USD',
  payment_ref   TEXT,
  status        TEXT NOT NULL DEFAULT 'pending_payment'
                  CHECK (status IN ('pending_payment','active','ended','cancelled')),
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT career_hiring_events_owner CHECK (business_id IS NOT NULL OR brand_id IS NOT NULL),
  CONSTRAINT career_hiring_events_window CHECK (ends_at > starts_at)
);

CREATE TABLE IF NOT EXISTS career_boosts (
  id           BIGSERIAL PRIMARY KEY,
  business_id  INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  opening_id   BIGINT NOT NULL REFERENCES career_openings(id) ON DELETE CASCADE,
  plan         TEXT NOT NULL,
  starts_at    TIMESTAMPTZ NOT NULL,
  ends_at      TIMESTAMPTZ NOT NULL,
  price_cents  BIGINT NOT NULL CHECK (price_cents >= 0),
  currency     CHAR(3) NOT NULL DEFAULT 'USD',
  payment_ref  TEXT,
  status       TEXT NOT NULL DEFAULT 'pending_payment'
                 CHECK (status IN ('pending_payment','active','ended','cancelled','refunded')),
  idempotency_key TEXT,
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT career_boosts_window CHECK (ends_at > starts_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_career_boosts_payment ON career_boosts (payment_ref) WHERE payment_ref IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_career_boosts_idem ON career_boosts (business_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_career_boosts_active ON career_boosts (status, ends_at);

-- Group interview slots for hiring events (§4.7 step 5).
CREATE TABLE IF NOT EXISTS career_interview_slots (
  id               BIGSERIAL PRIMARY KEY,
  hiring_event_id  BIGINT NOT NULL REFERENCES career_hiring_events(id) ON DELETE CASCADE,
  location_id      BIGINT,
  starts_at        TIMESTAMPTZ NOT NULL,
  duration_minutes SMALLINT NOT NULL DEFAULT 30,
  capacity         SMALLINT NOT NULL DEFAULT 10 CHECK (capacity BETWEEN 1 AND 200),
  timezone         TEXT NOT NULL DEFAULT 'UTC',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMIT;
