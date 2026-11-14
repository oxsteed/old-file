-- Migration: dual control on voiding a pay-run consolidation
-- (money-flows audit 2026-11-07, finding R8).
--
-- Voiding a consolidation was a single payroll.manage action that
-- recorded no actor, while voiding a pay run is a two-step
-- maker-checker flow (migration 20261107015646). An HQ-approved
-- consolidation — itself a dual-controlled group approval — could
-- be dissolved by any single payroll manager, including the manager
-- who finalized it. Voiding is now two-step, mirroring the pay-run
-- void, recorded here:
--   void_requested_by / void_requested_at — the manager who asked
--     for the void (the maker);
--   void_approved_by / void_approved_at — the second manager who
--     completed it (the checker).
-- A draft consolidation still voids in one step by one manager and
-- never touches these columns. The CHECK is the second line of
-- defense behind the controller's distinctness rejections: the void
-- approver must differ from both the void requester and the
-- finalizer, where those are known.
ALTER TABLE restaurant_pay_run_consolidations
  ADD COLUMN IF NOT EXISTS void_requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS void_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS void_approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS void_approved_at TIMESTAMPTZ;

ALTER TABLE restaurant_pay_run_consolidations
  DROP CONSTRAINT IF EXISTS restaurant_pay_run_consolidations_void_approval_check;
ALTER TABLE restaurant_pay_run_consolidations
  ADD CONSTRAINT restaurant_pay_run_consolidations_void_approval_check
    CHECK (void_approved_by IS NULL
      OR (void_requested_by IS NOT NULL
        AND void_approved_by <> void_requested_by
        AND (finalized_by IS NULL OR void_approved_by <> finalized_by)));
