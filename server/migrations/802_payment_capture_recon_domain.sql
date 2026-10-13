-- P3-1-F09: surface Tier-3 capture verification failures in the existing
-- admin reconciliation-exceptions queue.
--
-- The payment_intent.succeeded handler now fails closed when the captured
-- amount from Stripe does not match the payments row (or no row exists):
-- it records a 'payment_capture' exception instead of marking the payment
-- captured and releasing escrow. This adds that domain to the CHECK,
-- following the same pattern as 637 (credit_external) and 768
-- (chargeback_evidence, webhook_receipt).

ALTER TABLE reconciliation_exceptions DROP CONSTRAINT IF EXISTS reconciliation_exceptions_domain_check;
ALTER TABLE reconciliation_exceptions
  ADD CONSTRAINT reconciliation_exceptions_domain_check
  CHECK (domain IN ('credit', 'payment_refund', 'marketplace_refund', 'external_refund',
                    'payout_settlement', 'credit_external', 'chargeback_evidence', 'webhook_receipt',
                    'payment_capture'));
