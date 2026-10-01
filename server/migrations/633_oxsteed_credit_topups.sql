-- Migration 633: OxSteed Credit Stripe top-ups (fiat money IN).
--
-- Customers can buy OxSteed Credit with a card through Stripe. This table
-- tracks the lifecycle of each top-up intent:
--
--   pending            -> PaymentIntent created, awaiting customer payment
--   completed          -> Stripe paid the intent and the central journal
--                         posted a balanced `load` (platform_treasury ->
--                         customer_wallet); journal_transaction_id links it
--   failed             -> the PaymentIntent failed/was canceled, or Stripe
--                         rejected the intent creation (revivable: a retry
--                         with the same idempotency key reuses the Stripe
--                         object via its deterministic idempotency key)
--   requires_attention -> Stripe money arrived but the journal post failed;
--                         a critical incident is raised and Stripe redelivery
--                         retries the journal post
--
-- Idempotency: the caller-supplied idempotency_key is UNIQUE; replays return
-- the existing row (with an amount/currency fingerprint check, else 409).
-- The journal posting itself uses the deterministic key
-- `credit-topup:<topup_id>`, so webhook redelivery can never double-post.
--
-- NOTE on account_id: oxsteed_credit_accounts.id is BIGSERIAL, so this is a
-- BIGINT FK to that table (a UUID column could never reference it).
CREATE TABLE IF NOT EXISTS oxsteed_credit_topups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id BIGINT NULL REFERENCES oxsteed_credit_accounts(id) ON DELETE RESTRICT,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  currency_code CHAR(3) NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
  status VARCHAR(32) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'failed', 'requires_attention')),
  stripe_payment_intent_id VARCHAR(255) NULL UNIQUE,
  idempotency_key VARCHAR(160) NOT NULL UNIQUE,
  journal_transaction_id UUID NULL REFERENCES oxsteed_credit_transactions(id) ON DELETE RESTRICT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oxsteed_credit_topups_customer_status
  ON oxsteed_credit_topups(customer_id, status);
