-- Migration 143: Support teams, escalation policies, and team management
-- Enables team-based support, role hierarchy, and escalation chains

CREATE TABLE IF NOT EXISTS support_teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
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
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
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
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
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
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
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
