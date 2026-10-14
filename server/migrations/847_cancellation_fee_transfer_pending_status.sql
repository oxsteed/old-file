BEGIN;

-- P3-10-F14: cancellation_fees.status gained 'transfer_pending'. The helper
-- share of a cancellation fee failed to transfer after the customer charge
-- succeeded (or no payout-enabled Connect account was available): the fee
-- must NOT read 'collected' until the helper transfer completes. The row
-- stays visible to finance with failure_reason set so it can be retried.
COMMENT ON COLUMN cancellation_fees.status IS
  'pending | collected | failed | refunded | waived | transfer_pending';

COMMIT;
