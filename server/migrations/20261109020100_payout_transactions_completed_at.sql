-- Background-jobs audit (Oct 30 item 10): the payout-settlement
-- exception clock ran on updated_at, which any touch resets, so a
-- repeatedly touched unsettled payout never raised its
-- payout_settlement exception. completed_at records the real completion
-- moment and never moves afterwards; the sweep now windows on it.
ALTER TABLE payout_transactions ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- Backfill: rows are inserted already completed, so updated_at at insert
-- was the completion time. Rows never touched since still carry it. Rows
-- touched after completion backfill to their last touch, the best
-- available approximation for history.
UPDATE payout_transactions
   SET completed_at = updated_at
 WHERE transaction_status = 'completed' AND completed_at IS NULL;

CREATE OR REPLACE FUNCTION payout_transactions_stamp_completed_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Stamp once, on the transition into completed (or on an insert that
  -- is born completed). An explicit completed_at is never overwritten,
  -- and later touches of the row leave it alone.
  IF NEW.transaction_status = 'completed' AND NEW.completed_at IS NULL THEN
    NEW.completed_at := NOW();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payout_transactions_completed_at ON payout_transactions;
CREATE TRIGGER trg_payout_transactions_completed_at
  BEFORE INSERT OR UPDATE ON payout_transactions
  FOR EACH ROW EXECUTE FUNCTION payout_transactions_stamp_completed_at();
