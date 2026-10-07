-- 714: Session invalidation trigger must dual-write is_valid + is_revoked
--
-- P2 finding #15: migration 200's invalidate_previous_sessions() trigger only
-- SET is_revoked = TRUE when a new session row is inserted, but every
-- application revoke/refresh path dual-writes is_valid = false AND
-- is_revoked = true (see authController refreshToken, superAdminController,
-- adminSelfSettingsController). The read side treats a session as dead if
-- EITHER flag says so (refresh path: isInvalid || isRevoked; session list:
-- is_valid = true AND is_revoked = false). With the trigger setting only one
-- flag, trigger-invalidated rows and app-invalidated rows diverged on disk.
--
-- Migration 200 is already applied to production; it is intentionally NOT
-- edited. This migration replaces only the trigger function body so the
-- trigger (which still references invalidate_previous_sessions() by name)
-- now sets both flags. No new trigger is created.

CREATE OR REPLACE FUNCTION invalidate_previous_sessions()
RETURNS TRIGGER AS $$
BEGIN
  -- When a new session is created, mark previous ones as superseded.
  -- Dual-write both flags: read paths treat a session as dead if EITHER
  -- is_valid = false OR is_revoked = true.
  UPDATE sessions SET is_revoked = TRUE, is_valid = FALSE
  WHERE user_id = NEW.user_id
    AND id != NEW.id
    AND created_at < NEW.created_at;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
