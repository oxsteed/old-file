-- 536_chat_credit_refunds.sql
-- In-chat OxSteed Credit refunds: widen POP + payment-request statuses; refund ledger.

ALTER TABLE chat_proof_of_payments DROP CONSTRAINT IF EXISTS chat_proof_of_payments_status_check;
ALTER TABLE chat_proof_of_payments
  ADD CONSTRAINT chat_proof_of_payments_status_check
  CHECK (status IN ('submitted', 'confirmed', 'rejected', 'refunded', 'partially_refunded'));

ALTER TABLE chat_payment_requests DROP CONSTRAINT IF EXISTS chat_payment_requests_status_check;
ALTER TABLE chat_payment_requests
  ADD CONSTRAINT chat_payment_requests_status_check
  CHECK (status IN ('open', 'paid', 'cancelled', 'refunded'));

ALTER TABLE chat_proof_of_payments
  ADD COLUMN IF NOT EXISTS refunded_amount_cents INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refund_credit_txn_id VARCHAR(80),
  ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refund_reason TEXT;

ALTER TABLE chat_payment_requests
  ADD COLUMN IF NOT EXISTS refunded_amount_cents INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refund_credit_txn_id VARCHAR(80),
  ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS chat_credit_refunds (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id     UUID,
  guest_session_id    UUID,
  payment_request_id  UUID,
  pop_id              UUID,
  purchase_txn_id     VARCHAR(80) NOT NULL,
  refund_txn_id       VARCHAR(80),
  amount_cents        INTEGER NOT NULL CHECK (amount_cents > 0),
  currency            CHAR(3) NOT NULL DEFAULT 'USD',
  reason              TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'posted'
                      CHECK (status IN ('posted', 'failed')),
  requested_by        UUID NOT NULL,
  idempotency_key     VARCHAR(160) NOT NULL,
  message_id          TEXT,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chat_credit_refund_target_chk CHECK (
    conversation_id IS NOT NULL OR guest_session_id IS NOT NULL
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_credit_refunds_idem
  ON chat_credit_refunds(requested_by, idempotency_key);

CREATE INDEX IF NOT EXISTS idx_chat_credit_refunds_conv
  ON chat_credit_refunds(conversation_id) WHERE conversation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_chat_credit_refunds_pop
  ON chat_credit_refunds(pop_id) WHERE pop_id IS NOT NULL;
