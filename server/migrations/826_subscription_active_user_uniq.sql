-- Review P2-6-F07: duplicate active subscriptions were possible because the
-- "atomic" SELECT ... FOR UPDATE in createCheckout locks nothing when no
-- rows exist yet, and the Stripe webhook inserts never checked for an
-- existing active row. This partial unique index is the backstop: at most
-- one 'active' or 'trialing' subscription per user. Writers handle the
-- 23505 conflict by refusing the duplicate (the credit checkout path rolls
-- the whole transaction, including the first-period debit, back) or by
-- skipping the webhook insert and cancelling the duplicate at Stripe.
--
-- If this index fails to build, pre-existing duplicate active rows must be
-- reconciled by hand first; the failure is loud on purpose.
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_user_active_uniq
  ON subscriptions (user_id)
  WHERE status IN ('active', 'trialing');
