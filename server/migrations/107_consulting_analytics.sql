-- Migration 107: Consulting analytics and performance tracking

-- View: Consultant performance metrics
CREATE OR REPLACE VIEW consultant_performance AS
SELECT
  u.id as consultant_id,
  u.first_name,
  u.last_name,
  COUNT(DISTINCT css.id) as total_sessions,
  COUNT(DISTINCT CASE WHEN css.status = 'completed' THEN css.id END) as completed_sessions,
  COUNT(DISTINCT CASE WHEN css.status = 'no_show' THEN css.id END) as no_show_sessions,
  ROUND(AVG(CASE WHEN csf.feedback_rating IS NOT NULL THEN csf.feedback_rating END)::numeric, 2) as avg_rating,
  COUNT(DISTINCT csf.id) as feedback_count,
  COUNT(DISTINCT CASE WHEN csf.feedback_rating >= 4 THEN csf.id END) as positive_feedback_count,
  MIN(css.created_at) as first_session_date,
  MAX(css.completed_at) as last_completed_date,
  ROUND(100.0 * COUNT(DISTINCT CASE WHEN css.status = 'completed' THEN css.id END) /
        NULLIF(COUNT(DISTINCT css.id), 0), 1) as completion_rate
FROM users u
LEFT JOIN consulting_sessions_scheduled css ON u.id = css.consultant_assigned_id
LEFT JOIN consulting_session_followups csf ON css.id = csf.session_scheduled_id
WHERE u.role IN ('helper', 'helper_pro', 'broker')
GROUP BY u.id, u.first_name, u.last_name;

-- View: Service tier analytics
CREATE OR REPLACE VIEW service_tier_analytics AS
SELECT
  cs.service_tier,
  COUNT(DISTINCT css.id) as total_requests,
  COUNT(DISTINCT CASE WHEN css.status = 'scheduled' THEN css.id END) as scheduled_count,
  COUNT(DISTINCT CASE WHEN css.status = 'completed' THEN css.id END) as completed_count,
  COUNT(DISTINCT CASE WHEN css.status = 'no_show' THEN css.id END) as no_show_count,
  ROUND(100.0 * COUNT(DISTINCT CASE WHEN css.status = 'completed' THEN css.id END) /
        NULLIF(COUNT(DISTINCT css.id), 0), 1) as completion_rate,
  ROUND(AVG(CASE WHEN csf.feedback_rating IS NOT NULL THEN csf.feedback_rating END)::numeric, 2) as avg_rating,
  MIN(css.created_at) as earliest_request,
  MAX(css.completed_at) as latest_completion
FROM consulting_sessions cs
LEFT JOIN consulting_sessions_scheduled css ON cs.id = css.session_id
LEFT JOIN consulting_session_followups csf ON css.id = csf.session_scheduled_id
GROUP BY cs.service_tier;

-- View: Conversion funnel analytics
CREATE OR REPLACE VIEW conversion_funnel AS
SELECT
  DATE_TRUNC('day', cs.created_at)::DATE as date,
  COUNT(DISTINCT cs.id) as intake_forms,
  COUNT(DISTINCT CASE WHEN css.scheduled_date IS NOT NULL THEN cs.id END) as scheduled_sessions,
  COUNT(DISTINCT CASE WHEN css.status = 'completed' THEN cs.id END) as completed_sessions,
  ROUND(100.0 * COUNT(DISTINCT CASE WHEN css.scheduled_date IS NOT NULL THEN cs.id END) /
        NULLIF(COUNT(DISTINCT cs.id), 0), 1) as scheduling_rate,
  ROUND(100.0 * COUNT(DISTINCT CASE WHEN css.status = 'completed' THEN cs.id END) /
        NULLIF(COUNT(DISTINCT cs.id), 0), 1) as completion_rate
FROM consulting_sessions cs
LEFT JOIN consulting_sessions_scheduled css ON cs.id = css.session_id
GROUP BY DATE_TRUNC('day', cs.created_at)::DATE
ORDER BY date DESC;

-- View: Feedback trends over time
CREATE OR REPLACE VIEW feedback_trends AS
SELECT
  DATE_TRUNC('week', csf.created_at)::DATE as week_start,
  COUNT(*) as total_feedback,
  AVG(csf.feedback_rating) as avg_rating,
  COUNT(CASE WHEN csf.feedback_rating >= 4 THEN 1 END) as positive_count,
  COUNT(CASE WHEN csf.feedback_rating < 4 THEN 1 END) as negative_count
FROM consulting_session_followups csf
WHERE csf.feedback_rating IS NOT NULL
GROUP BY DATE_TRUNC('week', csf.created_at)::DATE
ORDER BY week_start DESC;

-- Table: Consultant monthly performance snapshots
CREATE TABLE IF NOT EXISTS consultant_monthly_stats (
  id BIGSERIAL PRIMARY KEY,
  consultant_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  year INT NOT NULL,
  month INT NOT NULL,
  sessions_count INT DEFAULT 0,
  completed_count INT DEFAULT 0,
  no_show_count INT DEFAULT 0,
  avg_rating NUMERIC(3, 2),
  feedback_count INT DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(consultant_id, year, month)
);

-- Table: Conversion metrics snapshots
CREATE TABLE IF NOT EXISTS conversion_metrics_snapshots (
  id BIGSERIAL PRIMARY KEY,
  snapshot_date DATE NOT NULL,
  intake_forms INT DEFAULT 0,
  scheduled_sessions INT DEFAULT 0,
  completed_sessions INT DEFAULT 0,
  scheduling_rate NUMERIC(5, 2),
  completion_rate NUMERIC(5, 2),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(snapshot_date)
);

-- Create indexes for analytics queries
CREATE INDEX idx_consultant_performance_avg_rating
ON consulting_session_followups(consultant_assigned_id, feedback_rating)
WHERE feedback_rating IS NOT NULL;

CREATE INDEX idx_service_tier_analytics
ON consulting_sessions(service_tier);

CREATE INDEX idx_conversion_funnel_created
ON consulting_sessions(created_at DESC);

CREATE INDEX idx_feedback_trends_week
ON consulting_session_followups(DATE_TRUNC('week', created_at)::DATE DESC);
