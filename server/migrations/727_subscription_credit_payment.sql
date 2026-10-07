-- Migration 727: subscription Credit payment method.
--
-- Phase 5 — Credit Everywhere: subscriptions can be paid with OxSteed Credit
-- (locked decision #9: recurring Credit debit in v1). Adds payment_method to
-- subscriptions so Credit-paid subscriptions are distinguishable from Stripe.

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'stripe'
    CHECK (payment_method IN ('stripe', 'oxsteed_credit'));

CREATE INDEX IF NOT EXISTS idx_subscriptions_credit_renewal
  ON subscriptions (current_period_end)
  WHERE status = 'active' AND payment_method = 'oxsteed_credit';

-- Tracks consecutive failed Credit renewals; 3 failures → past_due.
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS consecutive_failures INTEGER NOT NULL DEFAULT 0;
