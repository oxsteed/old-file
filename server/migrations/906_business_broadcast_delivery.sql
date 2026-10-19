-- Real business broadcast delivery (analytics decision 1).
-- Additive. One recipient row per audience member, one delivery row per
-- recipient and channel (idempotent by UNIQUE), leased with a per-claim token
-- so a stale worker can never overwrite a newer attempt. Opens/clicks are
-- recorded on the delivery; in-app reads come from notifications.read_at.

-- Preference columns the email-preferences controller already reads/writes.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'notification_preferences') THEN
    ALTER TABLE notification_preferences
      ADD COLUMN IF NOT EXISTS email_notifications BOOLEAN NOT NULL DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS marketing_emails BOOLEAN NOT NULL DEFAULT TRUE;
  END IF;
END $$;

ALTER TABLE business_broadcasts
  ADD COLUMN IF NOT EXISTS channels TEXT[],
  ADD COLUMN IF NOT EXISTS queued_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS queued_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tracked_links JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- FALSE for broadcasts marked "sent" before delivery existed (nothing went out).
  ADD COLUMN IF NOT EXISTS delivery_tracked BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE business_broadcasts DROP CONSTRAINT IF EXISTS bb_status_check;
ALTER TABLE business_broadcasts ADD CONSTRAINT bb_status_check
  CHECK (status IN ('draft', 'scheduled', 'sending', 'sent', 'cancelled'));

DO $$ BEGIN
  ALTER TABLE business_broadcasts ADD CONSTRAINT bb_channels_check
    CHECK (channels IS NULL OR (cardinality(channels) > 0 AND channels <@ ARRAY['in_app', 'push', 'email']::TEXT[])) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS business_broadcast_recipients (
  id BIGSERIAL PRIMARY KEY,
  broadcast_id BIGINT NOT NULL REFERENCES business_broadcasts(id) ON DELETE CASCADE,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  client_id BIGINT REFERENCES business_clients(id) ON DELETE SET NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  email TEXT,
  tracking_token TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (broadcast_id, client_id)
);
CREATE INDEX IF NOT EXISTS idx_bbr_broadcast ON business_broadcast_recipients(broadcast_id);

CREATE TABLE IF NOT EXISTS business_broadcast_deliveries (
  id BIGSERIAL PRIMARY KEY,
  broadcast_id BIGINT NOT NULL REFERENCES business_broadcasts(id) ON DELETE CASCADE,
  recipient_id BIGINT NOT NULL REFERENCES business_broadcast_recipients(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('in_app', 'push', 'email')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'skipped')),
  skip_reason TEXT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lease_token UUID,
  lease_expires_at TIMESTAMPTZ,
  provider_message_id TEXT,
  notification_id BIGINT REFERENCES notifications(id) ON DELETE SET NULL,
  devices_sent INTEGER,
  sent_at TIMESTAMPTZ,
  opened_at TIMESTAMPTZ,
  open_count INTEGER NOT NULL DEFAULT 0,
  clicked_at TIMESTAMPTZ,
  click_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (broadcast_id, recipient_id, channel),
  CHECK ((status = 'sending') = (lease_token IS NOT NULL)),
  CHECK (status <> 'skipped' OR skip_reason IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_bbd_due ON business_broadcast_deliveries(next_attempt_at, id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_bbd_leased ON business_broadcast_deliveries(lease_expires_at) WHERE status = 'sending';
CREATE INDEX IF NOT EXISTS idx_bbd_broadcast ON business_broadcast_deliveries(broadcast_id, channel, status);

-- Per-business opt-out from broadcast email/push/in-app (unsubscribe link,
-- RFC 8058 one-click). Keyed by email and/or platform user.
CREATE TABLE IF NOT EXISTS business_broadcast_suppressions (
  id BIGSERIAL PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  email TEXT,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  broadcast_id BIGINT REFERENCES business_broadcasts(id) ON DELETE SET NULL,
  source TEXT NOT NULL CHECK (source IN ('unsubscribe_link', 'one_click', 'owner')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (email IS NOT NULL OR user_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bbs_email ON business_broadcast_suppressions(business_id, email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_bbs_user ON business_broadcast_suppressions(business_id, user_id) WHERE user_id IS NOT NULL;
