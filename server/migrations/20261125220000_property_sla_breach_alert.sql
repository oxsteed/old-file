-- Batch H (330): once-per-breach marker for missed-maintenance SLA alerts.
-- The alerts endpoint notifies on overdue SLA targets and stamps the row so
-- a re-run (or Batch J's breach escalation job) does not re-alert the same
-- breach. The stamp is per request, not per target: sla_target_at is set
-- once at intake and never recomputed, so one breach episode per request.
-- Additive, idempotent: safe to run twice.
ALTER TABLE property_maintenance_requests ADD COLUMN IF NOT EXISTS sla_alerted_at TIMESTAMPTZ;
