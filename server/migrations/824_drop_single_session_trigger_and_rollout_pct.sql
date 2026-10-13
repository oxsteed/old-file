-- Migration 824: drop the single-live-session trigger; drop dead rollout_pct column.
--
-- P3-14-F01: migration 200's trigger_invalidate_old_sessions fired AFTER
-- INSERT on sessions and revoked EVERY previous session for the user. That
-- silently enforced single-live-session-per-user: signing in on a second
-- device (or a refresh-token rotation inserting a new row) killed all other
-- devices' sessions. Multi-device sessions are legitimate; per-session
-- revocation is already handled in application code:
--   * refresh-token rotation revokes only the rotated session
--     (authController refreshToken: UPDATE ... WHERE refresh_token = $1),
--   * password change revokes all sessions except the current one,
--   * mode switch / admin force-logout / deactivation revoke deliberately.
-- The trigger is therefore redundant and harmful. Drop it (and its function)
-- so a new login no longer logs the user out everywhere else. Session
-- fixation remains prevented: every issuance site mints fresh random tokens
-- and overwrites the cookies, so a planted pre-login token can never become
-- the post-login credential.
--
-- P3-7-F08: feature_flags.rollout_pct had zero readers and zero writers
-- (partial-rollout infrastructure was schema-only). Drop the column rather
-- than keep dead schema. The settings_change_requests.rollout_percent /
-- rollout_segment request metadata is untouched.

DROP TRIGGER IF EXISTS trigger_invalidate_old_sessions ON sessions;
DROP FUNCTION IF EXISTS invalidate_previous_sessions();

ALTER TABLE feature_flags DROP COLUMN IF EXISTS rollout_pct;
