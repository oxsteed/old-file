-- Group 10 Slice H: close the engagement (items 541-545).
-- Closeout confirmation (542), follow-up schedule (543), client
-- feedback request (544), engagement archive (545). The final
-- deliverable checklist (541) is computed from the tables below plus
-- the milestone board, change requests, and feedback; it needs no
-- table of its own.
-- Audit overlap: G10-21, G10-32, G10-36 stay open pending
-- re-verification against the new head; none of those findings is
-- claimed closed here.

-- Archive bookkeeping on the engagement session (545). The status CHECK
-- already admits 'archived' (Slice F migration); status_before_archive
-- keeps the pre-archive status so unarchive restores it, mirroring the
-- pause bookkeeping in the same table.
ALTER TABLE consulting_sessions
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE consulting_sessions
  ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE consulting_sessions
  ADD COLUMN IF NOT EXISTS status_before_archive VARCHAR(50);

-- Closeout confirmation (542): one row per engagement. The consultant
-- and the client each confirm once; closed_at is stamped when both
-- have confirmed. An admin confirms on the client's behalf only
-- (the D-115 rule), never for the consultant.
CREATE TABLE IF NOT EXISTS consulting_closeouts (
  session_id BIGINT PRIMARY KEY REFERENCES consulting_sessions(id) ON DELETE CASCADE,
  consultant_confirmed_at TIMESTAMPTZ,
  consultant_confirmed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  client_confirmed_at TIMESTAMPTZ,
  client_confirmed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  closed_at TIMESTAMPTZ,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Follow-up schedule (543): check-ins the consultant books against a
-- completed engagement (30-day check-in, review, renewal). A follow-up
-- is scheduled, done, or cancelled; it never moves money.
CREATE TABLE IF NOT EXISTS consulting_follow_ups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id BIGINT NOT NULL REFERENCES consulting_sessions(id) ON DELETE CASCADE,
  due_at TIMESTAMPTZ NOT NULL,
  kind VARCHAR(50) NOT NULL CHECK (kind IN ('check_in', 'review', 'renewal', 'other')),
  note TEXT,
  status VARCHAR(50) NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'done', 'cancelled')),
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_follow_ups_session
  ON consulting_follow_ups (session_id, due_at ASC);
CREATE INDEX IF NOT EXISTS idx_follow_ups_due
  ON consulting_follow_ups (due_at ASC) WHERE status = 'scheduled';

-- Client feedback request (544): the consultant asks the client for
-- feedback at closeout. Submission is the existing authenticated
-- feedback endpoint (Slice E, item 529); a request is satisfied when
-- a consulting_session_feedback row exists for the session. One open
-- request per session, enforced in code with a 409 — no partial unique
-- index, so a request is never blocked by a stale row.
CREATE TABLE IF NOT EXISTS consulting_feedback_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id BIGINT NOT NULL REFERENCES consulting_sessions(id) ON DELETE CASCADE,
  requested_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_feedback_requests_session
  ON consulting_feedback_requests (session_id, requested_at DESC);
