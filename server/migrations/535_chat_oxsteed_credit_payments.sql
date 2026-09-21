-- 535_chat_oxsteed_credit_payments.sql
-- In-chat OxSteed Credit payments + provider payment-request cards.
-- Ledger moves reuse oxsteedCreditService (no second ledger).

-- ── Provider payment requests (optional card before pay) ─────────────────────
CREATE TABLE IF NOT EXISTS chat_payment_requests (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id     UUID,
  guest_session_id    UUID,
  business_id         INT,
  helper_id           UUID,
  quote_kind          TEXT         CHECK (quote_kind IS NULL OR quote_kind IN ('business', 'helper')),
  quote_id            TEXT,
  amount_cents        INTEGER      NOT NULL CHECK (amount_cents > 0 AND amount_cents <= 1000000000),
  currency            CHAR(3)      NOT NULL DEFAULT 'USD',
  memo                VARCHAR(500),
  status              TEXT         NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open', 'paid', 'cancelled')),
  message_id          TEXT,
  requested_by        UUID         NOT NULL,
  paid_pop_id         UUID,
  paid_at             TIMESTAMPTZ,
  credit_txn_id       VARCHAR(80),
  idempotency_key     VARCHAR(160),
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT chat_payreq_target_chk CHECK (
    conversation_id IS NOT NULL OR guest_session_id IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_cpr_conversation ON chat_payment_requests(conversation_id) WHERE conversation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cpr_guest ON chat_payment_requests(guest_session_id) WHERE guest_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cpr_status ON chat_payment_requests(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cpr_idempotency
  ON chat_payment_requests(requested_by, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ── Quote payment metadata (paid / partially paid) ───────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'business_quotes') THEN
    ALTER TABLE business_quotes ADD COLUMN IF NOT EXISTS amount_paid_cents INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE business_quotes ADD COLUMN IF NOT EXISTS payment_status TEXT;
    ALTER TABLE business_quotes ADD COLUMN IF NOT EXISTS last_payment_method VARCHAR(80);
    ALTER TABLE business_quotes ADD COLUMN IF NOT EXISTS last_payment_at TIMESTAMPTZ;
    ALTER TABLE business_quotes ADD COLUMN IF NOT EXISTS last_credit_txn_id VARCHAR(80);
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'helper_quotes') THEN
    ALTER TABLE helper_quotes ADD COLUMN IF NOT EXISTS amount_paid_cents INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE helper_quotes ADD COLUMN IF NOT EXISTS payment_status TEXT;
    ALTER TABLE helper_quotes ADD COLUMN IF NOT EXISTS last_payment_method VARCHAR(80);
    ALTER TABLE helper_quotes ADD COLUMN IF NOT EXISTS last_payment_at TIMESTAMPTZ;
    ALTER TABLE helper_quotes ADD COLUMN IF NOT EXISTS last_credit_txn_id VARCHAR(80);
  END IF;
END $$;

-- Link POP → credit txn more explicitly (transaction_id already exists; add credit request link)
ALTER TABLE chat_proof_of_payments
  ADD COLUMN IF NOT EXISTS payment_request_id UUID,
  ADD COLUMN IF NOT EXISTS credit_txn_id VARCHAR(80);

CREATE INDEX IF NOT EXISTS idx_cpop_payment_request
  ON chat_proof_of_payments(payment_request_id) WHERE payment_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cpop_credit_txn
  ON chat_proof_of_payments(credit_txn_id) WHERE credit_txn_id IS NOT NULL;
