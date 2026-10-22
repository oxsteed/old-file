-- C006: shorten the activity_hourly HLL sketch TTL (privacy retention policy).
--
-- D16 (Emile 2026-10-22): growth.activity_hourly materializes
-- uniqState(toString(subject_key)) per hour. An HLL sketch cannot support
-- individual-subject deletion, so an erased subject's key remains
-- irreversibly merged into the hourly sketch until TTL expiry. Deleting
-- growth.activity_events rows does not propagate into this MV target.
--
-- The sketch is not invertible to the key (exploitability is low), but the
-- residual is real and is documented in the erasure contract
-- (server/jobs/growthErasure.js). Shorten the sketch TTL from 13 months to
-- 90 days, matching the raw activity_events retention (C005 / D14: one
-- retention policy for activity events), so the residual is bounded instead
-- of lingering for over a year.
--
-- Apply this after C003 on every ClickHouse replica and shard.
ALTER TABLE growth.activity_hourly ON CLUSTER growth
MODIFY TTL hour + INTERVAL 90 DAY DELETE;
