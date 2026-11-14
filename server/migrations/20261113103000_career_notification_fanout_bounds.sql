-- Domain 9 item 1: bound the careers follower fan-out (seeker.notifyFollowers).
--
-- Two durable tables so a 15-minute tick that overruns its 900s lock resumes
-- instead of re-running the same follower window:
--  * career_follow_notify_progress: per-opening cursor (last follower user_id
--    delivered) plus a completion marker. Ticks resume from the cursor and
--    skip completed openings; rows for openings that aged out of the notify
--    window are pruned by the job itself.
--  * career_email_outbox: one row per freshly inserted fan-out notification,
--    drained in bounded sendEmailBatch calls (max 100 per provider call) by
--    the same tick. Email no longer fires one Resend call per follower
--    inside the fan-out loop, and a crash between the in-app insert and the
--    send leaves a durable pending row for the next tick instead of a lost
--    email. Follows the message_notification_outbox (migration 555) shape:
--    pending/sending/sent/failed with an attempts counter.

CREATE TABLE IF NOT EXISTS career_follow_notify_progress (
  opening_id BIGINT PRIMARY KEY REFERENCES career_openings(id) ON DELETE CASCADE,
  last_user_id UUID,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS career_email_outbox (
  id BIGSERIAL PRIMARY KEY,
  delivery_key TEXT NOT NULL UNIQUE,
  notification_id BIGINT REFERENCES notifications(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en',
  type TEXT NOT NULL,
  params JSONB NOT NULL DEFAULT '{}'::jsonb,
  action_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_career_email_outbox_pending
  ON career_email_outbox (created_at) WHERE status = 'pending';
