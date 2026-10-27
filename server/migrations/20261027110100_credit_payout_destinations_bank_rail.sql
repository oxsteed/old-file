-- OxSteed Credit licence readiness, part 2: verified payout destinations
-- and OxSteed's in-house bank payout rail (readiness review bug 5, §5, §10;
-- decision: MonCash is dropped, Haiti pays out through OxSteed's own rail).
--
-- Destinations match the payroll rule (Q24): a new bank account is verified
-- by micro-deposit or a one-time code carried in a deposit reference, the
-- first payout to it waits a 3-day cooling-off, and the owner is emailed in
-- their language. Account numbers are stored encrypted (utils/encryption)
-- plus a keyed fingerprint used to spot one account shared by many users.

CREATE TABLE IF NOT EXISTS credit_payout_destinations (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  country_code CHAR(2) NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
  currency_code CHAR(3) NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
  destination_type VARCHAR(20) NOT NULL DEFAULT 'bank_account'
    CHECK (destination_type IN ('bank_account')),
  holder_name VARCHAR(160) NOT NULL,
  bank_name VARCHAR(160) NOT NULL,
  bank_code VARCHAR(40),
  account_last4 VARCHAR(4) NOT NULL,
  account_fingerprint CHAR(64) NOT NULL,
  encrypted_details TEXT NOT NULL,
  verification_method VARCHAR(20) NOT NULL
    CHECK (verification_method IN ('micro_deposit', 'one_time_code')),
  status VARCHAR(30) NOT NULL DEFAULT 'pending_verification'
    CHECK (status IN ('pending_verification', 'verified', 'failed', 'disabled', 'held_for_review')),
  -- Micro-deposit amounts / code are stored only as salted hashes.
  verification_secret_hash CHAR(64),
  verification_attempts SMALLINT NOT NULL DEFAULT 0 CHECK (verification_attempts BETWEEN 0 AND 10),
  verification_sent_at TIMESTAMPTZ,
  verification_expires_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  cooling_off_until TIMESTAMPTZ,
  first_payout_at TIMESTAMPTZ,
  holder_name_match_score NUMERIC(5, 4),
  review_reason VARCHAR(80),
  disabled_at TIMESTAMPTZ,
  disabled_reason VARCHAR(160),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT credit_payout_destination_verified_shape
    CHECK (status <> 'verified' OR (verified_at IS NOT NULL AND cooling_off_until IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_credit_payout_destinations_user
  ON credit_payout_destinations (user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_payout_destinations_fingerprint
  ON credit_payout_destinations (account_fingerprint);
-- One live (not disabled/failed) row per user per account.
CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_payout_destinations_live
  ON credit_payout_destinations (user_id, account_fingerprint)
  WHERE status IN ('pending_verification', 'verified', 'held_for_review');

DO $$ BEGIN
  ALTER TABLE credit_cashout_requests ADD CONSTRAINT credit_cashout_destination_fk
    FOREIGN KEY (destination_id) REFERENCES credit_payout_destinations(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── In-house bank payout rail ───────────────────────────────────────────
-- There is no bank API. Instructions are exported in batches for the bank
-- portal; each instruction is marked paid (or returned) only when two
-- DIFFERENT administrators confirm it against the bank statement, the same
-- two-person rule as settlement mark-paid.
CREATE TABLE IF NOT EXISTS credit_bank_payout_batches (
  id BIGSERIAL PRIMARY KEY,
  country_code CHAR(2) NOT NULL,
  currency_code CHAR(3) NOT NULL,
  instruction_count INTEGER NOT NULL CHECK (instruction_count >= 0),
  total_minor BIGINT NOT NULL CHECK (total_minor >= 0),
  file_sha256 CHAR(64) NOT NULL,
  exported_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  exported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS credit_bank_payout_instructions (
  id BIGSERIAL PRIMARY KEY,
  idempotency_key VARCHAR(200) NOT NULL UNIQUE,
  purpose VARCHAR(30) NOT NULL
    CHECK (purpose IN ('cashout', 'micro_deposit', 'verification_code', 'redemption')),
  cashout_id BIGINT REFERENCES credit_cashout_requests(id) ON DELETE RESTRICT,
  destination_id BIGINT NOT NULL REFERENCES credit_payout_destinations(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  country_code CHAR(2) NOT NULL,
  currency_code CHAR(3) NOT NULL,
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  payment_reference VARCHAR(60) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending_export'
    CHECK (status IN ('pending_export', 'exported', 'paid', 'returned', 'canceled')),
  batch_id BIGINT REFERENCES credit_bank_payout_batches(id) ON DELETE RESTRICT,
  bank_reference VARCHAR(120),
  failure_code VARCHAR(80),
  first_confirmed_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  first_confirmed_at TIMESTAMPTZ,
  first_confirmed_outcome VARCHAR(20) CHECK (first_confirmed_outcome IN ('paid', 'returned')),
  second_confirmed_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  second_confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT credit_bank_payout_two_person
    CHECK (status NOT IN ('paid', 'returned') OR (
      first_confirmed_by IS NOT NULL AND second_confirmed_by IS NOT NULL
      AND first_confirmed_by <> second_confirmed_by
    )),
  CONSTRAINT credit_bank_payout_purpose_link
    CHECK (purpose <> 'cashout' OR cashout_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_credit_bank_payout_status
  ON credit_bank_payout_instructions (status, country_code, currency_code, created_at);

-- ── Haiti: drop MonCash ─────────────────────────────────────────────────
UPDATE payment_country_policies
   SET cashout_partner = 'oxsteed_bank_payout', updated_at = NOW()
 WHERE country_code = 'HT' AND (cashout_partner IS NULL OR cashout_partner = 'moncash');
UPDATE country_packs
   SET config = jsonb_set(
         config,
         '{payment_methods}',
         COALESCE((
           SELECT jsonb_agg(CASE WHEN m = 'moncash' THEN 'oxsteed_bank_transfer' ELSE m END)
             FROM jsonb_array_elements_text(config->'payment_methods') AS m
         ), '[]'::jsonb)
       )
 WHERE code = 'HT' AND config->'payment_methods' ? 'moncash';
