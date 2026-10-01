-- Migration 636: OxSteed Credit partner reserve regime (Phase 3 gap 4).
--
-- The partner_reserve account (migration 514) was an accounting sidecar:
-- nothing consulted it before money moved. This migration wires it into
-- payout authorization:
--
--   oxsteed_credit_reserve_policies
--     Per-(partner, currency) prefunding policy, falling back to one default
--     policy per currency. ratio_bps is basis points of outstanding payable
--     the reserve must cover (1000 = 10%); floor_cents is the absolute
--     minimum reserve balance in minor units.
--     The defaults below are STARTING VALUES (10% / $500-equivalent per
--     currency), adjustable per partner by a super-admin. They are seeded
--     for every currency in the rail's verified minor-unit map.
--
--   oxsteed_credit_reserve_funding_requirements
--     Open funding requirements raised by the reserve monitor when a
--     reserve drops below its floor. At most one open row per
--     (partner, currency). Funding stays an explicit admin action via
--     recordPartnerFunding; the monitor never moves money itself.
--
-- Enforcement points (application-level, see
-- server/services/oxsteedCreditReserveService.js):
--   1. postJournalTransaction rejects any posting that would take a
--      partner_reserve account below its policy floor
--      (403 credit_reserve_floor_breach).
--   2. initiateSettlementPayout refuses to create the Stripe transfer while
--      the reserve is below max(floor, ratio * net / 10000)
--      (409 credit_settlement_payout_reserve_breach).
--   3. The settlement-cycle job's reserve monitor pages critical/warning
--      incidents and opens funding requirements.

CREATE TABLE IF NOT EXISTS oxsteed_credit_reserve_policies (
  id BIGSERIAL PRIMARY KEY,
  partner_id BIGINT NULL REFERENCES oxsteed_credit_partners(id) ON DELETE CASCADE,
  currency_code CHAR(3) NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
  ratio_bps INTEGER NOT NULL CHECK (ratio_bps >= 0 AND ratio_bps <= 10000),
  floor_cents BIGINT NOT NULL CHECK (floor_cents >= 0),
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_oxsteed_credit_reserve_policy_partner_currency
    UNIQUE (partner_id, currency_code)
);

-- Exactly one default policy per currency (partner_id IS NULL).
CREATE UNIQUE INDEX IF NOT EXISTS uq_oxsteed_credit_reserve_default_policy
  ON oxsteed_credit_reserve_policies (currency_code)
  WHERE is_default AND partner_id IS NULL;

-- A partner-specific row and a default row cannot collide: the partial
-- unique above only covers partner_id IS NULL rows, the table unique only
-- covers non-null partner_id rows per (partner_id, currency_code).

-- Seed one default policy per rail currency. Starting values only:
-- 10% of outstanding payable, $500-equivalent absolute floor.
INSERT INTO oxsteed_credit_reserve_policies
  (partner_id, currency_code, ratio_bps, floor_cents, is_default)
VALUES
  (NULL, 'AED', 1000, 50000, true),
  (NULL, 'AUD', 1000, 50000, true),
  (NULL, 'BRL', 1000, 50000, true),
  (NULL, 'CAD', 1000, 50000, true),
  (NULL, 'CHF', 1000, 50000, true),
  (NULL, 'CNY', 1000, 50000, true),
  (NULL, 'CZK', 1000, 50000, true),
  (NULL, 'DOP', 1000, 50000, true),
  (NULL, 'EGP', 1000, 50000, true),
  (NULL, 'EUR', 1000, 50000, true),
  (NULL, 'GBP', 1000, 50000, true),
  (NULL, 'HKD', 1000, 50000, true),
  (NULL, 'HTG', 1000, 50000, true),
  (NULL, 'HUF', 1000, 50000, true),
  (NULL, 'ILS', 1000, 50000, true),
  (NULL, 'INR', 1000, 50000, true),
  (NULL, 'MAD', 1000, 50000, true),
  (NULL, 'MXN', 1000, 50000, true),
  (NULL, 'NGN', 1000, 50000, true),
  (NULL, 'NOK', 1000, 50000, true),
  (NULL, 'NZD', 1000, 50000, true),
  (NULL, 'PHP', 1000, 50000, true),
  (NULL, 'PLN', 1000, 50000, true),
  (NULL, 'RON', 1000, 50000, true),
  (NULL, 'SAR', 1000, 50000, true),
  (NULL, 'SEK', 1000, 50000, true),
  (NULL, 'SGD', 1000, 50000, true),
  (NULL, 'THB', 1000, 50000, true),
  (NULL, 'TRY', 1000, 50000, true),
  (NULL, 'USD', 1000, 50000, true),
  (NULL, 'ZAR', 1000, 50000, true),
  (NULL, 'BHD', 1000, 50000, true),
  (NULL, 'IQD', 1000, 50000, true),
  (NULL, 'JOD', 1000, 50000, true),
  (NULL, 'KWD', 1000, 50000, true),
  (NULL, 'LYD', 1000, 50000, true),
  (NULL, 'OMR', 1000, 50000, true),
  (NULL, 'TND', 1000, 50000, true),
  (NULL, 'CLP', 1000, 50000, true),
  (NULL, 'ISK', 1000, 50000, true),
  (NULL, 'JPY', 1000, 50000, true),
  (NULL, 'KRW', 1000, 50000, true),
  (NULL, 'PYG', 1000, 50000, true),
  (NULL, 'UGX', 1000, 50000, true),
  (NULL, 'VND', 1000, 50000, true),
  (NULL, 'VUV', 1000, 50000, true),
  (NULL, 'XAF', 1000, 50000, true),
  (NULL, 'XOF', 1000, 50000, true),
  (NULL, 'XPF', 1000, 50000, true)
ON CONFLICT (currency_code) WHERE is_default AND partner_id IS NULL DO NOTHING;

CREATE TABLE IF NOT EXISTS oxsteed_credit_reserve_funding_requirements (
  id BIGSERIAL PRIMARY KEY,
  partner_id BIGINT NOT NULL REFERENCES oxsteed_credit_partners(id) ON DELETE CASCADE,
  currency_code CHAR(3) NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
  required_cents BIGINT NOT NULL CHECK (required_cents >= 0),
  reason VARCHAR(80) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'fulfilled', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- At most one open funding requirement per (partner, currency).
CREATE UNIQUE INDEX IF NOT EXISTS uq_oxsteed_credit_reserve_funding_open
  ON oxsteed_credit_reserve_funding_requirements (partner_id, currency_code)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_oxsteed_credit_reserve_funding_status
  ON oxsteed_credit_reserve_funding_requirements (status, created_at);
