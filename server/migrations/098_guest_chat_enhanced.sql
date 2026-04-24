-- Enhanced guest chat system with proper state management
-- Adds conversation continuity, helper context, and admin audit

BEGIN;

-- Add columns to guest_profile_chat_inbound
ALTER TABLE guest_profile_chat_inbound ADD COLUMN (
  session_status VARCHAR(50) NOT NULL DEFAULT 'waiting_for_helper'
    CHECK (session_status IN (
      'waiting_for_helper',
      'ai_fallback_pending',
      'ai_support_active',
      'helper_takeover_requested',
      'helper_assigned',
      'resolved',
      'abandoned'
    )),

  helper_invitation_sent_at TIMESTAMPTZ,
  helper_response_deadline TIMESTAMPTZ,
  ai_fallback_triggered_at TIMESTAMPTZ,
  helper_claimed_from_ai_at TIMESTAMPTZ,
  last_guest_message_at TIMESTAMPTZ,
  last_helper_message_at TIMESTAMPTZ,
  last_activity_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  guest_abandoned_at TIMESTAMPTZ,

  -- Privacy & consent
  guest_consent_monitoring BOOLEAN DEFAULT FALSE,
  consent_requested_at TIMESTAMPTZ,
  consent_accepted_at TIMESTAMPTZ,

  -- Metrics
  ai_messages_count INTEGER DEFAULT 0,
  helper_messages_count INTEGER DEFAULT 0,
  guest_messages_count INTEGER DEFAULT 0,
  total_resolution_time_seconds INTEGER,

  -- Helper context (populated when helper takes over)
  ai_summary TEXT,
  suggested_next_step TEXT
);

-- Create indexes for common queries
CREATE INDEX idx_guest_chat_status ON guest_profile_chat_inbound(session_status)
  WHERE session_status IN ('waiting_for_helper', 'ai_fallback_pending', 'ai_support_active');

CREATE INDEX idx_guest_chat_deadline ON guest_profile_chat_inbound(helper_response_deadline)
  WHERE session_status = 'waiting_for_helper' AND helper_response_deadline IS NOT NULL;

CREATE INDEX idx_guest_chat_activity ON guest_profile_chat_inbound(last_activity_at DESC)
  WHERE session_status IN ('ai_support_active', 'helper_assigned');

CREATE INDEX idx_guest_chat_helper ON guest_profile_chat_inbound(helper_id)
  WHERE helper_id IS NOT NULL;

-- Chat monitoring log (tracks all state transitions)
CREATE TABLE chat_monitoring_log (
  id BIGSERIAL PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES guest_profile_chat_inbound(id) ON DELETE CASCADE,
  event_type VARCHAR(50) NOT NULL,
  helper_id UUID REFERENCES users(id) ON DELETE SET NULL,
  triggered_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  triggered_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  metadata JSONB,

  CHECK (event_type IN (
    'session_created',
    'helper_invited',
    'helper_accepted',
    'ai_fallback_triggered',
    'ai_fallback_triggered_timeout',
    'ai_fallback_triggered_no_helpers',
    'helper_claimed_from_ai',
    'helper_assigned',
    'session_resolved',
    'guest_abandoned',
    'transition_queue_drained',
    'error_occurred'
  ))
);

CREATE INDEX idx_chat_monitoring_session ON chat_monitoring_log(session_id, triggered_at DESC);
CREATE INDEX idx_chat_monitoring_helper ON chat_monitoring_log(helper_id, triggered_at DESC)
  WHERE event_type IN ('helper_invited', 'helper_accepted', 'helper_claimed_from_ai');
CREATE INDEX idx_chat_monitoring_event ON chat_monitoring_log(event_type, triggered_at DESC);

-- Message queue for handling transitions (messages sent during state change)
CREATE TABLE chat_message_queue (
  id BIGSERIAL PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES guest_profile_chat_inbound(id) ON DELETE CASCADE,
  sender_type VARCHAR(20) NOT NULL,  -- 'guest', 'helper', 'system'
  sender_id UUID,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMPTZ,

  CHECK (sender_type IN ('guest', 'helper', 'system'))
);

CREATE INDEX idx_chat_queue_session ON chat_message_queue(session_id)
  WHERE processed_at IS NULL;

-- Helper chat monitoring status (which helpers are actively monitoring for chats)
CREATE TABLE helper_chat_monitoring (
  id BIGSERIAL PRIMARY KEY,
  helper_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  is_monitoring BOOLEAN DEFAULT FALSE,
  monitoring_started_at TIMESTAMPTZ,
  last_activity_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  region_preference VARCHAR(50),

  FOREIGN KEY (helper_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_helper_monitoring_active ON helper_chat_monitoring(helper_id)
  WHERE is_monitoring = TRUE;

-- Admin access audit log (privacy/compliance tracking)
CREATE TABLE admin_chat_access_log (
  id BIGSERIAL PRIMARY KEY,
  admin_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  session_id UUID NOT NULL REFERENCES guest_profile_chat_inbound(id) ON DELETE CASCADE,
  accessed_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  access_type VARCHAR(50) NOT NULL,  -- 'view', 'export', 'moderate'
  reason VARCHAR(255),
  ip_hash VARCHAR(64),
  duration_seconds INTEGER,

  CHECK (access_type IN ('view', 'export', 'moderate', 'escalate'))
);

CREATE INDEX idx_admin_access_session ON admin_chat_access_log(session_id, accessed_at DESC);
CREATE INDEX idx_admin_access_admin ON admin_chat_access_log(admin_id, accessed_at DESC);
CREATE INDEX idx_admin_access_date ON admin_chat_access_log(accessed_at DESC);

COMMIT;
