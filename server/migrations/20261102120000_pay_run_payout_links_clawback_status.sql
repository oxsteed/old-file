-- Restaurant-side track C (2026-11-02): pay-run payout linkage and a
-- terminal clawback status.
--
-- Finding 34: a clawed-back top-up keeps reading as 'succeeded', so a
-- second admin can re-run the clawback believing the first run never
-- happened. 'clawed_back' is now a terminal status: the clawback service
-- moves a succeeded top-up to it on first success, and the service's
-- succeeded-only gate then 409s any re-run.
--
-- Finding 25: a finalized pay run reads as complete payroll while no
-- payout exists. restaurant_pay_run_payout_links records the actual
-- completed restaurant payouts that funded a run; when their sum covers
-- the run's total pay, the run moves to the new 'paid' status. 'paid' is
-- terminal for voiding (a paid run cannot be voided away after money
-- moved). Link rows are append-only attribution, never edited.

ALTER TABLE restaurant_topups
  DROP CONSTRAINT IF EXISTS restaurant_topups_status_check;
ALTER TABLE restaurant_topups
  ADD CONSTRAINT restaurant_topups_status_check
  CHECK (status IN ('pending', 'succeeded', 'failed', 'canceled', 'requires_attention', 'clawed_back'));

ALTER TABLE restaurant_pay_runs
  DROP CONSTRAINT IF EXISTS restaurant_pay_runs_status_check;
ALTER TABLE restaurant_pay_runs
  ADD CONSTRAINT restaurant_pay_runs_status_check
  CHECK (status IN ('draft', 'finalized', 'voided', 'paid'));

CREATE TABLE IF NOT EXISTS restaurant_pay_run_payout_links (
  id BIGSERIAL PRIMARY KEY,
  pay_run_id BIGINT NOT NULL REFERENCES restaurant_pay_runs(id) ON DELETE CASCADE,
  restaurant_payout_id UUID NOT NULL REFERENCES restaurant_payouts(id) ON DELETE RESTRICT,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency_code CHAR(3) NOT NULL DEFAULT 'USD',
  linked_by UUID REFERENCES users(id) ON DELETE SET NULL,
  note VARCHAR(500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (pay_run_id, restaurant_payout_id)
);

CREATE INDEX IF NOT EXISTS idx_pay_run_payout_links_run
  ON restaurant_pay_run_payout_links(pay_run_id);
CREATE INDEX IF NOT EXISTS idx_pay_run_payout_links_payout
  ON restaurant_pay_run_payout_links(restaurant_payout_id);
