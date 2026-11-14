-- Domain 8 #6: un-paying a paid run needs the run-void maker-checker step.
-- voidPayRunDisbursement used to drop a paid run back to finalized in one
-- call by a single manager, without checking how the run became paid; a
-- run paid via payout links that also held one recorded disbursement
-- (legacy data from before the one-settlement-path rule) could be un-paid
-- by voiding that stray disbursement, and re-linking then 409s.
--
-- The request half of the two-step un-pay lives on the run, mirroring the
-- Finding 41 run-void request (void_requested_by/at): the manager who
-- calls void on a load-bearing disbursement of a paid run records the
-- request, and a different manager (not the requester, not the recorder)
-- approves it by calling the same endpoint again. The disbursement id is
-- part of the request so an approval can never void a different line's
-- disbursement than the one requested.

ALTER TABLE restaurant_pay_runs
  ADD COLUMN IF NOT EXISTS unpay_requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS unpay_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS unpay_requested_disbursement_id BIGINT REFERENCES restaurant_pay_run_disbursements(id) ON DELETE SET NULL;
