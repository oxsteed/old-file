
-- >>> BEGIN: 137_payout_methods.sql <<<
-- Migration 137: Payout Method Management
-- Add payout method storage and tracking for seller withdrawals

CREATE TABLE IF NOT EXISTS payout_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  helper_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  method_type VARCHAR(50) NOT NULL, -- 'bank_account', 'paypal', 'stripe_connect'
  status VARCHAR(50) NOT NULL DEFAULT 'pending', -- 'pending', 'verified', 'active', 'inactive'
  is_primary BOOLEAN DEFAULT FALSE,

  -- Bank account details (encrypted in production)
  account_holder_name VARCHAR(255),
  bank_name VARCHAR(255),
  account_last_four VARCHAR(4),
  routing_number_last_four VARCHAR(4),
  account_type VARCHAR(50), -- 'checking', 'savings'

  -- PayPal details
  paypal_email VARCHAR(255),

  -- Stripe Connect details
  stripe_account_id VARCHAR(255),

  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  verified_at TIMESTAMP WITH TIME ZONE,

  CONSTRAINT unique_primary_method_per_helper UNIQUE (helper_id) WHERE is_primary = TRUE,
  CONSTRAINT method_type_check CHECK (method_type IN ('bank_account', 'paypal', 'stripe_connect'))
);

CREATE INDEX idx_payout_methods_helper_id ON payout_methods(helper_id);
CREATE INDEX idx_payout_methods_status ON payout_methods(status);

-- Extend affiliate_payouts table with additional fields
ALTER TABLE IF EXISTS affiliate_payouts ADD COLUMN IF NOT EXISTS payout_method_id UUID REFERENCES payout_methods(id);
ALTER TABLE IF EXISTS affiliate_payouts ADD COLUMN IF NOT EXISTS payment_processor VARCHAR(50), -- 'stripe', 'paypal', 'ach'
ALTER TABLE IF EXISTS affiliate_payouts ADD COLUMN IF NOT EXISTS processor_fee_cents BIGINT DEFAULT 0;
ALTER TABLE IF EXISTS affiliate_payouts ADD COLUMN IF NOT EXISTS net_payout_cents BIGINT; -- gross - fees
ALTER TABLE IF EXISTS affiliate_payouts ADD COLUMN IF NOT EXISTS notes TEXT;

CREATE INDEX idx_affiliate_payouts_payout_method_id ON affiliate_payouts(payout_method_id);

-- Track payout history and status changes
CREATE TABLE IF NOT EXISTS payout_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payout_id UUID NOT NULL REFERENCES affiliate_payouts(id) ON DELETE CASCADE,
  transaction_status VARCHAR(50) NOT NULL, -- 'initiated', 'processing', 'completed', 'failed', 'refunded'
  external_transaction_id VARCHAR(255),
  failure_reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_payout_transactions_payout_id ON payout_transactions(payout_id);
CREATE INDEX idx_payout_transactions_status ON payout_transactions(transaction_status);

-- Payout reconciliation table for matching payments to bank statements
CREATE TABLE IF NOT EXISTS payout_reconciliation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  helper_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payout_id UUID REFERENCES affiliate_payouts(id),
  bank_amount_cents BIGINT NOT NULL,
  bank_date DATE NOT NULL,
  bank_reference VARCHAR(255),
  reconciled BOOLEAN DEFAULT FALSE,
  reconciled_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_payout_reconciliation_helper_id ON payout_reconciliation(helper_id);
CREATE INDEX idx_payout_reconciliation_reconciled ON payout_reconciliation(reconciled);

-- >>> END: 137_payout_methods.sql <<<

-- >>> BEGIN: 137_support_agents.sql <<<
-- Migration 137: Support agents and hiring system
-- Enables multi-tenant support teams with agent hiring, onboarding, and status tracking

