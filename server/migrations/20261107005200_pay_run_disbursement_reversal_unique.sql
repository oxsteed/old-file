-- Migration 20261107005200: pay-run disbursement reversal, unique-index
-- follow-up (design review 2026-11-06, finding 9).
--
-- The original ledger enforced one disbursement per line with a plain
-- UNIQUE (pay_run_line_id). A voided (reversed) disbursement frees its
-- line for a corrected re-recording, so the uniqueness must apply to
-- live rows only: at most one 'recorded' disbursement per line, any
-- number of 'voided' ones (the audit trail stays complete).
ALTER TABLE restaurant_pay_run_disbursements
  DROP CONSTRAINT IF EXISTS restaurant_pay_run_disbursements_pay_run_line_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_pay_run_disbursements_live_line
  ON restaurant_pay_run_disbursements (pay_run_line_id)
  WHERE status = 'recorded';
