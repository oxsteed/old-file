-- Migration 170: Cancellation Transparency System
-- Adds materialized view and tables for tracking cancellation patterns
-- Allows marketplace to self-regulate through transparency

-- Create materialized view for customer cancellation statistics
CREATE MATERIALIZED VIEW IF NOT EXISTS customer_cancellation_stats AS
SELECT
  j.client_id,
  COUNT(*) FILTER (WHERE j.status = 'cancelled') as cancellations_total,
  COUNT(*) FILTER (WHERE j.status = 'cancelled' AND j.created_at > now() - interval '6 months') as cancellations_6m,
  COUNT(*) as total_jobs_posted,
  COUNT(*) FILTER (WHERE j.created_at > now() - interval '6 months') as jobs_posted_6m,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE j.status = 'cancelled') /
    NULLIF(COUNT(*), 0),
    1
  ) as cancellation_rate_percent,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE j.status = 'cancelled' AND j.created_at > now() - interval '6 months') /
    NULLIF(COUNT(*) FILTER (WHERE j.created_at > now() - interval '6 months'), 0),
    1
  ) as cancellation_rate_6m_percent,
  ROUND(
    AVG(EXTRACT(DAY FROM (j.cancelled_at - j.created_at)))
      FILTER (WHERE j.status = 'cancelled' AND j.cancelled_at IS NOT NULL),
    1
  ) as avg_days_before_cancel,
  MIN(j.created_at) as first_job_posted,
  MAX(j.created_at) as last_job_posted,
  MAX(j.cancelled_at) as last_cancellation,
  -- Count cancellations by timing relative to scheduled_date
  COUNT(*) FILTER (WHERE j.status = 'cancelled' AND j.scheduled_date IS NOT NULL AND j.cancelled_at IS NOT NULL AND (j.cancelled_at > j.scheduled_date - interval '24 hours')) as cancellations_within_24h_of_start,
  COUNT(*) FILTER (WHERE j.status = 'cancelled' AND j.scheduled_date IS NOT NULL AND j.cancelled_at IS NOT NULL AND (j.cancelled_at > j.scheduled_date - interval '7 days' AND j.cancelled_at <= j.scheduled_date - interval '24 hours')) as cancellations_1_to_7_days_before,
  COUNT(*) FILTER (WHERE j.status = 'cancelled' AND j.scheduled_date IS NOT NULL AND j.cancelled_at IS NOT NULL AND (j.cancelled_at <= j.scheduled_date - interval '7 days')) as cancellations_7plus_days_before
FROM jobs j
WHERE j.deleted_at IS NULL
GROUP BY j.client_id;

-- Create index on materialized view
CREATE INDEX IF NOT EXISTS idx_customer_cancellation_stats_client_id
  ON customer_cancellation_stats(client_id);

-- Create materialized view for helper cancellation statistics (of accepted jobs)
CREATE MATERIALIZED VIEW IF NOT EXISTS helper_cancellation_stats AS
SELECT
  j.assigned_helper_id,
  COUNT(*) FILTER (WHERE j.status = 'cancelled' AND j.assigned_helper_id IS NOT NULL) as accepted_job_cancellations,
  COUNT(*) FILTER (WHERE j.status = 'cancelled' AND j.assigned_helper_id IS NOT NULL AND j.created_at > now() - interval '6 months') as accepted_job_cancellations_6m,
  COUNT(*) FILTER (WHERE j.assigned_helper_id = j.assigned_helper_id) as total_jobs_accepted,
  COUNT(*) FILTER (WHERE j.assigned_helper_id = j.assigned_helper_id AND j.created_at > now() - interval '6 months') as jobs_accepted_6m,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE j.status = 'cancelled' AND j.assigned_helper_id IS NOT NULL) /
    NULLIF(COUNT(*) FILTER (WHERE j.assigned_helper_id IS NOT NULL), 0),
    1
  ) as accepted_job_cancellation_rate,
  ROUND(
    AVG(EXTRACT(DAY FROM (j.cancelled_at - j.assigned_at)))
      FILTER (WHERE j.status = 'cancelled' AND j.assigned_helper_id IS NOT NULL AND j.assigned_at IS NOT NULL AND j.cancelled_at IS NOT NULL),
    1
  ) as avg_days_from_acceptance_to_cancel,
  MAX(j.cancelled_at) as last_cancellation
FROM jobs j
WHERE j.deleted_at IS NULL AND j.assigned_helper_id IS NOT NULL
GROUP BY j.assigned_helper_id;

CREATE INDEX IF NOT EXISTS idx_helper_cancellation_stats_helper_id
  ON helper_cancellation_stats(assigned_helper_id);

-- Table to store refresh schedule for materialized views
CREATE TABLE IF NOT EXISTS mv_refresh_log (
  id SERIAL PRIMARY KEY,
  view_name VARCHAR(255) NOT NULL,
  last_refreshed_at TIMESTAMPTZ DEFAULT NOW(),
  next_refresh_at TIMESTAMPTZ DEFAULT NOW() + interval '1 hour',
  refresh_duration_ms INTEGER
);

-- Insert initial refresh schedule
INSERT INTO mv_refresh_log (view_name, next_refresh_at)
VALUES
  ('customer_cancellation_stats', NOW() + interval '1 hour'),
  ('helper_cancellation_stats', NOW() + interval '1 hour')
ON CONFLICT DO NOTHING;

-- Index for job queries needing cancellation data
CREATE INDEX IF NOT EXISTS idx_jobs_cancelled_at ON jobs(cancelled_at)
  WHERE status = 'cancelled';
