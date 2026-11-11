-- Payment authorization webhook verification failures must be durable in the
-- reconciliation queue. Keep the database constraint aligned with the
-- application registry so recordException does not silently lose findings.
ALTER TABLE reconciliation_exceptions DROP CONSTRAINT IF EXISTS reconciliation_exceptions_domain_check;
ALTER TABLE reconciliation_exceptions
  ADD CONSTRAINT reconciliation_exceptions_domain_check
  CHECK (domain IN ('credit', 'payment_refund', 'marketplace_refund', 'external_refund',
                    'payout_settlement', 'credit_external', 'chargeback_evidence', 'webhook_receipt',
                    'payment_capture', 'payment_authorization', 'dispute_financials'));
