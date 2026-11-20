-- Group 9 Slice E (items 476-485): driver exceptions + dispatch work.
--
-- 485 Delayed stop escalation: delivery_jobs.delay_escalated_at stamps
-- the latest automated delay escalation for a job. The sweep
-- (deliveryDelayEscalationService) sets it when it opens an
-- auto-detected delay issue; the dispatch board (internalQueue) surfaces
-- jobs carrying the stamp while they are still active, so dispatch sees
-- the delay without the job's dispatch_state changing. The stamp is
-- deliberately NOT dispatch_state='exception': updateStatus 409s any
-- non-cancel status change while dispatch_state is 'exception', so
-- flagging a late in-transit job as an exception would strand the
-- driver mid-route and block delivery until dispatch resolves it.
-- The stamp is history once the job leaves an active status (the board
-- query only matches assigned/picked_up/in_transit), and a later
-- episode re-stamps it.
BEGIN;

ALTER TABLE delivery_jobs
  ADD COLUMN IF NOT EXISTS delay_escalated_at TIMESTAMPTZ;

COMMIT;
