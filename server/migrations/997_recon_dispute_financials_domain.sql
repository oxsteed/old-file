-- Money-flows audit (finding B2/W2): a lost Stripe dispute moves real money.
-- recordLostDisputeFinancials marks the payment disputed (blocking escrow
-- release) and posts the loss to the platform ledger. If that write fails,
-- the webhook handler records a reconciliation exception under this domain
-- and re-throws so Stripe retries (the function is replay-idempotent).
--
-- Adds the domain to the CHECK, following the same pattern as 637
-- (credit_external), 768 (chargeback_evidence, webhook_receipt) and 802
-- (payment_capture).
ALTER TABLE reconciliation_exceptions DROP CONSTRAINT IF EXISTS reconciliation_exceptions_domain_check;
ALTER TABLE reconciliation_exceptions
  ADD CONSTRAINT reconciliation_exceptions_domain_check
  CHECK (domain IN ('credit', 'payment_refund', 'marketplace_refund', 'external_refund',
                    'payout_settlement', 'credit_external', 'chargeback_evidence', 'webhook_receipt',
                    'payment_capture', 'dispute_financials'));
