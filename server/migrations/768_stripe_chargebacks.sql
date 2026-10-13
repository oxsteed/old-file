-- Review P3-814: Stripe chargebacks need tracked evidence deadlines and an
-- evidence-submission record. One row per Stripe dispute.
CREATE TABLE IF NOT EXISTS stripe_chargebacks (
  id BIGSERIAL PRIMARY KEY,
  stripe_dispute_id TEXT NOT NULL UNIQUE,
  stripe_account_id TEXT NULL,
  stripe_charge_id TEXT NULL,
  stripe_payment_intent_id TEXT NULL,
  amount_cents BIGINT NOT NULL DEFAULT 0,
  currency_code TEXT NOT NULL DEFAULT 'USD',
  reason TEXT NULL,
  stripe_status TEXT NOT NULL,
  evidence_due_by TIMESTAMPTZ NULL,
  has_evidence BOOLEAN NOT NULL DEFAULT FALSE,
  submission_count INTEGER NOT NULL DEFAULT 0,
  evidence_staged_at TIMESTAMPTZ NULL,
  evidence_submitted_at TIMESTAMPTZ NULL,
  submitted_by UUID NULL,
  auto_submitted BOOLEAN NOT NULL DEFAULT FALSE,
  evidence_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_error TEXT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  payment_id BIGINT NULL,
  food_order_id BIGINT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stripe_chargebacks_open_due
  ON stripe_chargebacks (evidence_due_by)
  WHERE evidence_submitted_at IS NULL
    AND stripe_status IN ('needs_response', 'warning_needs_response');

-- Surface evidence and webhook-receipt failures in the existing admin
-- reconciliation-exceptions queue.
ALTER TABLE reconciliation_exceptions DROP CONSTRAINT IF EXISTS reconciliation_exceptions_domain_check;
ALTER TABLE reconciliation_exceptions
  ADD CONSTRAINT reconciliation_exceptions_domain_check
  CHECK (domain IN ('credit', 'payment_refund', 'marketplace_refund', 'external_refund',
                    'payout_settlement', 'credit_external', 'chargeback_evidence', 'webhook_receipt'));
