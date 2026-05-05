-- Migration 169: Reputation visibility and user report system
-- Adds cancellation stats tracking, user reputation scoring, and abuse reporting
-- Note: legacy `user_reports` (tool-rental) from 079b is unchanged; job/app reports use `job_user_reports`.

-- User reputation scores (cached from cancellation history)
CREATE TABLE IF NOT EXISTS user_reputation_scores (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Cancellation metrics
  total_jobs INTEGER DEFAULT 0,
  completed_jobs INTEGER DEFAULT 0,
  cancelled_jobs INTEGER DEFAULT 0,
  cancellation_rate DECIMAL(5, 2) DEFAULT 0,  -- percentage

  -- Timing pattern analysis
  cancelled_24h_or_less INTEGER DEFAULT 0,    -- number of cancellations <24h before
  cancelled_24h_to_3d INTEGER DEFAULT 0,      -- number of cancellations 24h-3d before
  cancelled_3d_plus INTEGER DEFAULT 0,        -- number of cancellations 3+ days before

  -- Reliability score (0-100)
  reliability_score INTEGER DEFAULT 100,
  caution_level VARCHAR(20) DEFAULT 'none',   -- 'none', 'caution', 'restricted'

  -- Timestamps
  last_calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_reputation_scores_user_id ON user_reputation_scores(user_id);
CREATE INDEX IF NOT EXISTS idx_user_reputation_scores_caution_level ON user_reputation_scores(caution_level);

-- Job marketplace user reports (distinct from tool-rental user_reports)
CREATE TABLE IF NOT EXISTS job_user_reports (
  id BIGSERIAL PRIMARY KEY,
  reporter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reported_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Report details
  reason VARCHAR(50) NOT NULL,
  description TEXT NOT NULL,
  evidence_urls TEXT[],

  -- Context (jobs.id and conversations.id are UUID)
  job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,

  -- Status
  status VARCHAR(20) DEFAULT 'submitted',
  admin_notes TEXT,
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  resolution VARCHAR(50),

  -- Timestamps
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_job_user_reports_reported_user ON job_user_reports(reported_user_id);
CREATE INDEX IF NOT EXISTS idx_job_user_reports_status ON job_user_reports(status);
CREATE INDEX IF NOT EXISTS idx_job_user_reports_reason ON job_user_reports(reason);
CREATE INDEX IF NOT EXISTS idx_job_user_reports_created_at ON job_user_reports(created_at DESC);

-- Enforcement actions (warn, restrict, suspend)
CREATE TABLE IF NOT EXISTS enforcement_actions (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action_type VARCHAR(20) NOT NULL,
  reason VARCHAR(50) NOT NULL,
  report_id BIGINT REFERENCES job_user_reports(id) ON DELETE SET NULL,

  description TEXT,
  restrictions JSON,

  effective_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP,
  is_active BOOLEAN DEFAULT TRUE,

  issued_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_enforcement_actions_user_id ON enforcement_actions(user_id);
CREATE INDEX IF NOT EXISTS idx_enforcement_actions_is_active ON enforcement_actions(is_active);
CREATE INDEX IF NOT EXISTS idx_enforcement_actions_user_active ON enforcement_actions(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_enforcement_actions_expires_at ON enforcement_actions(expires_at) WHERE is_active = true;

-- Admin audit log for enforcement decisions
CREATE TABLE IF NOT EXISTS enforcement_audit_log (
  id BIGSERIAL PRIMARY KEY,
  admin_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action VARCHAR(50) NOT NULL,
  target_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  report_id BIGINT REFERENCES job_user_reports(id) ON DELETE SET NULL,
  enforcement_id BIGINT REFERENCES enforcement_actions(id) ON DELETE SET NULL,

  changes JSON,
  reason_for_action TEXT,

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_enforcement_audit_admin ON enforcement_audit_log(admin_id);
CREATE INDEX IF NOT EXISTS idx_enforcement_audit_target ON enforcement_audit_log(target_user_id);
CREATE INDEX IF NOT EXISTS idx_enforcement_audit_created ON enforcement_audit_log(created_at DESC);

-- Function to recalculate reputation scores based on job history
CREATE OR REPLACE FUNCTION update_user_reputation_scores(p_user_id UUID)
RETURNS void AS $$
DECLARE
  v_total_jobs INTEGER;
  v_completed_jobs INTEGER;
  v_cancelled_jobs INTEGER;
  v_cancelled_24h INTEGER;
  v_cancelled_24h_3d INTEGER;
  v_cancelled_3d_plus INTEGER;
  v_reliability_score INTEGER;
  v_caution_level VARCHAR(20);
BEGIN
  SELECT COUNT(*)
  INTO v_total_jobs
  FROM jobs
  WHERE client_id = p_user_id AND status != 'draft';

  SELECT COUNT(*)
  INTO v_completed_jobs
  FROM jobs
  WHERE client_id = p_user_id AND status = 'completed';

  SELECT COUNT(*)
  INTO v_cancelled_jobs
  FROM jobs
  WHERE client_id = p_user_id AND status = 'cancelled';

  SELECT
    COUNT(CASE WHEN EXTRACT(EPOCH FROM (j.scheduled_start_at - j.updated_at)) / 3600 < 24 THEN 1 END),
    COUNT(CASE WHEN EXTRACT(EPOCH FROM (j.scheduled_start_at - j.updated_at)) / 3600 >= 24 AND EXTRACT(EPOCH FROM (j.scheduled_start_at - j.updated_at)) / 3600 < 72 THEN 1 END),
    COUNT(CASE WHEN EXTRACT(EPOCH FROM (j.scheduled_start_at - j.updated_at)) / 3600 >= 72 THEN 1 END)
  INTO v_cancelled_24h, v_cancelled_24h_3d, v_cancelled_3d_plus
  FROM jobs j
  WHERE j.client_id = p_user_id AND j.status = 'cancelled'
    AND j.scheduled_start_at IS NOT NULL;

  v_reliability_score := 100;
  IF v_total_jobs > 0 THEN
    v_reliability_score := GREATEST(0, 100 - (v_cancelled_jobs * 15));
  END IF;

  IF v_total_jobs >= 5 AND (v_cancelled_jobs::DECIMAL / v_total_jobs) >= 0.3 THEN
    v_caution_level := 'caution';
  ELSIF v_total_jobs >= 10 AND (v_cancelled_jobs::DECIMAL / v_total_jobs) >= 0.4 THEN
    v_caution_level := 'restricted';
  ELSE
    v_caution_level := 'none';
  END IF;

  INSERT INTO user_reputation_scores (
    user_id, total_jobs, completed_jobs, cancelled_jobs,
    cancellation_rate, cancelled_24h_or_less, cancelled_24h_to_3d, cancelled_3d_plus,
    reliability_score, caution_level, last_calculated_at
  ) VALUES (
    p_user_id, v_total_jobs, v_completed_jobs, v_cancelled_jobs,
    CASE WHEN v_total_jobs > 0 THEN (v_cancelled_jobs::DECIMAL / v_total_jobs * 100) ELSE 0 END,
    COALESCE(v_cancelled_24h, 0), COALESCE(v_cancelled_24h_3d, 0), COALESCE(v_cancelled_3d_plus, 0),
    v_reliability_score, v_caution_level, CURRENT_TIMESTAMP
  )
  ON CONFLICT (user_id) DO UPDATE SET
    total_jobs = v_total_jobs,
    completed_jobs = v_completed_jobs,
    cancelled_jobs = v_cancelled_jobs,
    cancellation_rate = CASE WHEN v_total_jobs > 0 THEN (v_cancelled_jobs::DECIMAL / v_total_jobs * 100) ELSE 0 END,
    cancelled_24h_or_less = COALESCE(v_cancelled_24h, 0),
    cancelled_24h_to_3d = COALESCE(v_cancelled_24h_3d, 0),
    cancelled_3d_plus = COALESCE(v_cancelled_3d_plus, 0),
    reliability_score = v_reliability_score,
    caution_level = v_caution_level,
    last_calculated_at = CURRENT_TIMESTAMP,
    updated_at = CURRENT_TIMESTAMP;
END;
$$ LANGUAGE plpgsql;

INSERT INTO user_reputation_scores (user_id)
SELECT DISTINCT id FROM users
ON CONFLICT (user_id) DO NOTHING;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id FROM users LOOP
    PERFORM update_user_reputation_scores(r.id);
  END LOOP;
END
$$;
