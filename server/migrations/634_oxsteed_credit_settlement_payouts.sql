-- Migration 634: OxSteed Credit verified partner payout tracking.
--
-- Adds Stripe-transfer payout bookkeeping to oxsteed_credit_settlements so an
-- approved settlement can be paid out through Stripe Connect instead of only
-- by the manual off-rail mark-paid path:
--   stripe_transfer_id   - the Stripe Transfer id created for this payout (UNIQUE)
--   payout_status        - none | initiated | paid | failed
--   payout_initiated_by  - admin user id that initiated the payout
--   payout_initiated_at  - when the payout was initiated
--
-- Money still moves only through the existing transitionSettlement mark-paid
-- path (settlement journal leg debit partner_payable -> credit
-- platform_treasury); payout_status is bookkeeping that the Stripe transfer
-- that pays the partner was created / confirmed / failed, and never posts
-- journal entries on its own.

ALTER TABLE oxsteed_credit_settlements
  ADD COLUMN IF NOT EXISTS stripe_transfer_id VARCHAR(255) NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_oxsteed_credit_settlements_stripe_transfer_id'
  ) THEN
    ALTER TABLE oxsteed_credit_settlements
      ADD CONSTRAINT uq_oxsteed_credit_settlements_stripe_transfer_id UNIQUE (stripe_transfer_id);
  END IF;
END $$;

ALTER TABLE oxsteed_credit_settlements
  ADD COLUMN IF NOT EXISTS payout_status VARCHAR(24) NOT NULL DEFAULT 'none';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'oxsteed_credit_settlements_payout_status_check'
  ) THEN
    ALTER TABLE oxsteed_credit_settlements
      ADD CONSTRAINT oxsteed_credit_settlements_payout_status_check
      CHECK (payout_status IN ('none', 'initiated', 'paid', 'failed'));
  END IF;
END $$;

ALTER TABLE oxsteed_credit_settlements
  ADD COLUMN IF NOT EXISTS payout_initiated_by UUID NULL
  REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE oxsteed_credit_settlements
  ADD COLUMN IF NOT EXISTS payout_initiated_at TIMESTAMPTZ NULL;
