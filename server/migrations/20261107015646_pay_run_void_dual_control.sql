-- Migration: dual control on voiding a finalized pay run (design
-- review 2026-11-06, finding 41).
--
-- Voiding a finalized (or approved) pay run was a single
-- payroll.manage action, while finalize, approve, export, and
-- payout-link are all dual-controlled. Voiding is now a two-step
-- maker-checker flow in the controller, recorded here:
--   void_requested_by / void_requested_at — the manager who asked for
--     the void (the maker);
--   void_approved_by / void_approved_at — the second manager who
--     completed it (the checker).
-- A draft run still voids in one step by one manager and never touches
-- these columns. The CHECK is the second line of defense behind the
-- controller's distinctness rejections: the void approver must differ
-- from both the void requester and the finalizer, where those are
-- known.
ALTER TABLE restaurant_pay_runs
  ADD COLUMN IF NOT EXISTS void_requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS void_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS void_approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS void_approved_at TIMESTAMPTZ;

ALTER TABLE restaurant_pay_runs
  DROP CONSTRAINT IF EXISTS restaurant_pay_runs_void_approval_check;
ALTER TABLE restaurant_pay_runs
  ADD CONSTRAINT restaurant_pay_runs_void_approval_check
    CHECK (void_approved_by IS NULL
      OR (void_requested_by IS NOT NULL
        AND void_approved_by <> void_requested_by
        AND (finalized_by IS NULL OR void_approved_by <> finalized_by)));
