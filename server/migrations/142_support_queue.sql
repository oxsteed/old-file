-- Migration 142: Support ticket queue and routing
-- Enables ticket queue management, assignment routing, and queue analytics

CREATE TABLE IF NOT EXISTS support_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES support_conversations(id) ON DELETE CASCADE,
  queue_position INTEGER,
  priority VARCHAR(20) DEFAULT 'normal', -- low, normal, high, urgent
  required_skills TEXT[], -- Array of skills needed for this ticket
  routed_to_agent_id UUID REFERENCES support_agents(id) ON DELETE SET NULL,
  routing_strategy VARCHAR(20) DEFAULT 'round_robin', -- round_robin, skill_based, availability, manual
  queued_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  claimed_at TIMESTAMP,
  removed_at TIMESTAMP,
  reason_removed VARCHAR(100), -- claimed, resolved, escalated, cancelled
  time_in_queue_seconds INTEGER,
  status VARCHAR(20) DEFAULT 'waiting', -- waiting, assigned, in_progress, removed
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_support_queue_business ON support_queue(business_id);
CREATE INDEX IF NOT EXISTS idx_support_queue_conversation ON support_queue(conversation_id);
CREATE INDEX IF NOT EXISTS idx_support_queue_agent ON support_queue(routed_to_agent_id);
CREATE INDEX IF NOT EXISTS idx_support_queue_status ON support_queue(status);
CREATE INDEX IF NOT EXISTS idx_support_queue_priority ON support_queue(priority);
CREATE INDEX IF NOT EXISTS idx_support_queue_queued ON support_queue(queued_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_queue_skills ON support_queue USING GIN(required_skills);

-- Queue events log (audit trail for routing decisions)
CREATE TABLE IF NOT EXISTS queue_events (
  id BIGSERIAL PRIMARY KEY,
  queue_id UUID NOT NULL REFERENCES support_queue(id) ON DELETE CASCADE,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES support_conversations(id) ON DELETE CASCADE,
  event_type VARCHAR(50), -- queued, routed, claimed, reassigned, escalated, removed
  from_agent_id UUID REFERENCES support_agents(id) ON DELETE SET NULL,
  to_agent_id UUID REFERENCES support_agents(id) ON DELETE SET NULL,
  event_reason TEXT,
  routing_rule_applied VARCHAR(100), -- which rule decided the routing
  wait_time_seconds INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_queue_events_queue ON queue_events(queue_id);
CREATE INDEX IF NOT EXISTS idx_queue_events_business ON queue_events(business_id);
CREATE INDEX IF NOT EXISTS idx_queue_events_conversation ON queue_events(conversation_id);
CREATE INDEX IF NOT EXISTS idx_queue_events_type ON queue_events(event_type);
CREATE INDEX IF NOT EXISTS idx_queue_events_created ON queue_events(created_at DESC);

-- Routing rules (configurable per business)
CREATE TABLE IF NOT EXISTS routing_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  rule_name VARCHAR(100) NOT NULL,
  rule_type VARCHAR(50), -- skill_based, availability, language, team, manual
  description TEXT,
  priority INTEGER DEFAULT 0, -- Higher priority rules evaluated first
  condition JSONB, -- JSON structure defining the rule condition
  action JSONB, -- JSON structure defining the action (e.g., route to team)
  is_active BOOLEAN DEFAULT TRUE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_routing_rules_business ON routing_rules(business_id);
CREATE INDEX IF NOT EXISTS idx_routing_rules_priority ON routing_rules(priority DESC);
CREATE INDEX IF NOT EXISTS idx_routing_rules_active ON routing_rules(is_active);

-- Queue analytics snapshots (for dashboard performance)
CREATE TABLE IF NOT EXISTS queue_analytics_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  snapshot_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  queue_length INTEGER DEFAULT 0,
  avg_wait_time_seconds INTEGER,
  longest_wait_time_seconds INTEGER,
  conversations_waiting_by_priority JSONB, -- {low: 2, normal: 5, high: 1, urgent: 0}
  agents_available INTEGER DEFAULT 0,
  agents_busy INTEGER DEFAULT 0,
  agents_on_break INTEGER DEFAULT 0,
  agents_offline INTEGER DEFAULT 0,
  estimated_wait_next_customer_seconds INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_queue_analytics_snapshots_business ON queue_analytics_snapshots(business_id);
CREATE INDEX IF NOT EXISTS idx_queue_analytics_snapshots_snapshot_time ON queue_analytics_snapshots(snapshot_time DESC);
