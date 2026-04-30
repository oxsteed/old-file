-- Migration 141: Support metrics, SLA tracking, and satisfaction surveys
-- Enables SLA monitoring, agent performance tracking, and customer satisfaction measurement

CREATE TABLE IF NOT EXISTS support_sla_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  priority VARCHAR(20) NOT NULL, -- low, normal, high, urgent
  first_response_target_minutes INTEGER NOT NULL, -- Target for first agent response
  resolution_target_hours INTEGER NOT NULL, -- Target for complete resolution
  escalation_threshold_minutes INTEGER, -- Escalate if not first response within this time
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(business_id, priority)
);

CREATE INDEX IF NOT EXISTS idx_support_sla_targets_business ON support_sla_targets(business_id);

-- Conversation metrics (calculated when conversation is closed)
CREATE TABLE IF NOT EXISTS conversation_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES support_conversations(id) ON DELETE CASCADE,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES support_agents(id) ON DELETE SET NULL,
  first_response_time_seconds INTEGER, -- Time from ticket creation to first agent response
  resolution_time_seconds INTEGER, -- Time from creation to resolution
  total_customer_messages INTEGER DEFAULT 0,
  total_agent_messages INTEGER DEFAULT 0,
  total_message_exchanges INTEGER DEFAULT 0,
  customer_satisfaction_score INTEGER, -- 1-5 scale from CSAT survey
  customer_sentiment VARCHAR(20), -- positive, neutral, negative (from message analysis)
  sla_first_response_met BOOLEAN,
  sla_resolution_met BOOLEAN,
  agent_efficiency_rating DECIMAL(3,2), -- 1-5 based on resolution quality
  reopened_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_conversation_metrics_conversation ON conversation_metrics(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conversation_metrics_business ON conversation_metrics(business_id);
CREATE INDEX IF NOT EXISTS idx_conversation_metrics_agent ON conversation_metrics(agent_id);
CREATE INDEX IF NOT EXISTS idx_conversation_metrics_created ON conversation_metrics(created_at DESC);

-- CSAT (Customer Satisfaction) surveys
CREATE TABLE IF NOT EXISTS satisfaction_surveys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES support_conversations(id) ON DELETE CASCADE,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES support_agents(id) ON DELETE SET NULL,
  rating INTEGER, -- 1-5 scale
  nps_score INTEGER, -- 0-10 scale (Net Promoter Score)
  categories JSONB, -- Flexible structure for category ratings (e.g., helpfulness, politeness)
  comment TEXT,
  follow_up_email_sent BOOLEAN DEFAULT FALSE,
  responded_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_satisfaction_surveys_conversation ON satisfaction_surveys(conversation_id);
CREATE INDEX IF NOT EXISTS idx_satisfaction_surveys_business ON satisfaction_surveys(business_id);
CREATE INDEX IF NOT EXISTS idx_satisfaction_surveys_customer ON satisfaction_surveys(customer_id);
CREATE INDEX IF NOT EXISTS idx_satisfaction_surveys_agent ON satisfaction_surveys(agent_id);
CREATE INDEX IF NOT EXISTS idx_satisfaction_surveys_rating ON satisfaction_surveys(rating);
CREATE INDEX IF NOT EXISTS idx_satisfaction_surveys_responded ON satisfaction_surveys(responded_at DESC);

-- Agent performance summary (aggregated daily)
CREATE TABLE IF NOT EXISTS agent_daily_performance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES support_agents(id) ON DELETE CASCADE,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  performance_date DATE NOT NULL,
  conversations_handled INTEGER DEFAULT 0,
  conversations_resolved INTEGER DEFAULT 0,
  avg_first_response_seconds INTEGER,
  avg_resolution_seconds INTEGER,
  avg_csat_score DECIMAL(3,2),
  sla_first_response_met_count INTEGER DEFAULT 0,
  sla_first_response_violated_count INTEGER DEFAULT 0,
  sla_resolution_met_count INTEGER DEFAULT 0,
  sla_resolution_violated_count INTEGER DEFAULT 0,
  total_worked_minutes INTEGER DEFAULT 0,
  total_chat_minutes INTEGER DEFAULT 0,
  conversations_escalated INTEGER DEFAULT 0,
  messages_sent INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(agent_id, performance_date)
);

CREATE INDEX IF NOT EXISTS idx_agent_daily_performance_agent ON agent_daily_performance(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_daily_performance_business ON agent_daily_performance(business_id);
CREATE INDEX IF NOT EXISTS idx_agent_daily_performance_date ON agent_daily_performance(performance_date DESC);

-- Business daily support metrics (aggregated)
CREATE TABLE IF NOT EXISTS business_daily_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  metric_date DATE NOT NULL,
  total_conversations_created INTEGER DEFAULT 0,
  total_conversations_resolved INTEGER DEFAULT 0,
  avg_first_response_seconds INTEGER,
  avg_resolution_seconds INTEGER,
  avg_csat_score DECIMAL(3,2),
  total_agents_active INTEGER DEFAULT 0,
  total_agents_available INTEGER DEFAULT 0,
  queue_length_peak INTEGER DEFAULT 0,
  queue_length_avg INTEGER DEFAULT 0,
  avg_wait_time_seconds INTEGER,
  sla_first_response_compliance DECIMAL(3,2), -- Percentage
  sla_resolution_compliance DECIMAL(3,2), -- Percentage
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(business_id, metric_date)
);

CREATE INDEX IF NOT EXISTS idx_business_daily_metrics_business ON business_daily_metrics(business_id);
CREATE INDEX IF NOT EXISTS idx_business_daily_metrics_date ON business_daily_metrics(metric_date DESC);
