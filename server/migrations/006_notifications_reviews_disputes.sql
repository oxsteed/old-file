BEGIN;

-- ═══════════════════════════════════════════════════════════════
-- NOTIFICATIONS
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS notifications (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        REFERENCES users(id) ON DELETE CASCADE,
  type          VARCHAR(60) NOT NULL,
  title         VARCHAR(120) NOT NULL,
  body          TEXT        NOT NULL,
  data          JSONB       DEFAULT '{}',
  action_url    TEXT,
  is_read       BOOLEAN     DEFAULT false,
  is_push_sent  BOOLEAN     DEFAULT false,
  is_email_sent BOOLEAN     DEFAULT false,
  created_at    TIMESTAMPTZ DEFAULT now(),
  read_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_notifications_user
  ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON notifications(user_id) WHERE is_read = false;

-- Notification preferences per user per type
CREATE TABLE IF NOT EXISTS notification_preferences (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  -- In-app
  in_app_new_bid          BOOLEAN DEFAULT true,
  in_app_bid_accepted     BOOLEAN DEFAULT true,
  in_app_job_started      BOOLEAN DEFAULT true,
  in_app_job_completed    BOOLEAN DEFAULT true,
  in_app_payment_released BOOLEAN DEFAULT true,
  in_app_new_review       BOOLEAN DEFAULT true,
  in_app_dispute_update   BOOLEAN DEFAULT true,
  in_app_subscription     BOOLEAN DEFAULT true,
  -- Push
  push_new_job_nearby     BOOLEAN DEFAULT true,
  push_new_bid            BOOLEAN DEFAULT true,
  push_bid_accepted       BOOLEAN DEFAULT true,
  push_payment_released   BOOLEAN DEFAULT true,
  push_dispute_update     BOOLEAN DEFAULT true,
  -- Email
  email_bid_accepted      BOOLEAN DEFAULT true,
  email_payment_released  BOOLEAN DEFAULT true,
  email_subscription      BOOLEAN DEFAULT true,
  email_dispute_update    BOOLEAN DEFAULT true,
  email_weekly_summary    BOOLEAN DEFAULT true,
  created_at              TIMESTAMPTZ DEFAULT now(),
  updated_at              TIMESTAMPTZ DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════
-- REVIEWS
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS reviews (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id          UUID        REFERENCES jobs(id) ON DELETE CASCADE,
  reviewer_id     UUID        REFERENCES users(id) ON DELETE CASCADE,
  reviewee_id     UUID        REFERENCES users(id) ON DELETE CASCADE,
  reviewer_role   VARCHAR(20) NOT NULL,   -- 'client' | 'helper' | 'broker'
  rating          SMALLINT    NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title           VARCHAR(100),
  body            TEXT,
  is_visible      BOOLEAN     DEFAULT true,
  response        TEXT,                   -- reviewee's public reply
  responded_at    TIMESTAMPTZ,
  hidden_reason   TEXT,                   -- admin hide reason
  hidden_by       UUID        REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(job_id, reviewer_id)             -- one review per person per job
);

CREATE INDEX IF NOT EXISTS idx_reviews_reviewee
  ON reviews(reviewee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_job
  ON reviews(job_id);
CREATE INDEX IF NOT EXISTS idx_reviews_visible
  ON reviews(reviewee_id) WHERE is_visible = true;

-- ═══════════════════════════════════════════════════════════════
-- DISPUTES
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS disputes (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id            UUID        UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
  opened_by         UUID        REFERENCES users(id),
  opened_by_role    VARCHAR(20) NOT NULL,  -- 'client' | 'helper'
  against_user_id   UUID        REFERENCES users(id),
  reason            VARCHAR(60) NOT NULL,
  description       TEXT        NOT NULL,
  status            VARCHAR(30) DEFAULT 'open',
                                           -- open|under_review|resolved|closed
  resolution        VARCHAR(30),           -- full_refund|partial_refund|
                                           -- release_to_helper|dismissed
  resolution_notes  TEXT,
  refund_amount     DECIMAL(10,2),         -- null = full, 0 = none
  resolved_by       UUID        REFERENCES users(id),
  resolved_at       TIMESTAMPTZ,
  evidence_deadline TIMESTAMPTZ,           -- 72h after opening
  admin_notes       TEXT,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_disputes_job
  ON disputes(job_id);
CREATE INDEX IF NOT EXISTS idx_disputes_status
  ON disputes(status);
CREATE INDEX IF NOT EXISTS idx_disputes_opened_by
  ON disputes(opened_by);

-- Evidence submissions per dispute
CREATE TABLE IF NOT EXISTS dispute_evidence (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id    UUID        REFERENCES disputes(id) ON DELETE CASCADE,
  submitted_by  UUID        REFERENCES users(id) ON DELETE CASCADE,
  submitter_role VARCHAR(20) NOT NULL,     -- 'client'|'helper'|'admin'
  type          VARCHAR(20) DEFAULT 'text', -- 'text'|'image'|'video'|'document'
  content       TEXT,                      -- text evidence or file URL
  file_url      TEXT,
  file_name     TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_evidence_dispute
  ON dispute_evidence(dispute_id);

-- Dispute messages (threaded communication)
CREATE TABLE IF NOT EXISTS dispute_messages (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id    UUID        REFERENCES disputes(id) ON DELETE CASCADE,
  sender_id     UUID        REFERENCES users(id) ON DELETE CASCADE,
  sender_role   VARCHAR(20) NOT NULL,      -- 'client'|'helper'|'admin'
  message       TEXT        NOT NULL,
  is_admin_only BOOLEAN     DEFAULT false, -- admin internal notes
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dispute_messages
  ON dispute_messages(dispute_id, created_at ASC);

-- ── Triggers ─────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TRIGGER trg_reviews_updated_at
    BEFORE UPDATE ON reviews
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_disputes_updated_at
    BEFORE UPDATE ON disputes
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_notif_prefs_updated_at
    BEFORE UPDATE ON notification_preferences
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;
