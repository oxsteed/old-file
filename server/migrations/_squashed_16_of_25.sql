
-- >>> BEGIN: 094_message_reactions.sql <<<
-- Message reactions system
-- Allows users to react to messages with emoji (thumbs up, heart, laugh, etc.)

CREATE TABLE message_reactions (
  id BIGSERIAL PRIMARY KEY,
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reaction VARCHAR(50) NOT NULL, -- emoji name like 'thumbs_up', 'heart', 'laugh', 'sad', 'angry'
  created_at TIMESTAMP DEFAULT NOW(),

  -- Prevent duplicate reactions: one user can only have one type of reaction per message
  CONSTRAINT unique_user_reaction_per_message UNIQUE(message_id, user_id, reaction)
);

-- Index for efficient lookup of reactions for a message
CREATE INDEX idx_message_reactions_message_id
ON message_reactions(message_id);

-- Index for finding all reactions by a user (for audit/moderation)
CREATE INDEX idx_message_reactions_user_id
ON message_reactions(user_id);

-- Index for efficient removal of reactions when user deletes account
CREATE INDEX idx_message_reactions_user_created
ON message_reactions(user_id, created_at DESC);

-- Index for counting reactions per message efficiently
CREATE INDEX idx_message_reactions_message_reaction
ON message_reactions(message_id, reaction);

-- >>> END: 094_message_reactions.sql <<<

-- >>> BEGIN: 095_archive_conversations.sql <<<
-- Archive conversations functionality
-- Allows users to archive conversations instead of permanently deleting them
-- Archived conversations can be restored and are hidden from the inbox by default

ALTER TABLE conversations
ADD COLUMN archived_at TIMESTAMP NULL,
ADD COLUMN archived_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- Index for efficient querying of archived conversations (for restoration UI)
CREATE INDEX idx_conversations_archived
ON conversations(archived_at DESC NULLS LAST)
WHERE archived_at IS NOT NULL;

-- Index for finding non-archived conversations (default inbox view)
CREATE INDEX idx_conversations_active_not_archived
ON conversations(customer_id, helper_id, last_message_at DESC)
WHERE archived_at IS NULL AND status = 'active';

-- Add comment to document the archive workflow
COMMENT ON COLUMN conversations.archived_at IS 'Timestamp when conversation was archived; NULL = not archived. Archived conversations are hidden from inbox but can be restored.';

-- >>> END: 095_archive_conversations.sql <<<

-- >>> BEGIN: 096_conversation_retention_settings.sql <<<
-- Conversation retention settings
-- Allows configuration of how long archived conversations are kept before automatic cleanup

