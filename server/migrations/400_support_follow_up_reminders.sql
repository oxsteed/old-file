-- Explicit next-action reminders for support agents and supervisors.
CREATE TABLE IF NOT EXISTS support_follow_up_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES support_conversations(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
  due_at TIMESTAMPTZ NOT NULL,
  note VARCHAR(2000),
  status VARCHAR(16) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'cancelled')),
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_follow_up_reminders_due
  ON support_follow_up_reminders (status, due_at);

CREATE INDEX IF NOT EXISTS idx_support_follow_up_reminders_conversation
  ON support_follow_up_reminders (conversation_id, status, due_at);
