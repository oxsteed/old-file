-- Durable quality-assurance reviews for completed support conversations.
CREATE TABLE IF NOT EXISTS support_conversation_qa_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL UNIQUE REFERENCES support_conversations(id) ON DELETE CASCADE,
  reviewer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  score SMALLINT NOT NULL CHECK (score BETWEEN 0 AND 100),
  notes VARCHAR(2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_qa_reviews_reviewer
  ON support_conversation_qa_reviews (reviewer_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_support_qa_reviews_conversation
  ON support_conversation_qa_reviews (conversation_id);
