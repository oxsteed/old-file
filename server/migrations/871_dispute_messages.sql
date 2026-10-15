-- Additive, money-neutral: in-statement case follow-up messages on OxSteed
-- Credit disputes (capability 9b). This table stores conversation only; it
-- never stores money movement, and no endpoint that writes here may mutate
-- dispute state, amounts, resolution, journals, holds, or transactions (see
-- routes/statementDisputeMessages.js, which inserts a message row plus an
-- audit event and nothing else).
--
-- Authorization is record-level in the route layer: the dispute owner
-- (oxsteed_credit_disputes.customer_id) or an admin. Unknown and
-- unauthorized disputes return indistinguishable 404s so ownership cannot
-- be probed.
CREATE TABLE IF NOT EXISTS oxsteed_credit_dispute_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id UUID NOT NULL REFERENCES oxsteed_credit_disputes(id) ON DELETE CASCADE,
  author_id UUID NOT NULL,
  author_role TEXT NOT NULL,
  message TEXT NOT NULL CHECK (char_length(message) BETWEEN 1 AND 5000),
  evidence_text TEXT,
  evidence_file_url TEXT,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT oxsteed_credit_dispute_messages_evidence_text_check
    CHECK (evidence_text IS NULL OR char_length(evidence_text) <= 2000),
  CONSTRAINT oxsteed_credit_dispute_messages_key_check
    CHECK (char_length(idempotency_key) BETWEEN 1 AND 160)
);
-- Per-dispute idempotency: the same (dispute_id, idempotency_key) pair
-- replays the original message instead of creating a duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS uq_dispute_messages_dispute_key
  ON oxsteed_credit_dispute_messages (dispute_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_dispute_messages_dispute_created
  ON oxsteed_credit_dispute_messages (dispute_id, created_at);
COMMENT ON TABLE oxsteed_credit_dispute_messages IS
  'In-statement follow-up messages on credit disputes. Conversation only: never money movement, never dispute-state mutation.';
