-- Migration 139: Support conversations and real-time messaging
-- Enables ticket creation, agent assignment, and real-time chat with customers

CREATE TABLE IF NOT EXISTS support_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES support_agents(id) ON DELETE SET NULL,
  subject VARCHAR(255) NOT NULL,
  description TEXT,
  category VARCHAR(50), -- billing, technical, sales, account, general
  priority VARCHAR(20) DEFAULT 'normal', -- low, normal, high, urgent
  status VARCHAR(20) DEFAULT 'open', -- open, in_progress, waiting_for_customer, waiting_for_agent, resolved, closed, escalated
  resolution_status VARCHAR(20), -- resolved, unresolved, no_resolution_needed
  assigned_at TIMESTAMP,
  first_response_at TIMESTAMP,
  resolved_at TIMESTAMP,
  closed_at TIMESTAMP,
  message_count INTEGER DEFAULT 0,
  customer_message_count INTEGER DEFAULT 0,
  agent_message_count INTEGER DEFAULT 0,
  ai_handled BOOLEAN DEFAULT FALSE,
  escalated_from UUID REFERENCES support_agents(id) ON DELETE SET NULL,
  escalation_reason TEXT,
  escalated_at TIMESTAMP,
  estimated_resolution_time TIMESTAMP,
  sla_first_response_target TIMESTAMP,
  sla_resolution_target TIMESTAMP,
  sla_first_response_breached BOOLEAN DEFAULT FALSE,
  sla_resolution_breached BOOLEAN DEFAULT FALSE,
  internal_notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_support_conversations_business ON support_conversations(business_id);
CREATE INDEX IF NOT EXISTS idx_support_conversations_customer ON support_conversations(customer_id);
CREATE INDEX IF NOT EXISTS idx_support_conversations_agent ON support_conversations(agent_id);
CREATE INDEX IF NOT EXISTS idx_support_conversations_status ON support_conversations(status);
CREATE INDEX IF NOT EXISTS idx_support_conversations_priority ON support_conversations(priority);
CREATE INDEX IF NOT EXISTS idx_support_conversations_created ON support_conversations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_conversations_resolved ON support_conversations(resolved_at DESC);

-- Real-time messages within conversations
CREATE TABLE IF NOT EXISTS support_conversation_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES support_conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_type VARCHAR(20) DEFAULT 'text', -- text, attachment, system, kb_article, template
  content TEXT NOT NULL,
  attachment_url TEXT,
  attachment_name VARCHAR(255),
  is_agent BOOLEAN DEFAULT FALSE,
  is_ai BOOLEAN DEFAULT FALSE,
  ai_model VARCHAR(50), -- gpt-4, claude-3, etc.
  status VARCHAR(20) DEFAULT 'sent', -- sent, delivered, read, failed
  read_by_recipient BOOLEAN DEFAULT FALSE,
  read_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_support_conversation_messages_conversation ON support_conversation_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_support_conversation_messages_sender ON support_conversation_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_support_conversation_messages_created ON support_conversation_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_conversation_messages_type ON support_conversation_messages(message_type);

-- Agent-conversation assignments (who's working on what)
CREATE TABLE IF NOT EXISTS conversation_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES support_conversations(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES support_agents(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
  assignment_type VARCHAR(20) DEFAULT 'auto', -- auto, manual, escalation
  claimed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  released_at TIMESTAMP,
  duration_seconds INTEGER,
  status VARCHAR(20) DEFAULT 'active', -- active, released, completed
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_conversation_assignments_conversation ON conversation_assignments(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conversation_assignments_agent ON conversation_assignments(agent_id);
CREATE INDEX IF NOT EXISTS idx_conversation_assignments_status ON conversation_assignments(status);
CREATE INDEX IF NOT EXISTS idx_conversation_assignments_claimed ON conversation_assignments(claimed_at DESC);

-- Pre-chat forms (customer information collected before agent interaction)
CREATE TABLE IF NOT EXISTS pre_chat_forms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES support_conversations(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_name VARCHAR(255),
  customer_email VARCHAR(255),
  customer_phone VARCHAR(20),
  issue_category VARCHAR(100),
  issue_description TEXT,
  attachment_url TEXT,
  form_data JSONB, -- flexible for custom fields
  submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pre_chat_forms_conversation ON pre_chat_forms(conversation_id);
CREATE INDEX IF NOT EXISTS idx_pre_chat_forms_customer ON pre_chat_forms(customer_id);
CREATE INDEX IF NOT EXISTS idx_pre_chat_forms_business ON pre_chat_forms(business_id);
