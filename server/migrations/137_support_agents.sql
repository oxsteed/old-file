-- Migration 137: Support agents and hiring system
-- Enables multi-tenant support teams with agent hiring, onboarding, and status tracking

-- Support agents table (agents assigned to a business)
CREATE TABLE IF NOT EXISTS support_agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
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
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
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
