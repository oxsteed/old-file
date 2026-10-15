-- 881_logistics_payment_double_debit_guard.sql
-- Phase 3 (logistics refactor): double-debit guards on payment settlement.
--
-- 1. stripe_client_secret: the Stripe PaymentIntent client secret is
--    persisted at intent creation so an interrupted checkout can recover
--    by replaying the attempt (the replay response returns the stored
--    secret instead of null). The secret alone cannot move money; only
--    stripe.js confirmation plus the signed webhook settles.
--
-- 2. 'superseded' attempt status: when a signed settlement event arrives
--    for an attempt whose (subject, installment) was already settled by a
--    DIFFERENT attempt (concurrent different-key checkouts), the late
--    attempt is marked 'superseded' — never credited twice — and a
--    reconciliation item is opened so staff can refund the duplicate
--    processor charge through the dual-admin refund flow.
--
-- 3. Partial unique index: at most one 'succeeded' attempt per
--    (subject, installment). This is the backstop for the true race where
--    two settlement transactions interleave; the service rechecks for a
--    succeeded sibling inside its transaction first, and converts a
--    unique-violation on this index into the superseded path.

ALTER TABLE logistics_payment_attempts
  ADD COLUMN IF NOT EXISTS stripe_client_secret TEXT;

-- Widen the status CHECK to include 'superseded'. The inline CHECK in
-- 879 is deterministically named {table}_{column}_check by PostgreSQL,
-- so drop it by that name before adding the widened one. (Matching on
-- pg_get_constraintdef text is unreliable: PostgreSQL normalizes
-- "status IN (...)" to "status = ANY (ARRAY[...])".)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'logistics_payment_attempts'::regclass
       AND conname = 'logistics_payment_attempts_status_check'
  ) THEN
    ALTER TABLE logistics_payment_attempts
      DROP CONSTRAINT logistics_payment_attempts_status_check;
  END IF;

  ALTER TABLE logistics_payment_attempts
    ADD CONSTRAINT logistics_payment_attempts_status_check
    CHECK (status IN ('pending', 'processing', 'succeeded',
                      'failed', 'canceled', 'superseded'));
END $$;

-- One settled payment per (subject, installment), regardless of method.
-- COALESCE discriminators mirror migration 878 (ids are positive SERIALs).
CREATE UNIQUE INDEX IF NOT EXISTS uq_logistics_payment_attempts_settled_installment
  ON logistics_payment_attempts (
    subject_type,
    COALESCE(purchase_order_id, 0),
    COALESCE(participant_id, 0),
    installment
  )
  WHERE status = 'succeeded';
