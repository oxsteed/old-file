-- Migration 364: Main app demo completion backend contracts.
--
-- Additive only. These tables/columns let the main OxSteed app show durable
-- request states for payments, payouts, service packages, availability,
-- promos, and refunds without pretending money moved when no processor or
-- ledger settlement exists.

ALTER TABLE main_app_payout_requests
  ADD COLUMN IF NOT EXISTS external_payout_id VARCHAR(160),
  ADD COLUMN IF NOT EXISTS ledger_entry_id BIGINT,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'main_app_payout_paid_requires_settlement_ref'
  ) THEN
    ALTER TABLE main_app_payout_requests
      ADD CONSTRAINT main_app_payout_paid_requires_settlement_ref
      CHECK (
        status <> 'paid'
        OR external_payout_id IS NOT NULL
        OR ledger_entry_id IS NOT NULL
      ) NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_main_app_payout_requests_status
  ON main_app_payout_requests(user_id, status, requested_at DESC);

CREATE TABLE IF NOT EXISTS main_app_payment_requests (
  id BIGSERIAL PRIMARY KEY,
  requester_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payer_id UUID REFERENCES users(id) ON DELETE SET NULL,
  payee_id UUID REFERENCES users(id) ON DELETE SET NULL,
  business_id INTEGER REFERENCES businesses(id) ON DELETE SET NULL,
  source_type VARCHAR(32) NOT NULL
    CHECK (source_type IN ('job', 'service_booking', 'business_service', 'quote', 'other')),
  source_id VARCHAR(120),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  currency_code VARCHAR(3) NOT NULL DEFAULT 'USD',
  status VARCHAR(32) NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'viewed', 'cancelled', 'expired', 'processor_pending', 'authorized', 'settled', 'failed')),
  settlement_mode VARCHAR(32) NOT NULL DEFAULT 'external_pending'
    CHECK (settlement_mode IN ('external_pending', 'processor_pending', 'manual_direct')),
  external_provider VARCHAR(40),
  processor_payment_id VARCHAR(160),
  description TEXT,
  idempotency_key VARCHAR(160),
  expires_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (currency_code ~ '^[A-Z]{3}$'),
  CHECK (
    status NOT IN ('authorized', 'settled')
    OR processor_payment_id IS NOT NULL
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_main_app_payment_requests_idempotency
  ON main_app_payment_requests(requester_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_main_app_payment_requests_requester
  ON main_app_payment_requests(requester_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_main_app_payment_requests_participants
  ON main_app_payment_requests(payer_id, payee_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_main_app_payment_requests_source
  ON main_app_payment_requests(source_type, source_id);

ALTER TABLE business_service_packages
  ADD COLUMN IF NOT EXISTS services JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS session_count INTEGER,
  ADD COLUMN IF NOT EXISTS valid_days INTEGER,
  ADD COLUMN IF NOT EXISTS total_sessions INTEGER,
  ADD COLUMN IF NOT EXISTS validity_days INTEGER,
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE business_service_packages
   SET total_sessions = COALESCE(total_sessions, session_count, 1),
       validity_days = COALESCE(validity_days, valid_days, 365),
       updated_at = COALESCE(updated_at, created_at, NOW());

ALTER TABLE business_client_packages
  ADD COLUMN IF NOT EXISTS client_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sessions_used INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paid_cents INTEGER,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE business_client_packages
   SET customer_id = COALESCE(customer_id, client_user_id),
       updated_at = COALESCE(updated_at, purchased_at, NOW());

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'business_service_packages_total_sessions_positive'
  ) THEN
    ALTER TABLE business_service_packages
      ADD CONSTRAINT business_service_packages_total_sessions_positive
      CHECK (total_sessions IS NULL OR total_sessions > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'business_client_packages_sessions_nonnegative'
  ) THEN
    ALTER TABLE business_client_packages
      ADD CONSTRAINT business_client_packages_sessions_nonnegative
      CHECK (sessions_remaining >= 0 AND sessions_used >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bsp_public_active
  ON business_service_packages(business_id, is_active, sort_order, price_cents);

CREATE INDEX IF NOT EXISTS idx_bcp_customer_id
  ON business_client_packages(customer_id, status);

CREATE OR REPLACE FUNCTION trg_touch_main_app_payment_requests()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_main_app_payment_requests_updated_at'
  ) THEN
    CREATE TRIGGER trg_main_app_payment_requests_updated_at
      BEFORE UPDATE ON main_app_payment_requests
      FOR EACH ROW
      EXECUTE FUNCTION trg_touch_main_app_payment_requests();
  END IF;
END $$;
