-- Migration 165: User deletion scheduling and recovery window
-- Adds columns to support:
--   1. Admin soft-delete with 30-day recovery window
--   2. Tracking deletion type (admin vs self)
--   3. Preserving ban/dispute history through self-deletion attempts
--   4. Hard-deletion scheduler for accounts past their grace window

-- deletion_scheduled_at: set when an admin marks the account for deletion.
--   The account is locked immediately but data is not removed until 30 days later.
ALTER TABLE users ADD COLUMN IF NOT EXISTS deletion_scheduled_at TIMESTAMPTZ;

-- deletion_type: 'self' (CCPA / user-initiated) or 'admin' (admin/super-admin action)
ALTER TABLE users ADD COLUMN IF NOT EXISTS deletion_type VARCHAR(10) CHECK (deletion_type IN ('self', 'admin'));

-- deletion_reason: free-text reason recorded by admin (or 'User requested account deletion' for self-delete)
ALTER TABLE users ADD COLUMN IF NOT EXISTS deletion_reason TEXT;

-- deletion_admin_id: which admin scheduled the deletion (NULL for self-deletes)
ALTER TABLE users ADD COLUMN IF NOT EXISTS deletion_admin_id UUID REFERENCES users(id) ON DELETE SET NULL;

-- was_banned_at_deletion: flag preserved through anonymization so re-registration can be blocked
--   if the user was banned before they self-deleted to escape the ban.
ALTER TABLE users ADD COLUMN IF NOT EXISTS was_banned_at_deletion BOOLEAN DEFAULT FALSE;

-- original_email_hash: SHA-256 of the original email, preserved through anonymization.
--   Used to detect bad-faith re-registrations after self-delete.
--   NOTE: this is a one-way hash and cannot be reversed. The original email is anonymized.
ALTER TABLE users ADD COLUMN IF NOT EXISTS original_email_hash VARCHAR(64);

-- Index for the scheduled deletion job to find accounts ready for hard-delete
CREATE INDEX IF NOT EXISTS idx_users_deletion_scheduled
  ON users(deletion_scheduled_at)
  WHERE deletion_scheduled_at IS NOT NULL AND deleted_at IS NOT NULL;

-- Index for admin dashboard queries on pending deletions
CREATE INDEX IF NOT EXISTS idx_users_deletion_type
  ON users(deletion_type)
  WHERE deletion_type IS NOT NULL;
