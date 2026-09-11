-- Capture recommendation intent alongside the existing post-chat CSAT rating.
ALTER TABLE support_conversation_reviews
  ADD COLUMN IF NOT EXISTS nps_score SMALLINT;

ALTER TABLE support_conversation_reviews
  DROP CONSTRAINT IF EXISTS support_conversation_reviews_nps_score_check;

ALTER TABLE support_conversation_reviews
  ADD CONSTRAINT support_conversation_reviews_nps_score_check
  CHECK (nps_score IS NULL OR nps_score BETWEEN 0 AND 10);

CREATE INDEX IF NOT EXISTS idx_support_conversation_reviews_nps
  ON support_conversation_reviews (created_at DESC)
  WHERE nps_score IS NOT NULL;
