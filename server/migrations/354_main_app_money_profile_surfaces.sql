-- Migration 354: OxSteed Main money/profile production surfaces.
-- Additive only. These tables support mobile app flows that span jobs, food,
-- wallet credits, and services without forcing the app to depend on legacy
-- job-only tables for every issue.

CREATE TABLE IF NOT EXISTS main_app_payout_requests (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  currency_code VARCHAR(3) NOT NULL DEFAULT 'USD',
  payout_method VARCHAR(40) NOT NULL DEFAULT 'bank_transfer'
    CHECK (payout_method IN ('bank_transfer', 'instant_debit', 'wallet_credit')),
  status VARCHAR(24) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'paid', 'failed', 'cancelled')),
  note TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_main_app_payout_requests_user
  ON main_app_payout_requests(user_id, requested_at DESC);

CREATE TABLE IF NOT EXISTS main_app_user_vouchers (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  discount_code_id BIGINT REFERENCES discount_codes(id) ON DELETE SET NULL,
  code VARCHAR(50) NOT NULL,
  source VARCHAR(32) NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'referral', 'admin', 'campaign', 'loyalty')),
  status VARCHAR(24) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'used', 'expired', 'revoked')),
  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  used_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (user_id, code)
);

CREATE INDEX IF NOT EXISTS idx_main_app_user_vouchers_user
  ON main_app_user_vouchers(user_id, status, redeemed_at DESC);

CREATE TABLE IF NOT EXISTS main_app_payment_disputes (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_type VARCHAR(32) NOT NULL
    CHECK (source_type IN ('job', 'food_order', 'service_booking', 'wallet', 'payment', 'other')),
  source_id VARCHAR(120),
  transaction_reference VARCHAR(160),
  reason VARCHAR(100) NOT NULL,
  details TEXT NOT NULL,
  refund_method VARCHAR(32) NOT NULL DEFAULT 'original'
    CHECK (refund_method IN ('original', 'wallet')),
  requested_refund_cents BIGINT CHECK (requested_refund_cents IS NULL OR requested_refund_cents >= 0),
  currency_code VARCHAR(3) NOT NULL DEFAULT 'USD',
  status VARCHAR(24) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'under_review', 'approved', 'denied', 'resolved', 'withdrawn')),
  support_ticket_id BIGINT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_main_app_payment_disputes_user
  ON main_app_payment_disputes(user_id, opened_at DESC);

CREATE INDEX IF NOT EXISTS idx_main_app_payment_disputes_source
  ON main_app_payment_disputes(source_type, source_id);

CREATE OR REPLACE FUNCTION trg_touch_main_app_money_surfaces()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_main_app_payout_requests_updated_at'
  ) THEN
    CREATE TRIGGER trg_main_app_payout_requests_updated_at
      BEFORE UPDATE ON main_app_payout_requests
      FOR EACH ROW
      EXECUTE FUNCTION trg_touch_main_app_money_surfaces();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_main_app_payment_disputes_updated_at'
  ) THEN
    CREATE TRIGGER trg_main_app_payment_disputes_updated_at
      BEFORE UPDATE ON main_app_payment_disputes
      FOR EACH ROW
      EXECUTE FUNCTION trg_touch_main_app_money_surfaces();
  END IF;
END $$;
