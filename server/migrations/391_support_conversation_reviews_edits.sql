-- Customer-facing live support improvements.
-- Keep edits auditable and allow verified guests to review platform support.

ALTER TABLE support_conversation_messages
  ADD COLUMN IF NOT EXISTS original_content TEXT,
  ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS edit_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_support_conversation_messages_edited
  ON support_conversation_messages (edited_at DESC)
  WHERE edited_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS support_conversation_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL UNIQUE REFERENCES support_conversations(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES users(id) ON DELETE SET NULL,
  guest_email VARCHAR(320),
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment VARCHAR(1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (customer_id IS NOT NULL OR guest_email IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_support_conversation_reviews_customer
  ON support_conversation_reviews (customer_id)
  WHERE customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_support_conversation_reviews_guest_email
  ON support_conversation_reviews (guest_email)
  WHERE guest_email IS NOT NULL;
