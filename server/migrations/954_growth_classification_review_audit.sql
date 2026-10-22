-- Additive audit fields for the Demand & Sales Engine classification review
-- queue. Migration numbers 941-953 belong to unrelated restaurant work.

ALTER TABLE classification_review_queue
  ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS review_note TEXT;

CREATE INDEX IF NOT EXISTS classification_review_queue_status_created_idx
  ON classification_review_queue(status, created_at, id);
