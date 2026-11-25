-- Group 13 Slice 4e (674, D-371/D-372/D-373): customer dispute evidence.
--
-- No customer evidence path exists today: `openMyDispute` accepts only
-- transaction id, reason code, and description, and migration 463
-- ("dispute_status_evidence") is operator evidence (a resolution note on
-- every status change) — this table is the NEW customer upload/attach path
-- and does not change the 463 trigger.
--
-- One row per attachment or note on the customer's own case. Files live in
-- the existing storage backend under the private prefix
-- `credit-dispute-evidence/` (not in the public-key allowlist); only the
-- storage key is stored here and it never leaves the server — downloads
-- are signed URLs minted at read time. Notes carry no file. Additive only;
-- safe to run twice.
CREATE TABLE IF NOT EXISTS oxsteed_credit_dispute_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id UUID NOT NULL REFERENCES oxsteed_credit_disputes(id) ON DELETE RESTRICT,
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  submitted_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('file', 'note')),
  note TEXT CHECK (note IS NULL OR char_length(note) <= 2000),
  storage_key TEXT,
  original_filename TEXT,
  content_type TEXT,
  size_bytes BIGINT CHECK (size_bytes IS NULL OR size_bytes > 0),
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT oxsteed_credit_dispute_evidence_file_needs_key
    CHECK (kind <> 'file' OR storage_key IS NOT NULL),
  CONSTRAINT oxsteed_credit_dispute_evidence_note_needs_text
    CHECK (kind <> 'note' OR (note IS NOT NULL AND char_length(note) > 0)),
  UNIQUE (dispute_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_credit_dispute_evidence_dispute
  ON oxsteed_credit_dispute_evidence (dispute_id, created_at ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_credit_dispute_evidence_customer
  ON oxsteed_credit_dispute_evidence (customer_id, created_at DESC);
