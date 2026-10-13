-- Payment layers: rail operations (Stripe charge models, Credit as payment,
-- FX quotes, rail switching, tips, offline confirmations, cash-out).
-- All tables are inert until their launch flags are turned on.

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS charge_model VARCHAR(20) NOT NULL DEFAULT 'direct',
  ADD COLUMN IF NOT EXISTS destination_account_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS authorization_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS fee_country CHAR(2);
DO $$ BEGIN
  ALTER TABLE payments ADD CONSTRAINT payments_charge_model_check
    CHECK (charge_model IN ('direct', 'destination', 'platform_hold'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_payments_authorization_expiry
  ON payments (authorization_expires_at)
  WHERE status = 'authorized' AND authorization_expires_at IS NOT NULL;

-- FX quotes shown to the customer before they confirm (decision #4b).
CREATE TABLE IF NOT EXISTS payment_fx_quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
  bid_id UUID,
  purpose VARCHAR(30) NOT NULL CHECK (purpose IN ('credit_payment', 'tip')),
  source_currency CHAR(3) NOT NULL CHECK (source_currency ~ '^[A-Z]{3}$'),
  target_currency CHAR(3) NOT NULL CHECK (target_currency ~ '^[A-Z]{3}$'),
  source_amount_minor BIGINT NOT NULL CHECK (source_amount_minor > 0),
  target_amount_minor BIGINT NOT NULL CHECK (target_amount_minor > 0),
  rate_numerator TEXT NOT NULL,
  rate_denominator TEXT NOT NULL,
  spread_bps INTEGER NOT NULL CHECK (spread_bps BETWEEN 0 AND 100),
  provider VARCHAR(80) NOT NULL,
  quoted_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payment_fx_quotes_user ON payment_fx_quotes (user_id, created_at DESC);

-- Credit-rail money for a job: a hold that is the payment (cleared
-- countries) — settled to the helper's partner ledger on completion.
CREATE TABLE IF NOT EXISTS job_credit_payments (
  id BIGSERIAL PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  helper_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  credit_hold_id UUID NOT NULL,
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  currency CHAR(3) NOT NULL,
  settlement_amount_minor BIGINT NOT NULL CHECK (settlement_amount_minor > 0),
  settlement_currency CHAR(3) NOT NULL,
  fx_quote_id UUID REFERENCES payment_fx_quotes(id) ON DELETE SET NULL,
  platform_fee_minor BIGINT NOT NULL DEFAULT 0 CHECK (platform_fee_minor >= 0),
  status VARCHAR(20) NOT NULL DEFAULT 'held'
    CHECK (status IN ('held', 'captured', 'released', 'superseded')),
  captured_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_job_credit_payments_active
  ON job_credit_payments (job_id) WHERE status = 'held';

-- Switching to another rail after acceptance needs both parties (#6).
CREATE TABLE IF NOT EXISTS job_rail_switch_requests (
  id BIGSERIAL PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  from_rail job_payment_rail NOT NULL,
  to_rail job_payment_rail NOT NULL,
  requested_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  responded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined', 'canceled', 'expired')),
  offline_ack_requester BOOLEAN NOT NULL DEFAULT FALSE,
  offline_ack_responder BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at TIMESTAMPTZ NOT NULL,
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (from_rail <> to_rail)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_job_rail_switch_pending
  ON job_rail_switch_requests (job_id) WHERE status = 'pending';

-- Tips: processing cost only, no OxSteed fee (#9).
CREATE TABLE IF NOT EXISTS job_tips (
  id BIGSERIAL PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  helper_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  rail job_payment_rail NOT NULL CHECK (rail IN ('stripe', 'credit')),
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  currency CHAR(3) NOT NULL,
  processing_cost_minor BIGINT NOT NULL DEFAULT 0 CHECK (processing_cost_minor >= 0),
  platform_fee_minor BIGINT NOT NULL DEFAULT 0 CHECK (platform_fee_minor = 0),
  helper_net_minor BIGINT NOT NULL CHECK (helper_net_minor >= 0),
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'succeeded', 'failed', 'canceled')),
  stripe_payment_intent_id VARCHAR(255) UNIQUE,
  credit_hold_id UUID,
  idempotency_key VARCHAR(160) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_job_tips_job ON job_tips (job_id);

-- Offline rail: both sides confirm money changed hands (not covered).
CREATE TABLE IF NOT EXISTS offline_payment_confirmations (
  job_id UUID PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  amount_minor BIGINT,
  currency CHAR(3),
  customer_confirmed_at TIMESTAMPTZ,
  helper_confirmed_at TIMESTAMPTZ,
  customer_ack_not_covered_at TIMESTAMPTZ,
  helper_ack_not_covered_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Gated Credit cash-out through a licensed partner (#14).
CREATE TABLE IF NOT EXISTS credit_cashout_requests (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  credit_partner_id BIGINT NOT NULL,
  country_code CHAR(2) NOT NULL,
  partner_name VARCHAR(40) NOT NULL,
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  currency CHAR(3) NOT NULL,
  destination_ref VARCHAR(160) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'submitted', 'paid', 'failed', 'canceled', 'rejected')),
  available_at TIMESTAMPTZ NOT NULL,
  partner_reference VARCHAR(160),
  failure_code VARCHAR(80),
  journal_transaction_id BIGINT,
  idempotency_key VARCHAR(160) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_credit_cashout_user ON credit_cashout_requests (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_cashout_due ON credit_cashout_requests (available_at) WHERE status = 'requested';

-- Bids must be in the job's currency (#11). Missing → job currency.
-- The column default ('USD') would hide a missing currency from the trigger,
-- so drop it: the trigger fills in the job currency instead. Writers for
-- non-2-decimal currencies must set amount_cents (amount is the mirror).
ALTER TABLE bids ALTER COLUMN currency_code DROP DEFAULT;
CREATE OR REPLACE FUNCTION bids_currency_and_minor_units() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  job_currency CHAR(3);
  exp SMALLINT;
BEGIN
  SELECT COALESCE(settlement_currency, currency_code, 'USD') INTO job_currency FROM jobs WHERE id = NEW.job_id;
  job_currency := COALESCE(job_currency, 'USD');
  IF TG_OP = 'INSERT' AND NEW.currency_code IS NULL THEN
    NEW.currency_code := job_currency;
  END IF;
  IF TG_OP = 'INSERT' AND NEW.currency_code IS DISTINCT FROM job_currency THEN
    RAISE EXCEPTION 'bid currency % does not match job currency %', NEW.currency_code, job_currency
      USING ERRCODE = 'check_violation', CONSTRAINT = 'bids_currency_matches_job';
  END IF;
  exp := oxsteed_currency_exponent(NEW.currency_code);
  IF exp <> 2 AND NEW.amount_cents IS NOT NULL THEN
    NEW.amount := NEW.amount_cents / power(10::numeric, exp);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_bids_currency_and_minor_units ON bids;
CREATE TRIGGER trg_bids_currency_and_minor_units
  BEFORE INSERT OR UPDATE OF amount, amount_cents, currency_code ON bids
  FOR EACH ROW EXECUTE FUNCTION bids_currency_and_minor_units();

ALTER TABLE job_payment_reauthorizations
  ADD COLUMN IF NOT EXISTS charge_model VARCHAR(20) NOT NULL DEFAULT 'direct';
