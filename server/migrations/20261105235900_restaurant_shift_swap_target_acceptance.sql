-- Migration: target acceptance for shift swaps (Phase 3 Track C,
-- goal goal_a0fc7c0f0394).
--
-- A swap request stays 'requested' (waiting on the named target) until
-- the target accepts, which moves it to 'target_accepted' (waiting on
-- a manager decision). A target decline closes it as 'declined'.
-- target_responded_at records when the target answered. Manager
-- approval is only valid from 'target_accepted' (enforced in the
-- controller); this migration only widens the status set and adds the
-- timestamp column. No existing row changes state.

ALTER TABLE business_shift_swap_requests
  DROP CONSTRAINT IF EXISTS business_shift_swap_requests_status_check;
ALTER TABLE business_shift_swap_requests
  ADD CONSTRAINT business_shift_swap_requests_status_check
  CHECK (status IN ('requested', 'target_accepted', 'approved', 'rejected', 'declined', 'cancelled'));
ALTER TABLE business_shift_swap_requests
  ADD COLUMN IF NOT EXISTS target_responded_at TIMESTAMPTZ;
