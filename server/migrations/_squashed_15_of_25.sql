
-- >>> BEGIN: 088b_platform_ledger_user_id_fkey_drop.sql <<<
-- Same class of issue as migration 052 for platform_ledger.job_id:
-- user_id REFERENCES users(id) ON DELETE SET NULL triggers an UPDATE that is
-- swallowed by ledger_no_update (DO INSTEAD NOTHING), blocking user deletion.
-- Keep immutable ledger rows; retain historical user_id UUID without FK enforcement.

ALTER TABLE platform_ledger
  DROP CONSTRAINT IF EXISTS platform_ledger_user_id_fkey;

-- >>> END: 088b_platform_ledger_user_id_fkey_drop.sql <<<

-- >>> BEGIN: 089_registration_structured_address.sql <<<
-- Structured mailing / service address captured at signup (not a single free-text blob).

ALTER TABLE pending_registrations
  ADD COLUMN IF NOT EXISTS address_line1 VARCHAR(255),
  ADD COLUMN IF NOT EXISTS city VARCHAR(100),
  ADD COLUMN IF NOT EXISTS state VARCHAR(2);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS address_line1 VARCHAR(255);

-- >>> END: 089_registration_structured_address.sql <<<

-- >>> BEGIN: 090_helper_privacy_controls.sql <<<
-- Add granular privacy controls to helper_profiles
-- Helpers can control: guest contact, booking, scheduling, and live chat

ALTER TABLE helper_profiles
ADD COLUMN IF NOT EXISTS allow_booking BOOLEAN NOT NULL DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS allow_scheduling BOOLEAN NOT NULL DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS allow_live_chat BOOLEAN NOT NULL DEFAULT TRUE;

-- Index on helper_profiles for faster filtering by privacy settings
CREATE INDEX IF NOT EXISTS idx_helper_profiles_privacy_settings
ON helper_profiles (user_id, allow_booking, allow_scheduling, allow_live_chat);

-- >>> END: 090_helper_privacy_controls.sql <<<

-- >>> BEGIN: 091_message_edit_delete.sql <<<
-- Migration 091: Message edit/delete support
-- Adds edited_at and deleted_at columns to messages table
-- Deleted messages are soft-deleted (not removed from DB)

ALTER TABLE messages
ADD COLUMN IF NOT EXISTS edited_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;

-- Index for finding undeleted messages efficiently
CREATE INDEX IF NOT EXISTS idx_messages_not_deleted
ON messages(conversation_id, created_at DESC)
WHERE deleted_at IS NULL;

-- Index for finding edited messages
CREATE INDEX IF NOT EXISTS idx_messages_edited
ON messages(conversation_id, edited_at DESC)
WHERE edited_at IS NOT NULL;

-- >>> END: 091_message_edit_delete.sql <<<

-- >>> BEGIN: 092_chat_notification_preferences.sql <<<
-- Add chat notification preference columns
-- Allows users to control when they receive notifications for chat messages

ALTER TABLE notification_preferences
ADD COLUMN IF NOT EXISTS in_app_new_message BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS in_app_message_mention BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS push_new_message BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS push_message_mention BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS email_new_message BOOLEAN DEFAULT FALSE;

-- Add index for faster lookups of notification preferences
CREATE INDEX IF NOT EXISTS idx_notification_prefs_chat
ON notification_preferences (user_id, in_app_new_message, push_new_message, email_new_message);

-- >>> END: 092_chat_notification_preferences.sql <<<

-- >>> BEGIN: 093_optimize_chat_queries.sql <<<
-- Chat query performance optimization
-- Add indexes for common query patterns

-- Index for getMessages pagination (conversation_id + created_at)
CREATE INDEX IF NOT EXISTS idx_messages_conv_created
ON messages (conversation_id, created_at DESC NULLS LAST)
WHERE deleted_at IS NULL;

-- Index for searchMessages (conversation_id + content search)
CREATE INDEX IF NOT EXISTS idx_messages_conv_search
ON messages (conversation_id, sender_id, created_at DESC)
WHERE deleted_at IS NULL;

-- Index for unread message count queries (conversation_id + read status)
CREATE INDEX IF NOT EXISTS idx_messages_unread
ON messages (conversation_id, sender_id, is_read)
WHERE deleted_at IS NULL AND is_read = FALSE;

-- Index for conversation listing (customer + helper)
CREATE INDEX IF NOT EXISTS idx_conversations_participants
ON conversations (customer_id, helper_id, last_message_at DESC);

-- Index for helper's active conversations
CREATE INDEX IF NOT EXISTS idx_conversations_helper
ON conversations (helper_id, last_message_at DESC)
WHERE status = 'active';

-- Index for business reps (business_members lookup)
CREATE INDEX IF NOT EXISTS idx_business_members_status
ON business_members (business_id, member_id, status)
WHERE status = 'active';

-- Index for conversation+business lookup (for chat context)
CREATE INDEX IF NOT EXISTS idx_conversations_business
ON conversations (business_id, customer_id, helper_id)
WHERE business_id IS NOT NULL;

-- >>> END: 093_optimize_chat_queries.sql <<<
