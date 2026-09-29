-- 583: Expire the manual "available now" readiness flag.
--
-- helper_profiles.is_available_now is a helper-toggled checkbox. Without an
-- expiry it goes stale: a helper who flipped it on days ago still shows as
-- "available now" in discovery, search filters, and chat. The new
-- is_available_now_updated_at records when the flag was last set; a worker
-- clears flags older than the TTL so every read path sees fresh readiness
-- without changing its query.
ALTER TABLE helper_profiles
  ADD COLUMN IF NOT EXISTS is_available_now_updated_at TIMESTAMPTZ NULL;

-- Backfill: currently-flagged helpers keep a fresh window instead of being
-- cleared on the first worker pass after deploy.
UPDATE helper_profiles
   SET is_available_now_updated_at = NOW()
 WHERE is_available_now = TRUE
   AND is_available_now_updated_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_helper_profiles_available_now_stale
  ON helper_profiles (is_available_now, is_available_now_updated_at)
  WHERE is_available_now = TRUE;
