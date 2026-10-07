-- Migration 720: backfill jobs.transaction_mode for in-flight tier-3 escrows.
--
-- ITEM 20: tier-3 escrow is now detected via the explicit
-- jobs.transaction_mode enum ('direct' | 'guided_protected') instead of
-- substring matching on job_type/job_type_label. createPaymentIntent (the
-- tier-3 manual-capture flow) sets transaction_mode = 'guided_protected'
-- when the protected payment intent row is created.
--
-- Jobs whose protected payment was created before that write existed still
-- carry the default 'direct'; without this backfill, completing one of them
-- would skip the authorized-fund capture and strand the escrow. Promote any
-- job with an in-flight protected payment (pending/authorized) to
-- 'guided_protected'. This is the money-safe direction: the flag only
-- enables capture of funds that are actually authorized for the job — the
-- capture itself still requires an 'authorized' payments row and no open
-- dispute, and jobs with no payments row are untouched.
UPDATE jobs j
SET transaction_mode = 'guided_protected',
    updated_at = NOW()
WHERE j.transaction_mode = 'direct'
  AND EXISTS (
    SELECT 1
      FROM payments p
     WHERE p.job_id = j.id
       AND p.status IN ('pending', 'authorized')
  );
