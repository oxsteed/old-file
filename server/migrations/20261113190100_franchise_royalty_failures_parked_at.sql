-- Domain 8 #13: the royalty-failure outbox has no cap and no park.
--
-- A permanently failing source was retried hourly forever
-- (attempts unbounded, backoff capped at one day) with no
-- visibility. Park it after the max-attempts threshold so the
-- re-drive stops retrying it and the admin list can surface it for
-- operator review. The threshold (10 attempts) lives in
-- franchiseRoyaltyService.MAX_ROYALTY_FAILURE_ATTEMPTS: hourly
-- retries mean 10 attempts span roughly a day of backoff, long
-- enough to ride out a transient outage, short enough that a
-- permanently broken source stops churning.

ALTER TABLE franchise_royalty_failures
  ADD COLUMN IF NOT EXISTS parked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS franchise_royalty_failures_parked_idx
  ON franchise_royalty_failures (parked_at)
  WHERE parked_at IS NOT NULL;
