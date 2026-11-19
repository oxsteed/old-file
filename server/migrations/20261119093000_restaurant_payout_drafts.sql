-- PR #804 Track C (G-18): restaurant managers may draft payout requests.
-- Adds the 'draft' payout status (a manager's request waits for the
-- restaurant owner's confirmation before it becomes 'requested' and
-- enters the admin approval queue) and records who confirmed it.
ALTER TABLE restaurant_payouts
  DROP CONSTRAINT IF EXISTS restaurant_payouts_status_check;

ALTER TABLE restaurant_payouts
  ADD CONSTRAINT restaurant_payouts_status_check
  CHECK (status IN ('draft', 'requested', 'approved', 'rejected', 'processing', 'completed', 'failed', 'cancelled', 'reversed'));

ALTER TABLE restaurant_payouts
  ADD COLUMN IF NOT EXISTS confirmed_by_user_id UUID,
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;