CREATE TABLE conversation_retention_settings (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  retention_days INT DEFAULT 90, -- Keep archived conversations for 90 days before deletion
  auto_delete BOOLEAN DEFAULT TRUE, -- Whether to automatically delete old conversations
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Index for efficient lookups
CREATE INDEX idx_conversation_retention_user
ON conversation_retention_settings(user_id);

-- Add audit log for archival events
CREATE TABLE conversation_archive_log (
  id BIGSERIAL PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(20) NOT NULL, -- 'archived' or 'restored'
  reason VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Index for efficient archival log queries
CREATE INDEX idx_conversation_archive_log_conversation
ON conversation_archive_log(conversation_id, created_at DESC);

CREATE INDEX idx_conversation_archive_log_user
ON conversation_archive_log(user_id, created_at DESC);

-- >>> END: 096_conversation_retention_settings.sql <<<

-- >>> BEGIN: 097_ensure_helper_profiles_pricing_and_availability.sql <<<
-- Migration 097: Ensure helper_profiles has all required pricing and availability columns
-- Fixes schema divergence where production DB may be missing columns referenced by getHelperPricing/getHelperSlots

ALTER TABLE helper_profiles
  ADD COLUMN IF NOT EXISTS hourly_rate_min DECIMAL(8,2),
  ADD COLUMN IF NOT EXISTS hourly_rate_max DECIMAL(8,2),
  ADD COLUMN IF NOT EXISTS rate_preference VARCHAR(20) DEFAULT 'per_job',
  ADD COLUMN IF NOT EXISTS flat_rate_available BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS contact_for_pricing BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS availability_json JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS is_available_now BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS response_rate INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cover_photo_url VARCHAR(500);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_helper_profiles_availability
  ON helper_profiles (is_available_now)
  WHERE is_available_now = true;

CREATE INDEX IF NOT EXISTS idx_helper_profiles_rating_availability
  ON helper_profiles (avg_rating DESC, is_available_now);

-- >>> END: 097_ensure_helper_profiles_pricing_and_availability.sql <<<

-- >>> BEGIN: 098_guest_chat_enhanced.sql <<<
-- Enhanced guest chat system with proper state management
-- Adds conversation continuity, helper context, and admin audit

BEGIN;

-- Add columns to guest_profile_chat_inbound
ALTER TABLE guest_profile_chat_inbound
ADD COLUMN session_status VARCHAR(50) NOT NULL DEFAULT 'waiting_for_helper'
  CHECK (session_status IN (
    'waiting_for_helper',
    'ai_fallback_pending',
    'ai_support_active',
    'helper_takeover_requested',
    'helper_assigned',
    'resolved',
    'abandoned'
  ));

ALTER TABLE guest_profile_chat_inbound
ADD COLUMN helper_invitation_sent_at TIMESTAMPTZ,
ADD COLUMN helper_response_deadline TIMESTAMPTZ,
ADD COLUMN ai_fallback_triggered_at TIMESTAMPTZ,
ADD COLUMN helper_claimed_from_ai_at TIMESTAMPTZ,
ADD COLUMN last_guest_message_at TIMESTAMPTZ,
ADD COLUMN last_helper_message_at TIMESTAMPTZ,
ADD COLUMN last_activity_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN guest_abandoned_at TIMESTAMPTZ,
ADD COLUMN guest_consent_monitoring BOOLEAN DEFAULT FALSE,
ADD COLUMN consent_requested_at TIMESTAMPTZ,
ADD COLUMN consent_accepted_at TIMESTAMPTZ,
ADD COLUMN ai_messages_count INTEGER DEFAULT 0,
ADD COLUMN helper_messages_count INTEGER DEFAULT 0,
ADD COLUMN guest_messages_count INTEGER DEFAULT 0,
ADD COLUMN total_resolution_time_seconds INTEGER,
ADD COLUMN ai_summary TEXT,
ADD COLUMN suggested_next_step TEXT;

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

-- >>> END: 098_guest_chat_enhanced.sql <<<

-- >>> BEGIN: 099_guest_chat_constraints.sql <<<
-- Additional constraints and triggers for data integrity

BEGIN;

-- Clean up existing data to satisfy constraints
-- Set helper_response_deadline to NULL for sessions not in waiting_for_helper state
UPDATE guest_profile_chat_inbound
SET helper_response_deadline = NULL
WHERE session_status IS DISTINCT FROM 'waiting_for_helper'
  AND helper_response_deadline IS NOT NULL;

-- Prevent orphaned AI summaries (only set when transitioning to helper)
ALTER TABLE guest_profile_chat_inbound
  ADD CONSTRAINT check_ai_summary_only_on_takeover
  CHECK (
    (session_status IN ('helper_takeover_requested', 'helper_assigned') AND ai_summary IS NOT NULL)
    OR (session_status NOT IN ('helper_takeover_requested', 'helper_assigned') AND ai_summary IS NULL)
  ) NOT VALID;

-- Ensure helper_id is set when helper_assigned
ALTER TABLE guest_profile_chat_inbound
  ADD CONSTRAINT check_helper_assigned_requires_id
  CHECK (
    (session_status = 'helper_assigned' AND helper_id IS NOT NULL)
    OR (session_status != 'helper_assigned')
  ) NOT VALID;

-- Ensure deadlines only set during waiting period
ALTER TABLE guest_profile_chat_inbound
  ADD CONSTRAINT check_deadline_during_waiting
  CHECK (
    (session_status = 'waiting_for_helper' AND helper_response_deadline IS NOT NULL)
    OR (session_status IS DISTINCT FROM 'waiting_for_helper' AND helper_response_deadline IS NULL)
  ) NOT VALID;

-- Create trigger to update last_activity_at on any state change
CREATE OR REPLACE FUNCTION update_guest_chat_activity()
RETURNS TRIGGER AS $$
BEGIN
  NEW.last_activity_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_guest_chat_activity
  BEFORE UPDATE ON guest_profile_chat_inbound
  FOR EACH ROW
  EXECUTE FUNCTION update_guest_chat_activity();

-- Create trigger to log all state transitions
CREATE OR REPLACE FUNCTION log_guest_chat_transition()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.session_status IS DISTINCT FROM NEW.session_status THEN
    INSERT INTO chat_monitoring_log (
      session_id, event_type, helper_id, metadata
    ) VALUES (
      NEW.id,
      'status_changed_' || NEW.session_status,
      NEW.helper_id,
      jsonb_build_object(
        'from_status', OLD.session_status,
        'to_status', NEW.session_status,
        'transition_time_ms', EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - OLD.last_activity_at)) * 1000
      )
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_guest_chat_transition
  AFTER UPDATE ON guest_profile_chat_inbound
  FOR EACH ROW
  EXECUTE FUNCTION log_guest_chat_transition();

COMMIT;

-- >>> END: 099_guest_chat_constraints.sql <<<
