-- Approval-gated support AI replies. Drafts are never customer-visible until
-- an authorized support user explicitly applies one.
CREATE TABLE IF NOT EXISTS support_ai_reply_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES support_conversations(id) ON DELETE CASCADE,
  requested_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  source_content VARCHAR(5000) NOT NULL,
  draft_content VARCHAR(5000) NOT NULL,
  language VARCHAR(10) NOT NULL DEFAULT 'en',
  ai_model VARCHAR(100) NOT NULL DEFAULT 'openrouter',
  status VARCHAR(16) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'applied', 'discarded', 'expired')),
  applied_by UUID REFERENCES users(id) ON DELETE SET NULL,
  applied_message_id UUID REFERENCES support_conversation_messages(id) ON DELETE SET NULL,
  applied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_ai_reply_drafts_conversation
  ON support_ai_reply_drafts (conversation_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_support_ai_reply_drafts_business
  ON support_ai_reply_drafts (business_id, status, created_at DESC);
