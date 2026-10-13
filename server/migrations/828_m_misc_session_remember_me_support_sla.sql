BEGIN;

-- P1-1-F04: rememberMe (30d) silently degraded to 7 days on first refresh.
-- refreshToken() minted the rotated session with an unconditional 7-day
-- window because the remember-me intent was not persisted on the session
-- row. Carry it forward so rotation honors the original 30-day choice.
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS remember_me BOOLEAN NOT NULL DEFAULT FALSE;

-- P1-17-F05: support_tickets had no SLA or stale handling; an unclaimed
-- ticket sat in 'open' forever. Track the SLA deadline and escalation
-- state so the sweeper job can escalate deterministically without
-- re-notifying on every run.
ALTER TABLE support_tickets
  ADD COLUMN IF NOT EXISTS sla_due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_support_tickets_sla_due
  ON support_tickets (sla_due_at)
  WHERE sla_due_at IS NOT NULL AND escalated_at IS NULL
    AND status = 'open' AND assigned_to IS NULL;

-- Backfill: existing open, unclaimed tickets get an SLA deadline from
-- creation time using the same priority windows as the sweeper
-- (urgent 1h, high 4h, normal 24h, low 72h); already-breached tickets
-- become immediately eligible for escalation.
UPDATE support_tickets
   SET sla_due_at = created_at + (
         CASE priority
           WHEN 'urgent' THEN INTERVAL '1 hour'
           WHEN 'high'   THEN INTERVAL '4 hours'
           WHEN 'low'    THEN INTERVAL '72 hours'
           ELSE INTERVAL '24 hours'
         END
       )
 WHERE status = 'open'
   AND assigned_to IS NULL
   AND sla_due_at IS NULL;

COMMIT;
