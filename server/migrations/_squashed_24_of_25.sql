
-- >>> BEGIN: 140_knowledge_base.sql <<<
-- Migration 140: Knowledge base and canned responses
-- Enables self-service KB articles, search, and pre-written response templates

CREATE TABLE IF NOT EXISTS knowledge_base_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  category_name VARCHAR(100) NOT NULL,
  slug VARCHAR(100) NOT NULL,
  description TEXT,
  display_order INTEGER DEFAULT 0,
  is_public BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(business_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_base_categories_business ON knowledge_base_categories(business_id);

-- Knowledge base articles
CREATE TABLE IF NOT EXISTS knowledge_base_articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES knowledge_base_categories(id) ON DELETE SET NULL,
  title VARCHAR(500) NOT NULL,
  slug VARCHAR(500) NOT NULL,
  content TEXT NOT NULL,
  excerpt TEXT,
  author_id UUID REFERENCES users(id) ON DELETE SET NULL,
  keywords TEXT[], -- Array of search keywords
  language VARCHAR(10) DEFAULT 'en',
  is_published BOOLEAN DEFAULT FALSE,
  is_featured BOOLEAN DEFAULT FALSE,
  view_count INTEGER DEFAULT 0,
  helpful_count INTEGER DEFAULT 0,
  unhelpful_count INTEGER DEFAULT 0,
  estimated_read_time_minutes INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  published_at TIMESTAMP,
  UNIQUE(business_id, slug, language)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_base_articles_business ON knowledge_base_articles(business_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_base_articles_category ON knowledge_base_articles(category_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_base_articles_published ON knowledge_base_articles(is_published);
CREATE INDEX IF NOT EXISTS idx_knowledge_base_articles_featured ON knowledge_base_articles(is_featured);
CREATE INDEX IF NOT EXISTS idx_knowledge_base_articles_keywords ON knowledge_base_articles USING GIN(keywords);
CREATE INDEX IF NOT EXISTS idx_knowledge_base_articles_slug ON knowledge_base_articles(slug);

-- Canned responses (pre-written response templates)
CREATE TABLE IF NOT EXISTS canned_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  category VARCHAR(100),
  title VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  shortcut VARCHAR(50), -- e.g., "refund_approved" → expands to full response
  language VARCHAR(10) DEFAULT 'en',
  usage_count INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(business_id, shortcut, language)
);

CREATE INDEX IF NOT EXISTS idx_canned_responses_business ON canned_responses(business_id);
CREATE INDEX IF NOT EXISTS idx_canned_responses_category ON canned_responses(category);
CREATE INDEX IF NOT EXISTS idx_canned_responses_language ON canned_responses(language);
CREATE INDEX IF NOT EXISTS idx_canned_responses_active ON canned_responses(is_active);
CREATE INDEX IF NOT EXISTS idx_canned_responses_shortcut ON canned_responses(shortcut);

-- Article feedback/ratings
CREATE TABLE IF NOT EXISTS knowledge_base_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id UUID NOT NULL REFERENCES knowledge_base_articles(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  helpful BOOLEAN, -- true = helpful, false = not helpful, NULL = no rating
  comment TEXT,
  email VARCHAR(255), -- for anonymous feedback
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_knowledge_base_feedback_article ON knowledge_base_feedback(article_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_base_feedback_user ON knowledge_base_feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_base_feedback_helpful ON knowledge_base_feedback(helpful);

-- Search index materialization (for full-text search optimization)
CREATE TABLE IF NOT EXISTS knowledge_base_search_index (
  id BIGSERIAL PRIMARY KEY,
  article_id UUID NOT NULL REFERENCES knowledge_base_articles(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  search_text TEXT, -- concatenated title + content + keywords for full-text search
  last_indexed TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(article_id)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_base_search_index_business ON knowledge_base_search_index(business_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_base_search_index_text ON knowledge_base_search_index USING GIN(to_tsvector('english', search_text));

-- >>> END: 140_knowledge_base.sql <<<

-- >>> BEGIN: 141_support_metrics.sql <<<
-- Migration 141: Support metrics, SLA tracking, and satisfaction surveys
-- Enables SLA monitoring, agent performance tracking, and customer satisfaction measurement

CREATE TABLE IF NOT EXISTS support_sla_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
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
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
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
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
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
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
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
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
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

-- >>> END: 141_support_metrics.sql <<<

-- >>> BEGIN: 142_support_queue.sql <<<
-- Migration 142: Support ticket queue and routing
-- Enables ticket queue management, assignment routing, and queue analytics

CREATE TABLE IF NOT EXISTS support_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
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
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
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
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
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
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
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

-- >>> END: 142_support_queue.sql <<<

-- >>> BEGIN: 143_support_teams.sql <<<
-- Migration 143: Support teams, escalation policies, and team management
-- Enables team-based support, role hierarchy, and escalation chains

CREATE TABLE IF NOT EXISTS support_teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  team_name VARCHAR(100) NOT NULL,
  team_type VARCHAR(50), -- tier1, tier2, tier3, specialized (e.g., billing, technical)
  description TEXT,
  max_queue_length INTEGER DEFAULT 50,
  manager_id UUID REFERENCES support_agents(id) ON DELETE SET NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(business_id, team_name)
);

CREATE INDEX IF NOT EXISTS idx_support_teams_business ON support_teams(business_id);
CREATE INDEX IF NOT EXISTS idx_support_teams_manager ON support_teams(manager_id);

-- Team membership
CREATE TABLE IF NOT EXISTS team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES support_teams(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES support_agents(id) ON DELETE CASCADE,
  role VARCHAR(50), -- member, lead, supervisor, manager
  joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  left_at TIMESTAMP,
  is_active BOOLEAN DEFAULT TRUE,
  UNIQUE(team_id, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_team_members_team ON team_members(team_id);
CREATE INDEX IF NOT EXISTS idx_team_members_agent ON team_members(agent_id);
CREATE INDEX IF NOT EXISTS idx_team_members_active ON team_members(is_active);

-- Escalation policies (routing chains)
CREATE TABLE IF NOT EXISTS escalation_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  policy_name VARCHAR(100) NOT NULL,
  description TEXT,
  trigger_condition VARCHAR(100), -- sla_breach, timeout, urgent_priority, agent_unavailable, customer_request
  escalation_delay_minutes INTEGER DEFAULT 5, -- Wait time before escalation
  max_escalation_steps INTEGER DEFAULT 3,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(business_id, policy_name)
);

CREATE INDEX IF NOT EXISTS idx_escalation_policies_business ON escalation_policies(business_id);
CREATE INDEX IF NOT EXISTS idx_escalation_policies_active ON escalation_policies(is_active);

-- Escalation steps (define the escalation chain)
CREATE TABLE IF NOT EXISTS escalation_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id UUID NOT NULL REFERENCES escalation_policies(id) ON DELETE CASCADE,
  step_number INTEGER NOT NULL, -- 1, 2, 3, ...
  escalate_to_team_id UUID REFERENCES support_teams(id) ON DELETE SET NULL,
  escalate_to_agent_id UUID REFERENCES support_agents(id) ON DELETE SET NULL,
  escalate_to_manager BOOLEAN DEFAULT FALSE, -- Escalate to team manager
  wait_minutes INTEGER DEFAULT 5, -- Time before next escalation if not resolved
  notify_method VARCHAR(50), -- email, sms, slack, in_app
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(policy_id, step_number)
);

CREATE INDEX IF NOT EXISTS idx_escalation_steps_policy ON escalation_steps(policy_id);
CREATE INDEX IF NOT EXISTS idx_escalation_steps_team ON escalation_steps(escalate_to_team_id);

-- Team skills (which skills each team handles)
CREATE TABLE IF NOT EXISTS team_skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES support_teams(id) ON DELETE CASCADE,
  skill_name VARCHAR(100) NOT NULL,
  min_proficiency_level VARCHAR(20) DEFAULT 'intermediate', -- beginner, intermediate, expert
  is_primary BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(team_id, skill_name)
);

CREATE INDEX IF NOT EXISTS idx_team_skills_team ON team_skills(team_id);
CREATE INDEX IF NOT EXISTS idx_team_skills_skill ON team_skills(skill_name);

-- Escalation history (audit trail of escalations)
CREATE TABLE IF NOT EXISTS escalation_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES support_conversations(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  escalation_policy_id UUID REFERENCES escalation_policies(id) ON DELETE SET NULL,
  from_agent_id UUID REFERENCES support_agents(id) ON DELETE SET NULL,
  to_agent_id UUID REFERENCES support_agents(id) ON DELETE SET NULL,
  from_team_id UUID REFERENCES support_teams(id) ON DELETE SET NULL,
  to_team_id UUID REFERENCES support_teams(id) ON DELETE SET NULL,
  escalation_step_number INTEGER,
  escalation_reason TEXT,
  resolved_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_escalation_history_conversation ON escalation_history(conversation_id);
CREATE INDEX IF NOT EXISTS idx_escalation_history_business ON escalation_history(business_id);
CREATE INDEX IF NOT EXISTS idx_escalation_history_from_agent ON escalation_history(from_agent_id);
CREATE INDEX IF NOT EXISTS idx_escalation_history_to_agent ON escalation_history(to_agent_id);
CREATE INDEX IF NOT EXISTS idx_escalation_history_created ON escalation_history(created_at DESC);

-- Team performance summary (aggregated metrics)
CREATE TABLE IF NOT EXISTS team_daily_performance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES support_teams(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  performance_date DATE NOT NULL,
  conversations_handled INTEGER DEFAULT 0,
  conversations_resolved INTEGER DEFAULT 0,
  avg_resolution_time_seconds INTEGER,
  avg_csat_score DECIMAL(3,2),
  escalations_received INTEGER DEFAULT 0,
  escalations_sent_to_next_level INTEGER DEFAULT 0,
  sla_compliance_percent DECIMAL(3,2),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(team_id, performance_date)
);

CREATE INDEX IF NOT EXISTS idx_team_daily_performance_team ON team_daily_performance(team_id);
CREATE INDEX IF NOT EXISTS idx_team_daily_performance_business ON team_daily_performance(business_id);
CREATE INDEX IF NOT EXISTS idx_team_daily_performance_date ON team_daily_performance(performance_date DESC);

-- >>> END: 143_support_teams.sql <<<

-- >>> BEGIN: 144_support_message_retention.sql <<<
-- Migration 144: Support Messages with 180-day Auto-Retention
-- Stores all customer-agent chat conversations with auto-expiry timestamps
-- GDPR/CCPA compliant: Messages auto-delete after 180 days

CREATE TABLE IF NOT EXISTS support_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL,
  sender_type VARCHAR(20) NOT NULL CHECK (sender_type IN ('customer', 'agent', 'system')),
  sender_id UUID,
  sender_name VARCHAR(255),
  content TEXT NOT NULL,
  message_type VARCHAR(50) DEFAULT 'text',
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP DEFAULT NOW() + INTERVAL '180 days',
  deleted_at TIMESTAMP
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_support_messages_ticket_id ON support_messages(ticket_id);
CREATE INDEX IF NOT EXISTS idx_support_messages_expires_at ON support_messages(expires_at);
CREATE INDEX IF NOT EXISTS idx_support_messages_created_at ON support_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_messages_sender_id ON support_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_support_messages_soft_delete ON support_messages(deleted_at) WHERE deleted_at IS NOT NULL;

-- Add retention tracking columns to support_conversations if needed
ALTER TABLE IF EXISTS support_conversations
ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMP DEFAULT NOW();

-- >>> END: 144_support_message_retention.sql <<<

-- >>> BEGIN: 145_legal_documents.sql <<<
-- Migration 145: Legal Documents System
-- Core table for managing legal documents (T&C, Privacy Policy, etc.)

CREATE TABLE IF NOT EXISTS legal_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Document metadata
  category VARCHAR(50) NOT NULL,  -- 'terms_of_service', 'privacy_policy', 'helper_agreement', 'seller_agreement', etc.
  title VARCHAR(255) NOT NULL,
  description TEXT,

  -- Content & versioning
  current_version INT DEFAULT 1,
  current_content TEXT NOT NULL,  -- Latest published version

  -- Status workflow
  status VARCHAR(20) NOT NULL DEFAULT 'draft',  -- 'draft', 'pending_review', 'scheduled', 'live', 'archived'
  effective_date TIMESTAMP,  -- When this version becomes binding
  archived_at TIMESTAMP,  -- When document was archived

  -- Configuration
  requires_reacceptance BOOLEAN DEFAULT FALSE,  -- Force users to re-accept on change
  is_critical BOOLEAN DEFAULT FALSE,  -- Critical changes trigger email notification
  notify_users BOOLEAN DEFAULT FALSE,  -- Whether to email users on publish
  grandfather_existing BOOLEAN DEFAULT TRUE,  -- Don't retroactively apply to old users

  -- Multilingual support
  languages VARCHAR(20)[] DEFAULT ARRAY['en'],  -- Supported languages
  default_language VARCHAR(10) DEFAULT 'en',

  -- Audit trail
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),

  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMP DEFAULT NOW(),

  published_by UUID REFERENCES users(id),
  published_at TIMESTAMP,

  -- Approval workflow
  awaiting_review_since TIMESTAMP,
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMP,
  review_notes TEXT,

  CONSTRAINT valid_category CHECK (category IN ('terms_of_service', 'privacy_policy', 'helper_agreement', 'seller_agreement', 'payment_terms', 'dispute_resolution', 'data_retention', 'background_check_policy', 'fcra_compliance', 'incident_response', 'accessibility_policy')),
  CONSTRAINT valid_status CHECK (status IN ('draft', 'pending_review', 'scheduled', 'live', 'archived'))
);

-- Indexes for common queries
CREATE INDEX idx_legal_documents_category_status ON legal_documents(category, status);
CREATE INDEX idx_legal_documents_effective_date ON legal_documents(effective_date);
CREATE INDEX idx_legal_documents_created_by ON legal_documents(created_by);
CREATE INDEX idx_legal_documents_language ON legal_documents USING GIN(languages);

-- Track document changes in version history
CREATE TABLE IF NOT EXISTS legal_document_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES legal_documents(id) ON DELETE CASCADE,

  -- Version details
  version_number INT NOT NULL,
  title VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,

  -- Change metadata
  change_summary TEXT,  -- What changed in this version
  changed_sections VARCHAR(100)[],  -- Which sections were modified

  -- Status when this version was published
  status VARCHAR(20) NOT NULL,
  effective_date TIMESTAMP,

  -- Audit trail
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),

  published_by UUID REFERENCES users(id),
  published_at TIMESTAMP,

  CONSTRAINT valid_version_status CHECK (status IN ('draft', 'pending_review', 'scheduled', 'live', 'archived')),
  CONSTRAINT unique_version_per_doc UNIQUE(document_id, version_number)
);

CREATE INDEX idx_legal_document_versions_document_id ON legal_document_versions(document_id);
CREATE INDEX idx_legal_document_versions_published_at ON legal_document_versions(published_at);

-- User acceptance tracking
CREATE TABLE IF NOT EXISTS user_legal_acceptances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES legal_documents(id),
  version_number INT NOT NULL,

  -- Acceptance details
  accepted_at TIMESTAMP DEFAULT NOW(),
  ip_address VARCHAR(45),  -- Hashed for privacy
  user_agent TEXT,

  -- Electronic signature (per SEC rules)
  signature_first_name VARCHAR(100),
  signature_last_name VARCHAR(100),
  signature_timestamp TIMESTAMP,

  -- Legal hold (compliance)
  cannot_delete_until TIMESTAMP,  -- For compliance holds

  CONSTRAINT unique_user_version_acceptance UNIQUE(user_id, document_id, version_number)
);

CREATE INDEX idx_user_legal_acceptances_user_id ON user_legal_acceptances(user_id);
CREATE INDEX idx_user_legal_acceptances_document_id ON user_legal_acceptances(document_id);
CREATE INDEX idx_user_legal_acceptances_accepted_at ON user_legal_acceptances(accepted_at);

-- Latest acceptance per user per document (denormalized for performance)
CREATE TABLE IF NOT EXISTS user_legal_acceptances_latest (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES legal_documents(id),
  version_number INT NOT NULL,
  accepted_at TIMESTAMP,

  PRIMARY KEY (user_id, document_id),
  FOREIGN KEY (user_id, document_id, version_number) REFERENCES user_legal_acceptances(user_id, document_id, version_number)
);

CREATE INDEX idx_user_legal_acceptances_latest_document ON user_legal_acceptances_latest(document_id);

-- >>> END: 145_legal_documents.sql <<<
