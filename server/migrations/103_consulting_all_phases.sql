-- PHASE 1: Consultant Management
CREATE TABLE consultants (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(50) NOT NULL CHECK (role IN ('phase_guide', 'strategist', 'advisor', 'specialist')),
  bio TEXT,
  expertise_areas TEXT[] DEFAULT '{}',
  specializations JSONB DEFAULT '{}',
  availability_hours_per_week INT DEFAULT 20,
  rate_per_hour INT DEFAULT 0,
  client_limit INT DEFAULT 10,
  current_clients_count INT DEFAULT 0,
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_consultants_user_id ON consultants(user_id);
CREATE INDEX idx_consultants_role_status ON consultants(role, status) WHERE status = 'active';

-- Consultant availability
CREATE TABLE consultant_availability (
  id BIGSERIAL PRIMARY KEY,
  consultant_id BIGINT NOT NULL REFERENCES consultants(id) ON DELETE CASCADE,
  day_of_week INT NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  timezone VARCHAR(50) DEFAULT 'UTC',
  is_available BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_consultant_availability_consultant ON consultant_availability(consultant_id, day_of_week);

-- Extend consulting_sessions with consultant assignment
ALTER TABLE consulting_sessions ADD COLUMN consultant_id BIGINT REFERENCES consultants(id) ON DELETE SET NULL;
ALTER TABLE consulting_sessions ADD COLUMN assigned_at TIMESTAMP;
ALTER TABLE consulting_sessions ADD COLUMN claimed_at TIMESTAMP;
ALTER TABLE consulting_sessions ADD COLUMN consultant_notes JSONB DEFAULT '{}';

CREATE INDEX idx_consulting_sessions_consultant ON consulting_sessions(consultant_id);
CREATE INDEX idx_consulting_sessions_assigned_at ON consulting_sessions(assigned_at DESC);

-- PHASE 2: Scheduling
CREATE TABLE consulting_sessions_scheduled (
  id BIGSERIAL PRIMARY KEY,
  session_id BIGINT NOT NULL UNIQUE REFERENCES consulting_sessions(id) ON DELETE CASCADE,
  scheduled_date DATE NOT NULL,
  scheduled_time TIME NOT NULL,
  duration_minutes INT DEFAULT 120,
  meeting_url VARCHAR(500),
  meeting_type VARCHAR(50) CHECK (meeting_type IN ('zoom', 'google_meet', 'phone', 'in_person')),
  status VARCHAR(50) DEFAULT 'pending_confirmation' CHECK (status IN ('pending_confirmation', 'confirmed', 'completed', 'no_show', 'cancelled')),
  reminder_sent_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_consulting_sessions_scheduled_date ON consulting_sessions_scheduled(scheduled_date, scheduled_time);
CREATE INDEX idx_consulting_sessions_scheduled_session ON consulting_sessions_scheduled(session_id);

CREATE TABLE consulting_session_notes (
  id BIGSERIAL PRIMARY KEY,
  session_id BIGINT NOT NULL REFERENCES consulting_sessions(id) ON DELETE CASCADE,
  consultant_id BIGINT REFERENCES consultants(id) ON DELETE SET NULL,
  note_type VARCHAR(50) CHECK (note_type IN ('phase_assessment', 'deliverable', 'action_items', 'general')),
  content TEXT NOT NULL,
  is_internal BOOLEAN DEFAULT false,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_consulting_session_notes_session ON consulting_session_notes(session_id);
CREATE INDEX idx_consulting_session_notes_internal ON consulting_session_notes(session_id) WHERE is_internal = false;

-- PHASE 3: Session Delivery & Progress
CREATE TABLE consulting_session_phases (
  id BIGSERIAL PRIMARY KEY,
  session_id BIGINT NOT NULL UNIQUE REFERENCES consulting_sessions(id) ON DELETE CASCADE,
  current_phase INT NOT NULL CHECK (current_phase >= 1 AND current_phase <= 30),
  phase_name VARCHAR(255),
  progress_pct INT DEFAULT 0 CHECK (progress_pct >= 0 AND progress_pct <= 100),
  phase_notes JSONB DEFAULT '{}',
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_consulting_session_phases_session ON consulting_session_phases(session_id);

CREATE TABLE consulting_deliverables (
  id BIGSERIAL PRIMARY KEY,
  session_id BIGINT NOT NULL REFERENCES consulting_sessions(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  deliverable_type VARCHAR(100) CHECK (deliverable_type IN ('sop', 'contract', 'financial_tracker', 'marketing_plan', 'team_structure', 'operational_manual', 'other')),
  due_date DATE,
  status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'overdue')),
  file_url VARCHAR(500),
  completed_date TIMESTAMP,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_consulting_deliverables_session ON consulting_deliverables(session_id);
CREATE INDEX idx_consulting_deliverables_status ON consulting_deliverables(session_id, status);

CREATE TABLE consulting_action_items (
  id BIGSERIAL PRIMARY KEY,
  session_id BIGINT NOT NULL REFERENCES consulting_sessions(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  assigned_to_type VARCHAR(20) CHECK (assigned_to_type IN ('consultant', 'client')),
  assigned_to_user_id UUID,
  due_date DATE,
  status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'overdue')),
  priority VARCHAR(20) DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  client_visible BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_consulting_action_items_session ON consulting_action_items(session_id);
CREATE INDEX idx_consulting_action_items_status ON consulting_action_items(status);

-- PHASE 4: Pricing & Payments
CREATE TABLE consulting_packages (
  id BIGSERIAL PRIMARY KEY,
  tier VARCHAR(50) NOT NULL UNIQUE CHECK (tier IN ('initial', 'foundation', 'implementation', 'transformation')),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  price_cents INT NOT NULL,
  duration_hours INT,
  session_count INT DEFAULT 1,
  includes_features JSONB DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_consulting_packages_tier_active ON consulting_packages(tier, is_active);

CREATE TABLE consulting_purchases (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  package_id BIGINT NOT NULL REFERENCES consulting_packages(id),
  purchase_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  payment_intent_id VARCHAR(255),
  status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'refunded', 'cancelled')),
  total_cost_cents INT NOT NULL,
  sessions_used INT DEFAULT 0,
  sessions_remaining INT NOT NULL,
  expires_at TIMESTAMP,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_consulting_purchases_user ON consulting_purchases(user_id);
CREATE INDEX idx_consulting_purchases_status ON consulting_purchases(status);

CREATE TABLE consulting_invoices (
  id BIGSERIAL PRIMARY KEY,
  purchase_id BIGINT REFERENCES consulting_purchases(id) ON DELETE SET NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invoice_number VARCHAR(50) UNIQUE NOT NULL,
  amount_cents INT NOT NULL,
  issued_date DATE NOT NULL,
  due_date DATE,
  status VARCHAR(50) DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'paid', 'overdue')),
  file_url VARCHAR(500),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_consulting_invoices_user ON consulting_invoices(user_id);
CREATE INDEX idx_consulting_invoices_status ON consulting_invoices(status);

-- PHASE 5: Client Portal Resources
CREATE TABLE consulting_resources (
  id BIGSERIAL PRIMARY KEY,
  package_id BIGINT REFERENCES consulting_packages(id) ON DELETE CASCADE,
  resource_type VARCHAR(50) CHECK (resource_type IN ('template', 'guide', 'tool', 'checklist', 'worksheet')),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  file_url VARCHAR(500),
  category VARCHAR(100),
  is_public BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_consulting_resources_package ON consulting_resources(package_id);

CREATE TABLE consulting_client_preferences (
  user_id UUID PRIMARY KEY UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  preferred_contact_method VARCHAR(50) DEFAULT 'email',
  timezone VARCHAR(50) DEFAULT 'UTC',
  communication_frequency VARCHAR(50) DEFAULT 'weekly',
  newsletter_opt_in BOOLEAN DEFAULT true,
  reminder_preferences JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- PHASE 6: Analytics & Metrics
CREATE TABLE consulting_metrics (
  id BIGSERIAL PRIMARY KEY,
  consulting_purchase_id BIGINT REFERENCES consulting_purchases(id) ON DELETE CASCADE,
  metric_type VARCHAR(100) CHECK (metric_type IN ('phase_advancement', 'revenue_growth', 'satisfaction', 'goal_completion', 'time_to_phase')),
  baseline_value NUMERIC(12, 2),
  current_value NUMERIC(12, 2),
  target_value NUMERIC(12, 2),
  measurement_date DATE NOT NULL,
  notes JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_consulting_metrics_purchase ON consulting_metrics(consulting_purchase_id, metric_type);

CREATE TABLE consulting_session_feedback (
  id BIGSERIAL PRIMARY KEY,
  session_id BIGINT NOT NULL REFERENCES consulting_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nps_score INT CHECK (nps_score >= 0 AND nps_score <= 10),
  feedback_text TEXT,
  session_quality_rating INT CHECK (session_quality_rating >= 1 AND session_quality_rating <= 5),
  would_recommend BOOLEAN,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_consulting_session_feedback_session ON consulting_session_feedback(session_id);

-- PHASE 7: Marketing & Onboarding
CREATE TABLE consulting_referrals (
  id BIGSERIAL PRIMARY KEY,
  referrer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referred_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'expired')),
  referral_credit_amount_cents INT DEFAULT 0,
  credited_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_consulting_referrals_referrer ON consulting_referrals(referrer_id, status);

CREATE TABLE consulting_prompts (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prompt_type VARCHAR(100) CHECK (prompt_type IN ('skill_monetizer', 'early_operator', 'growth_builder', 'strategic_owner')),
  activity_metric VARCHAR(100),
  activity_threshold INT,
  triggered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  dismissed_at TIMESTAMP,
  converted_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_consulting_prompts_user ON consulting_prompts(user_id);
CREATE INDEX idx_consulting_prompts_converted ON consulting_prompts(user_id, converted_at);
