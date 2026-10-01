-- Migration 618: profile visibility approval workflow + owner notifications.
-- Workstream B of the profile-visibility admin controls build.
--
-- profile_visibility_approvals: two-person approval requests for high-risk
-- (bulk) and scheduled visibility actions. Separation of duties: the admin
-- who requested an action cannot review it.
-- profile_visibility_owner_notifications: owner notification delivery rows
-- with idempotent delivery_key and bounded retry state.

CREATE TABLE IF NOT EXISTS profile_visibility_approvals (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type      TEXT NOT NULL CHECK (action_type IN ('single', 'bulk', 'scheduled')),
  payload          JSONB NOT NULL,
  fingerprint      TEXT NOT NULL,
  idempotency_key  TEXT NOT NULL UNIQUE,
  requested_by     UUID NOT NULL REFERENCES users(id),
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'approved', 'rejected', 'consumed', 'expired')),
  reviewed_by      UUID REFERENCES users(id),
  reviewed_at      TIMESTAMPTZ,
  review_note      TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  consumed_at      TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS profile_visibility_owner_notifications (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_type      TEXT NOT NULL,
  profile_id        TEXT NOT NULL,
  action            TEXT NOT NULL CHECK (action IN ('hidden', 'restored')),
  recipient_user_id UUID REFERENCES users(id),
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'sent', 'failed')),
  attempts          INT NOT NULL DEFAULT 0,
  last_error        TEXT,
  sent_at           TIMESTAMPTZ,
  delivery_key      TEXT UNIQUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pv_approvals_status_created
  ON profile_visibility_approvals (status, created_at);
CREATE INDEX IF NOT EXISTS idx_pv_owner_notif_status_attempts_created
  ON profile_visibility_owner_notifications (status, attempts, created_at);
CREATE INDEX IF NOT EXISTS idx_pv_owner_notif_recipient
  ON profile_visibility_owner_notifications (recipient_user_id, created_at);
