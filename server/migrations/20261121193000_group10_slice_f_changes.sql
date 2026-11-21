-- Group 10 Slice F: handle changes (items 531-535).
-- Change requests (scope revision, deadline adjustment, additional fee)
-- with approval and history, plus engagement pause/resume.
-- Audit overlap: G10-30 (change-request entity), G10-6 (fee-change
-- approval + invoice record), G10-24 (engagement_events as the change
-- history home, replacing the consulting_audit_log dropped by
-- migration 813), G10-35 (paused status + resume path). None of those
-- findings is claimed closed here; they stay open pending
-- re-verification against the new head.

-- Change requests: one row per proposed change to an engagement.
-- deliverable_id is NULL for engagement-level changes (scope of the
-- whole engagement, or an additional fee). The partial unique index
-- allows at most one OPEN request per session/type/target; the
-- COALESCE sentinel 0 is never a real deliverable id (BIGSERIAL).
CREATE TABLE IF NOT EXISTS consulting_change_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id BIGINT NOT NULL REFERENCES consulting_sessions(id) ON DELETE CASCADE,
  deliverable_id BIGINT REFERENCES consulting_deliverables(id) ON DELETE SET NULL,
  requested_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_type VARCHAR(50) NOT NULL CHECK (request_type IN ('scope_revision', 'deadline_adjustment', 'additional_fee')),
  status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
  title VARCHAR(255),
  reason TEXT NOT NULL,
  new_title VARCHAR(255),
  new_description TEXT,
  new_due_date DATE,
  amount_cents INT,
  currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  invoice_id BIGINT REFERENCES consulting_invoices(id) ON DELETE SET NULL,
  decided_by UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  decision_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_change_request_open
  ON consulting_change_requests (session_id, request_type, COALESCE(deliverable_id, 0))
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_change_requests_session
  ON consulting_change_requests (session_id, created_at DESC);

-- Engagement events: the append-only change history (item 534).
-- One row per engagement mutation from Slice F onward (change-request
-- lifecycle, pause/resume). Earlier Slice D/E mutations are not
-- backfilled; their own views (proposal version history, milestone
-- board) remain the record for those.
CREATE TABLE IF NOT EXISTS consulting_engagement_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id BIGINT NOT NULL REFERENCES consulting_sessions(id) ON DELETE CASCADE,
  event_type VARCHAR(100) NOT NULL,
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_role VARCHAR(50),
  summary TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_engagement_events_session
  ON consulting_engagement_events (session_id, created_at DESC);

-- Pause bookkeeping on the engagement session (item 535).
ALTER TABLE consulting_sessions
  ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ;
ALTER TABLE consulting_sessions
  ADD COLUMN IF NOT EXISTS paused_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE consulting_sessions
  ADD COLUMN IF NOT EXISTS pause_reason TEXT;
ALTER TABLE consulting_sessions
  ADD COLUMN IF NOT EXISTS status_before_pause VARCHAR(50);

-- Add 'paused' to the session status CHECK (migration 155 pattern:
-- drop + re-add inside an IF EXISTS DO block).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'consulting_sessions') THEN
    ALTER TABLE consulting_sessions
      DROP CONSTRAINT IF EXISTS consulting_sessions_status_check;
    ALTER TABLE consulting_sessions
      ADD CONSTRAINT consulting_sessions_status_check
      CHECK (status IN ('pending', 'contacted', 'scheduled', 'in_progress', 'completed', 'cancelled', 'no_show', 'archived', 'paused'));
  END IF;
END;
$$;
