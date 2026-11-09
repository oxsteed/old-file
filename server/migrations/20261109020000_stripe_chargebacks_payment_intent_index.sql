-- Background-jobs audit (Oct 30 item 4, chargeback half): the affiliate
-- auto-confirm UPDATE now excludes orders with an open or lost Stripe
-- dispute, linked through marketplace_transactions.payment_intent_id.
-- Without this index the per-commission NOT EXISTS would scan
-- stripe_chargebacks once per pending commission row.
CREATE INDEX IF NOT EXISTS idx_stripe_chargebacks_payment_intent_id
  ON stripe_chargebacks (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;
