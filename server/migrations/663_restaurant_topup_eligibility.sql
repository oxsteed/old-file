-- Migration 663: restaurant customer top-up eligibility + top-up intents.
--
-- Founder rule: OxSteed approves which restaurants are eligible for customer
-- top-ups. Money must never enter a restaurant food-wallet the restaurant
-- cannot withdraw, so the merchant application is gated on a connected
-- Stripe payouts account (restaurant_connect_accounts, migration 656).
--
-- restaurant_topup_eligibility: one row per restaurant, owned by OxSteed's
-- decision. Statuses: not_applied / pending / approved / rejected / suspended.
-- restaurant_topups: one row per Stripe PaymentIntent top-up. Crediting
-- happens ONLY from the verified Stripe webhook (payment_intent.succeeded),
-- and only when the eligibility row is still 'approved' at that moment.

CREATE TABLE IF NOT EXISTS restaurant_topup_eligibility (
  restaurant_id BIGINT PRIMARY KEY REFERENCES food_restaurants(id) ON DELETE CASCADE,
  status VARCHAR(24) NOT NULL DEFAULT 'not_applied'
    CHECK (status IN ('not_applied', 'pending', 'approved', 'rejected', 'suspended')),
  applied_at TIMESTAMPTZ NULL,
  decided_at TIMESTAMPTZ NULL,
  decided_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  decision_reason TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_topup_eligibility_status
  ON restaurant_topup_eligibility(status, applied_at DESC);

CREATE TABLE IF NOT EXISTS restaurant_topups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  currency CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  stripe_payment_intent_id VARCHAR(255) NULL UNIQUE,
  status VARCHAR(32) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'succeeded', 'failed', 'canceled', 'requires_attention')),
  idempotency_key VARCHAR(160) NOT NULL UNIQUE,
  wallet_ledger_entry_id BIGINT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_topups_restaurant_status
  ON restaurant_topups(restaurant_id, status);
CREATE INDEX IF NOT EXISTS idx_restaurant_topups_user_restaurant_created
  ON restaurant_topups(user_id, restaurant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_restaurant_topups_stripe_intent
  ON restaurant_topups(stripe_payment_intent_id);

-- Step-up challenges cover restaurant top-ups too (mirrors the OxSteed
-- Credit large-top-up pattern). Widen the action_type allowlist.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'oxsteed_credit_stepup_challenges'::regclass
       AND conname = 'oxsteed_credit_stepup_challenges_action_type_check'
  ) THEN
    ALTER TABLE oxsteed_credit_stepup_challenges
      DROP CONSTRAINT oxsteed_credit_stepup_challenges_action_type_check;
  END IF;
  ALTER TABLE oxsteed_credit_stepup_challenges
    ADD CONSTRAINT oxsteed_credit_stepup_challenges_action_type_check
    CHECK (action_type IN (
      'topup', 'restaurant_topup', 'settlement_payout', 'withdrawal',
      'customer_transfer', 'restaurant_conversion',
      'pending_action_approve'
    ));
END $$;

-- Clawback support (chargeback scenario): an admin clawback of a credited
-- top-up may take the user's restaurant wallet negative when the credit was
-- already spent. The application layer still refuses negative balances for
-- every normal debit path (applyWalletLedgerEntry in
-- server/services/foodWalletService.js fails closed); only the explicitly
-- flagged admin clawback path in server/services/restaurantTopupService.js
-- may post a negative balance, and it records the negative outcome in the
-- response and in both audit logs. The DB floor is relaxed here so that
-- flagged path can post; never silently failing is a founder requirement.
DO $$
DECLARE
  cname TEXT;
BEGIN
  SELECT conname INTO cname
    FROM pg_constraint
   WHERE conrelid = 'food_customer_wallet_accounts'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%balance_cents >= 0%';
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE food_customer_wallet_accounts DROP CONSTRAINT %I', cname);
  END IF;

  SELECT conname INTO cname
    FROM pg_constraint
   WHERE conrelid = 'food_customer_wallet_ledger'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%balance_after_cents >= 0%';
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE food_customer_wallet_ledger DROP CONSTRAINT %I', cname);
  END IF;
END $$;