-- Support agents table (agents assigned to a business)
CREATE TABLE IF NOT EXISTS support_agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hire_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  status VARCHAR(20) DEFAULT 'active', -- active, inactive, paused, training
  role VARCHAR(20) DEFAULT 'agent', -- agent, supervisor, manager, admin
  department VARCHAR(100), -- e.g., billing, technical, sales
  max_concurrent_chats INTEGER DEFAULT 3,
  is_available BOOLEAN DEFAULT FALSE,
  total_conversations_handled INTEGER DEFAULT 0,
  total_resolved_count INTEGER DEFAULT 0,
  avg_rating DECIMAL(3,2),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(business_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_support_agents_business ON support_agents(business_id);
CREATE INDEX IF NOT EXISTS idx_support_agents_user ON support_agents(user_id);
CREATE INDEX IF NOT EXISTS idx_support_agents_status ON support_agents(status);
CREATE INDEX IF NOT EXISTS idx_support_agents_available ON support_agents(is_available);

-- Agent applications (hiring flow)
CREATE TABLE IF NOT EXISTS agent_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_title VARCHAR(200) NOT NULL,
  experience_level VARCHAR(50), -- entry, intermediate, expert
  languages TEXT[], -- Array of language codes
  availability TEXT, -- e.g., "Full-time", "Part-time", "Flexible"
  resume_url TEXT,
  cover_letter TEXT,
  status VARCHAR(20) DEFAULT 'pending', -- pending, approved, rejected, hired
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  review_notes TEXT,
  reviewed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agent_applications_business ON agent_applications(business_id);
CREATE INDEX IF NOT EXISTS idx_agent_applications_user ON agent_applications(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_applications_status ON agent_applications(status);

-- Agent skills and expertise
CREATE TABLE IF NOT EXISTS agent_skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES support_agents(id) ON DELETE CASCADE,
  skill_name VARCHAR(100) NOT NULL,
  proficiency_level VARCHAR(20) DEFAULT 'intermediate', -- beginner, intermediate, expert
  years_of_experience INTEGER,
  verified BOOLEAN DEFAULT FALSE,
  certified_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(agent_id, skill_name)
);

CREATE INDEX IF NOT EXISTS idx_agent_skills_agent ON agent_skills(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_skills_skill ON agent_skills(skill_name);

-- Agent availability log (for tracking status changes and availability windows)
CREATE TABLE IF NOT EXISTS agent_availability_log (
  id BIGSERIAL PRIMARY KEY,
  agent_id UUID NOT NULL REFERENCES support_agents(id) ON DELETE CASCADE,
  status VARCHAR(20), -- available, busy, break, offline, lunch
  status_changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  reason VARCHAR(255), -- why status changed
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agent_availability_log_agent ON agent_availability_log(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_availability_log_status ON agent_availability_log(status);
CREATE INDEX IF NOT EXISTS idx_agent_availability_log_created ON agent_availability_log(created_at DESC);

-- >>> END: 137_support_agents.sql <<<

-- >>> BEGIN: 138_support_shifts.sql <<<
-- Migration 138: Agent shifts and scheduling
-- Enables shift management, clock in/out, break tracking, and availability windows

CREATE TABLE IF NOT EXISTS agent_shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES support_agents(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  shift_date DATE NOT NULL,
  scheduled_start TIME,
  scheduled_end TIME,
  actual_clock_in TIMESTAMP,
  actual_clock_out TIMESTAMP,
  break_start TIMESTAMP,
  break_end TIMESTAMP,
  total_break_minutes INTEGER DEFAULT 0,
  total_worked_minutes INTEGER DEFAULT 0,
  status VARCHAR(20) DEFAULT 'scheduled', -- scheduled, clocked_in, on_break, clocked_out, no_show, cancelled
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agent_shifts_agent ON agent_shifts(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_shifts_business ON agent_shifts(business_id);
CREATE INDEX IF NOT EXISTS idx_agent_shifts_date ON agent_shifts(shift_date);
CREATE INDEX IF NOT EXISTS idx_agent_shifts_status ON agent_shifts(status);
CREATE INDEX IF NOT EXISTS idx_agent_shifts_agent_date ON agent_shifts(agent_id, shift_date);

-- Shift templates (recurring schedules)
CREATE TABLE IF NOT EXISTS shift_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES support_agents(id) ON DELETE CASCADE,
  day_of_week INTEGER, -- 0=Sunday, 6=Saturday
  start_time TIME,
  end_time TIME,
  max_concurrent_chats INTEGER DEFAULT 3,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(agent_id, day_of_week)
);

CREATE INDEX IF NOT EXISTS idx_shift_templates_agent ON shift_templates(agent_id);
CREATE INDEX IF NOT EXISTS idx_shift_templates_business ON shift_templates(business_id);

-- Shift availability snapshots (for real-time queue decisions)
CREATE TABLE IF NOT EXISTS agent_availability_snapshots (
  id BIGSERIAL PRIMARY KEY,
  agent_id UUID NOT NULL REFERENCES support_agents(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  is_clocked_in BOOLEAN DEFAULT FALSE,
  current_chat_count INTEGER DEFAULT 0,
  max_concurrent_chats INTEGER DEFAULT 3,
  is_on_break BOOLEAN DEFAULT FALSE,
  is_available BOOLEAN DEFAULT FALSE,
  status VARCHAR(20) DEFAULT 'offline', -- offline, available, busy, break
  last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agent_availability_snapshots_agent ON agent_availability_snapshots(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_availability_snapshots_business ON agent_availability_snapshots(business_id);
CREATE INDEX IF NOT EXISTS idx_agent_availability_snapshots_status ON agent_availability_snapshots(status);
CREATE INDEX IF NOT EXISTS idx_agent_availability_snapshots_recorded ON agent_availability_snapshots(recorded_at DESC);

-- Break types configuration
CREATE TABLE IF NOT EXISTS break_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  break_name VARCHAR(100) NOT NULL,
  duration_minutes INTEGER NOT NULL,
  max_per_shift INTEGER DEFAULT 1,
  requires_approval BOOLEAN DEFAULT FALSE,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(business_id, break_name)
);

CREATE INDEX IF NOT EXISTS idx_break_types_business ON break_types(business_id);

-- >>> END: 138_support_shifts.sql <<<

-- >>> BEGIN: 139_ab_testing.sql <<<
-- Migration 139: A/B Testing Framework for Discount Codes
-- Comprehensive A/B testing system with statistical significance testing

CREATE TABLE IF NOT EXISTS ab_tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  helper_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  test_name VARCHAR(255) NOT NULL,
  description TEXT,
  test_type VARCHAR(50) NOT NULL, -- 'discount_code', 'pricing', 'messaging'
  status VARCHAR(50) NOT NULL DEFAULT 'draft', -- 'draft', 'running', 'paused', 'completed'

  -- Test duration
  start_date TIMESTAMP WITH TIME ZONE,
  end_date TIMESTAMP WITH TIME ZONE,
  planned_duration_days INTEGER,

  -- Targeting
  target_audience VARCHAR(100), -- 'all', 'new_users', 'returning', 'segment_name'
  traffic_allocation_percentage INTEGER DEFAULT 100, -- 0-100

  -- Statistical parameters
  min_sample_size INTEGER DEFAULT 100,
  confidence_level DECIMAL(3,2) DEFAULT 0.95, -- 95% confidence
  power DECIMAL(3,2) DEFAULT 0.80, -- 80% power
  expected_effect_size DECIMAL(5,3), -- Expected uplift percentage

  -- Status flags
  winner_id UUID, -- Reference to winning variant
  statistically_significant BOOLEAN DEFAULT FALSE,
  p_value DECIMAL(10,6),

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_ab_tests_helper_id ON ab_tests(helper_id);
CREATE INDEX idx_ab_tests_status ON ab_tests(status);

-- A/B test variants
CREATE TABLE IF NOT EXISTS ab_test_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id UUID NOT NULL REFERENCES ab_tests(id) ON DELETE CASCADE,
  variant_name VARCHAR(255) NOT NULL, -- 'Control', 'Variant A', 'Variant B', etc.
  is_control BOOLEAN DEFAULT FALSE,

  -- For discount code tests
  discount_code_id UUID REFERENCES discount_codes(id),

  -- Variant configuration
  discount_percentage DECIMAL(5,2),
  discount_fixed_amount_cents BIGINT,
  discount_description TEXT,

  -- Metrics snapshots
  views_count BIGINT DEFAULT 0,
  clicks_count BIGINT DEFAULT 0,
  conversions_count BIGINT DEFAULT 0,
  revenue_cents BIGINT DEFAULT 0,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_ab_test_variants_test_id ON ab_test_variants(test_id);
CREATE INDEX idx_ab_test_variants_is_control ON ab_test_variants(is_control);

-- Session-level test assignment tracking
CREATE TABLE IF NOT EXISTS ab_test_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id UUID NOT NULL REFERENCES ab_tests(id) ON DELETE CASCADE,
  variant_id UUID NOT NULL REFERENCES ab_test_variants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  session_id VARCHAR(255),

  -- Event tracking
  assigned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  viewed_at TIMESTAMP WITH TIME ZONE,
  clicked_at TIMESTAMP WITH TIME ZONE,
  converted_at TIMESTAMP WITH TIME ZONE,

  -- Revenue tracking
  order_id UUID REFERENCES marketplace_orders(id),
  revenue_cents BIGINT,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_ab_test_assignments_test_variant ON ab_test_assignments(test_id, variant_id);
CREATE INDEX idx_ab_test_assignments_user ON ab_test_assignments(user_id);
CREATE INDEX idx_ab_test_assignments_assigned_at ON ab_test_assignments(assigned_at);

-- Daily aggregated metrics per variant
CREATE TABLE IF NOT EXISTS ab_test_daily_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id UUID NOT NULL REFERENCES ab_test_variants(id) ON DELETE CASCADE,
  metric_date DATE NOT NULL,

  -- Counts
  new_assignments BIGINT DEFAULT 0,
  total_views BIGINT DEFAULT 0,
  total_clicks BIGINT DEFAULT 0,
  total_conversions BIGINT DEFAULT 0,
  total_revenue_cents BIGINT DEFAULT 0,

  -- Rates
  conversion_rate DECIMAL(5,2),
  click_through_rate DECIMAL(5,2),
  average_order_value_cents BIGINT,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_ab_test_daily_metrics_variant_date ON ab_test_daily_metrics(variant_id, metric_date);

-- Statistical analysis results (cached)
CREATE TABLE IF NOT EXISTS ab_test_statistics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id UUID NOT NULL REFERENCES ab_tests(id) ON DELETE CASCADE,
  analysis_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Variant 1 (Control) stats
  variant1_id UUID REFERENCES ab_test_variants(id),
  variant1_conversions BIGINT,
  variant1_conversion_rate DECIMAL(5,3),
  variant1_confidence_interval_lower DECIMAL(5,3),
  variant1_confidence_interval_upper DECIMAL(5,3),

  -- Variant 2 stats
  variant2_id UUID REFERENCES ab_test_variants(id),
  variant2_conversions BIGINT,
  variant2_conversion_rate DECIMAL(5,3),
  variant2_confidence_interval_lower DECIMAL(5,3),
  variant2_confidence_interval_upper DECIMAL(5,3),

  -- Chi-square test results
  chi_square_statistic DECIMAL(10,4),
  p_value DECIMAL(10,6),
  degrees_of_freedom INTEGER,

  -- Practical significance
  relative_uplift_percentage DECIMAL(5,2), -- (V2 - V1) / V1 * 100
  is_statistically_significant BOOLEAN,
  confidence_level_achieved DECIMAL(3,2),

  -- Sample sizes
  variant1_sample_size BIGINT,
  variant2_sample_size BIGINT,
  total_sample_size BIGINT,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_ab_test_statistics_test_id ON ab_test_statistics(test_id);

-- A/B test reports (for export and history)
CREATE TABLE IF NOT EXISTS ab_test_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id UUID NOT NULL REFERENCES ab_tests(id) ON DELETE CASCADE,
  report_type VARCHAR(50) NOT NULL, -- 'interim', 'final'

  summary_json JSONB, -- Stores summary metrics
  statistical_results JSONB, -- Stores chi-square and p-value results
  recommendation TEXT, -- 'Continue test', 'Stop - Variant A wins', etc.

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_ab_test_reports_test_id ON ab_test_reports(test_id);

-- >>> END: 139_ab_testing.sql <<<

-- >>> BEGIN: 139_support_conversations.sql <<<
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

-- >>> END: 139_support_conversations.sql <<<

-- >>> BEGIN: 140_create_support_messages.sql <<<
-- Migration 140: Support Messages with 180-day Auto-Retention
-- Stores all customer-agent chat conversations with auto-expiry timestamps

CREATE TABLE IF NOT EXISTS support_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES support_conversations(id) ON DELETE CASCADE,
  sender_type VARCHAR(20) NOT NULL CHECK (sender_type IN ('customer', 'agent', 'system')),
  sender_id UUID,
  sender_name VARCHAR(255),
  content TEXT NOT NULL,
  message_type VARCHAR(50) DEFAULT 'text', -- 'text', 'file', 'system_notification'
  metadata JSONB, -- For storing file URLs, typing indicators, etc.
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP DEFAULT NOW() + INTERVAL '180 days',
  deleted_at TIMESTAMP
);

-- Indexes for efficient querying
CREATE INDEX idx_support_messages_ticket_id ON support_messages(ticket_id);
CREATE INDEX idx_support_messages_expires_at ON support_messages(expires_at);
CREATE INDEX idx_support_messages_created_at ON support_messages(created_at DESC);
CREATE INDEX idx_support_messages_sender_id ON support_messages(sender_id);

-- Ensure old messages can be queried for deletion
CREATE INDEX idx_support_messages_soft_delete ON support_messages(deleted_at) WHERE deleted_at IS NOT NULL;

-- Add created_at and updated_at to support_conversations if not exists
ALTER TABLE support_conversations
ADD COLUMN IF NOT EXISTS conversation_started_at TIMESTAMP DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMP DEFAULT NOW();

-- Index for conversation querying
CREATE INDEX IF NOT EXISTS idx_support_conversations_last_message
ON support_conversations(last_message_at DESC);

-- >>> END: 140_create_support_messages.sql <<<
