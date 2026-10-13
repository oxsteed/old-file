BEGIN;

-- P3-9-F04: per-billing-period duplicate guard for recurring-billing invoices.
--
-- generateInvoice previously guarded duplicates with a same-day check on the
-- notes text, so a retry on a later day (or any second generation for the same
-- billing period) could mint a second invoice for one period. Recording the
-- billed period on the invoice lets the handler enforce one invoice per
-- (recurring billing, billing period). The partial unique index excludes
-- cancelled invoices so a voided period invoice can be regenerated, and acts
-- as a fail-closed backstop behind the handler's SELECT guard.

ALTER TABLE business_invoices
  ADD COLUMN IF NOT EXISTS recurring_billing_id BIGINT
    REFERENCES business_recurring_billing(id) ON DELETE SET NULL;

ALTER TABLE business_invoices
  ADD COLUMN IF NOT EXISTS billing_period_start DATE;

CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_recurring_period
  ON business_invoices (recurring_billing_id, billing_period_start)
  WHERE recurring_billing_id IS NOT NULL
    AND billing_period_start IS NOT NULL
    AND status <> 'cancelled';

COMMIT;
